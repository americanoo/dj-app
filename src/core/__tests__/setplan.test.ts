import { describe, expect, it } from 'vitest';
import { newSet, type Library, type Track } from '../model';
import { buildTimeline, formatSetTime, parseClock, setEnd, setPlanMarkdown, totalSeconds, withTimes } from '../setplan';
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
