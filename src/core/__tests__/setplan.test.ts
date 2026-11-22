import { describe, expect, it } from 'vitest';
import { newSet, type Library, type Track } from '../model';
import { buildTimeline, describeTransition, planCues, withPlanCues, formatSetTime, nextInNight, nightSlots, slotsAt, transitionsOf, nightAtTrack, trackAtNight, parseClock, setEnd, setPlanMarkdown, totalSeconds, withTimes } from '../setplan';
import { reducer } from '../../ui/store';
import { emptyProject } from '../model';

const track = (id: string, patch: Partial<Track> = {}): Track => ({
  id,
  title: id.toUpperCase(),
  artist: 'Artist',
  cues: [],
  source: 'manual',
  ...patch,
});

describe('set timeline', () => {
  const lib: Library = {
    tracks: {
      a: track('a', { duration: 300, bpm: 120, key: 'Am' }),
      b: track('b', {
        duration: 400,
        bpm: 124,
        key: 'Em',
        cues: [
          { id: 'in', kind: 'cue', slot: 0, start: 30, name: 'In', color: '#e62828' },
          { id: 'out', kind: 'cue', slot: 1, start: 330, name: 'Out', color: '#e62828' },
        ],
      }),
      c: track('c', { duration: 360, bpm: 140, key: 'F#' }),
    },
    playlists: [],
  };
  const set = newSet('Test');
  const ch = set.chapters[0].id;
  set.entries = [
    { id: '1', trackId: 'a', chapterId: ch, energy: 3, transition: '', notes: '' },
    { id: '2', trackId: 'b', chapterId: ch, energy: 5, transition: 'bass swap', notes: '', mixInCueId: 'in', mixOutCueId: 'out' },
    { id: '3', trackId: 'c', chapterId: ch, energy: 8, transition: '', notes: '' },
  ];

  it('uses mix-in/out cues for play length', () => {
    const tl = buildTimeline(set, lib);
    expect(tl.map((t) => t.startsAt)).toEqual([0, 300, 600]);
    expect(tl[1]).toMatchObject({ playFor: 300, estimated: false, keyRelation: 'adjacent' });
    expect(totalSeconds(tl)).toBe(960);
  });

  it('flags key clashes and big BPM jumps', () => {
    const tl = buildTimeline(set, lib);
    expect(tl[1].warnings).toEqual([]);
    expect(tl[2].keyRelation).toBe('clash');
    expect(tl[2].warnings.join()).toMatch(/Key clash.*BPM jump \+12\.9%/);
  });

  it('does not flag half/double-time mixes as BPM jumps', () => {
    const half: Library = {
      tracks: { x: track('x', { duration: 200, bpm: 96, key: 'Am' }), y: track('y', { duration: 200, bpm: 192, key: 'Am' }) },
      playlists: [],
    };
    const s = newSet('Reggaeton');
    s.entries = ['x', 'y'].map((trackId, i) => ({ id: `r${i}`, trackId, chapterId: s.chapters[0].id, energy: 5, transition: '', notes: '' }));
    expect(buildTimeline(s, half)[1].warnings).toEqual([]);
  });

  it('renders a run sheet', () => {
    const md = setPlanMarkdown(set, lib);
    expect(md).toContain('# Test');
    expect(md).toContain('## Warm-up');
    expect(md).toContain('↪ Transition: bass swap');
    expect(md).toContain('Cues: A 0:30 "In", B 5:30 "Out"');
  });
});

describe('timeline reducer', () => {
  const lib = (): Library => ({
    tracks: {
      a: track('a', { duration: 300 }),
      b: track('b', { duration: 240 }),
      c: track('c', { duration: 360 }),
    },
    playlists: [],
  });
  const withLib = () => {
    const p = emptyProject();
    p.library = lib();
    return p;
  };
  const times = (p: ReturnType<typeof emptyProject>) =>
    p.sets[0].entries.map((e) => `${e.trackId}@${e.at}`);

  it('appends added tracks after the last one', () => {
    let p = withLib();
    p = reducer(p, { type: 'addEntries', trackIds: ['a', 'b'] });
    p = reducer(p, { type: 'addEntries', trackIds: ['c'] });
    expect(times(p)).toEqual(['a@0', 'b@300', 'c@540']);
    expect(new Set(p.sets[0].entries.map((e) => e.chapterId)).size).toBe(1);
  });

  it('places a dragged track at an exact time and keeps the night sorted', () => {
    let p = withLib();
    p = reducer(p, { type: 'addEntries', trackIds: ['a', 'b'] }); // 0, 300
    p = reducer(p, { type: 'placeTrack', trackId: 'c', at: 150.5 });
    expect(times(p)).toEqual(['a@0', 'c@150.5', 'b@300']);
    p = reducer(p, { type: 'placeTrack', trackId: 'c', at: -20 });
    expect(times(p)).toContain('c@0'); // never before the start of the night
  });

  it('moves tracks in time and adopts the chapter they land in', () => {
    let p = withLib();
    const [warm, build] = p.sets[0].chapters;
    p = reducer(p, { type: 'addEntries', trackIds: ['a', 'b'], chapterId: warm.id });
    p = reducer(p, { type: 'addEntries', trackIds: ['c'], chapterId: build.id }); // c@540
    const c = p.sets[0].entries.find((e) => e.trackId === 'c')!;
    p = reducer(p, { type: 'setEntryTime', id: c.id, at: 100 });
    expect(times(p)).toEqual(['a@0', 'c@100', 'b@300']);
    expect(p.sets[0].entries.find((e) => e.id === c.id)!.chapterId).toBe(warm.id);
  });

  it('lays out sets saved before tracks had times, end to end', () => {
    const p = withLib();
    const set = p.sets[0];
    set.entries = ['a', 'b'].map((trackId, i) => ({ id: `e${i}`, trackId, chapterId: set.chapters[0].id, energy: 5, transition: '', notes: '' }));
    expect(withTimes(set, p.library).entries.map((e) => e.at)).toEqual([0, 300]);
    expect(setEnd(set, p.library)).toBe(540);
  });

  it('keeps entries when a chapter is removed or reordered', () => {
    let p = withLib();
    const [warm, build] = p.sets[0].chapters;
    p = reducer(p, { type: 'addEntries', trackIds: ['a'], chapterId: build.id });
    p = reducer(p, { type: 'moveChapter', id: warm.id, delta: 1 });
    expect(p.sets[0].chapters[1].id).toBe(warm.id);
    p = reducer(p, { type: 'removeChapter', id: build.id });
    expect(p.sets[0].entries.every((e) => e.chapterId !== build.id)).toBe(true);
  });
});

describe('set clock', () => {
  it('shows wall-clock or elapsed time', () => {
    expect(parseClock('22:30')).toBe(81000);
    expect(parseClock('25:00')).toBeUndefined();
    expect(formatSetTime(3725, '22:30')).toBe('23:32');
    expect(formatSetTime(3725, '22:30', true)).toBe('23:32:05');
    expect(formatSetTime(7200, '23:00')).toBe('01:00'); // past midnight
    expect(formatSetTime(3725)).toBe('1:02:05');
    expect(formatSetTime(65)).toBe('1:05');
  });
});

describe('playing on into the next track', () => {
  const lib: Library = {
    tracks: {
      a: track('a', { duration: 300 }),
      b: track('b', { duration: 400, gridStart: 0.4, cues: [{ id: 'in', kind: 'cue', slot: 0, start: 30, name: 'In', color: '#fff' }] }),
      c: track('c', { duration: 360, gridStart: 0.25 }),
    },
    playlists: [],
  };
  const set = newSet('Night');
  const ch = set.chapters[0].id;
  set.entries = [
    { id: '1', trackId: 'a', chapterId: ch, energy: 3, transition: '', notes: '', at: 0 },
    { id: '3', trackId: 'c', chapterId: ch, energy: 8, transition: '', notes: '', at: 600 },
    { id: '2', trackId: 'b', chapterId: ch, energy: 5, transition: '', notes: '', at: 280, mixInCueId: 'in' },
  ];

  it('follows the night in time order and starts at the mix-in cue, else the first downbeat', () => {
    expect(nextInNight(set, lib, 'a')).toEqual({ trackId: 'b', at: 30 });
    expect(nextInNight(set, lib, 'b')).toEqual({ trackId: 'c', at: 0.25 });
  });

  it('has nothing after the last track, or for a track not in the night', () => {
    expect(nextInNight(set, lib, 'c')).toBeUndefined();
    expect(nextInNight(set, lib, 'zzz')).toBeUndefined();
  });
});

describe('scrubbing the night', () => {
  const lib: Library = {
    tracks: {
      a: track('a', { duration: 300 }),
      b: track('b', { duration: 400, cues: [{ id: 'in', kind: 'cue', slot: 0, start: 30, name: 'In', color: '#fff' }] }),
    },
    playlists: [],
  };
  const set = newSet('Night');
  const ch = set.chapters[0].id;
  set.entries = [
    { id: '1', trackId: 'a', chapterId: ch, energy: 3, transition: '', notes: '', at: 0 },
    // b comes in at 4:40 (a blend over a's last 20 s) from its mix-in at 0:30
    { id: '2', trackId: 'b', chapterId: ch, energy: 5, transition: '', notes: '', at: 280, mixInCueId: 'in' },
  ];
  const items = buildTimeline(set, lib);

  it('maps a moment of the night to a track and a spot in it', () => {
    expect(trackAtNight(items, 100)).toEqual({ trackId: 'a', pos: 100 });
    // during the blend the incoming track wins
    expect(trackAtNight(items, 290)).toEqual({ trackId: 'b', pos: 40 });
    expect(trackAtNight(items, 500)).toEqual({ trackId: 'b', pos: 250 });
  });

  it('and back again', () => {
    expect(nightAtTrack(items, 'a', 100)).toBe(100);
    expect(nightAtTrack(items, 'b', 40)).toBe(290);
    expect(nightAtTrack(items, 'zzz', 1)).toBeUndefined();
  });
});

describe('night playback and transitions', () => {
  const lib: Library = {
    tracks: {
      a: track('a', { duration: 300, bpm: 120, gridStart: 0.5 }),
      b: track('b', { duration: 400, bpm: 126, cues: [{ id: 'in', kind: 'cue', slot: 0, start: 30, name: 'In', color: '#fff' }] }),
      c: track('c', { duration: 200 }),
    },
    playlists: [],
  };
  const set = newSet('Night');
  const ch = set.chapters[0].id;
  set.entries = [
    { id: '1', trackId: 'a', chapterId: ch, energy: 3, transition: '', notes: '', at: 0 },
    // b comes in about 16 bars (31.5 s at 120) before a ends, on a's bar 135 (268 s past the grid = beat 536)
    { id: '2', trackId: 'b', chapterId: ch, energy: 5, transition: '', notes: '', at: 268.5, mixInCueId: 'in' },
    // c after a 20 s gap (b ends at 638.5)
    { id: '3', trackId: 'c', chapterId: ch, energy: 5, transition: '', notes: '', at: 648.5 + 10 },
  ];
  const slots = nightSlots(buildTimeline(set, lib));

  it('plays overlapping tracks together', () => {
    expect(slots.map((s) => [s.trackId, s.startsAt, s.playFor, s.mixIn])).toEqual([
      ['a', 0, 300, 0],
      ['b', 268.5, 370, 30],
      ['c', 658.5, 200, 0],
    ]);
    expect(slotsAt(slots, 100).map((s) => s.trackId)).toEqual(['a']);
    expect(slotsAt(slots, 280).map((s) => s.trackId)).toEqual(['a', 'b']);
    expect(slotsAt(slots, 650)).toEqual([]);
  });

  it('turns the plan into memory cues for the DJ software', () => {
    const cues = planCues(set, lib);
    const names = (id: string) => (cues[id] ?? []).map((c) => `${c.name} @ ${c.start.toFixed(2)}`);
    // a: where b comes in (after a's tempo ride to 126: 0.4 s further into the file). Its planned
    // out is the end of its file, which the faster ride reaches early: no cue past the end.
    expect(names('a')).toEqual(['▸ B in (bass swap, ride to 126) @ 268.90']);
    // b: its mix-in already has a hot cue (0:30), so no "in from" cue on top of it; the bass swap is marked
    expect(names('b').length).toBe(1);
    expect(names('b')[0]).toMatch(/^⇅ bass swap @ 4\d\.\d\d$/);
    // c comes in after a gap (b just ends): only where it comes in
    expect(names('c')).toEqual(['◂ in from B @ 0.00']);
    for (const c of Object.values(cues).flat()) expect(c.slot).toBeNull();
    // added to the exported copies only
    const exported = withPlanCues([lib.tracks.b], cues);
    expect(exported[0].cues.length).toBe(lib.tracks.b.cues.length + 1);
    expect(lib.tracks.b.cues.length).toBe(1);
  });

  it('describes each transition', () => {
    const [ab, bc] = transitionsOf(slots);
    const t = describeTransition(ab.a, ab.b);
    expect(t.overlap).toBeCloseTo(31.5);
    expect(t.overlapBars).toBeCloseTo(15.8);
    expect(t.bpmChange).toBe(5);
    // With the tempos synced, A rides from 120 to 126 over the 8 bars before B and gets 0.4 s
    // further through its file: B, placed on A's unridden beat, now comes in 0.2 beat early.
    expect(t.landsOn).toEqual({ bar: 135, beat: 2, offBeats: -0.2, phrase: false });
    const unsynced = describeTransition(ab.a, { ...ab.b, sync: false });
    expect(unsynced.landsOn).toEqual({ bar: 135, beat: 1, offBeats: 0, phrase: false });
    const g = describeTransition(bc.a, bc.b);
    expect(g.overlap).toBeCloseTo(-20);
    expect(g.overlapBars).toBeUndefined();
  });
});
