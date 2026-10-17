import { describe, expect, it } from 'vitest';
import { newSet, type SetEntry, type Track } from '../model';
import { buildTimeline, nightSlots, playLength, slotPos } from '../setplan';
import { fxIsOn, fxKeyframes, formatShort, newCue, parseSheetTime, setMixPoint, withFx } from '../sheet';

const track = (patch: Partial<Track> = {}): Track => ({ id: 't', title: 'T', artist: 'A', cues: [], source: 'manual', duration: 300, bpm: 120, ...patch });
const entry = (patch: Partial<SetEntry> = {}): SetEntry => ({ id: 'e1', trackId: 't', chapterId: 'c', energy: 5, transition: '', notes: '', ...patch });

describe('mix points typed as times', () => {
  it('adds a "Mix in" memory cue and points the entry at it, then moves that same cue', () => {
    const t = track();
    const first = setMixPoint(t, entry(), 'in', 32.5, []);
    expect(first.cues).toHaveLength(1);
    expect(first.cues[0]).toMatchObject({ kind: 'cue', slot: null, name: 'Mix in', start: 32.5 });
    expect(first.patch.mixInCueId).toBe(first.cues[0].id);

    const t2 = { ...t, cues: first.cues };
    const e2 = entry({ mixInCueId: first.cues[0].id });
    const again = setMixPoint(t2, e2, 'in', 40, [e2]);
    expect(again.cues).toHaveLength(1);
    expect(again.cues[0].start).toBe(40);
    expect(again.patch).toEqual({});
  });

  it('never moves a hot cue or a cue another entry uses: a new one is made instead', () => {
    const hot = { id: 'h', kind: 'cue' as const, slot: 0, start: 10, name: 'Drop', color: '#fff' };
    const t = track({ cues: [hot] });
    const e = entry({ mixOutCueId: 'h' });
    const r = setMixPoint(t, e, 'out', 250, [e]);
    expect(r.cues.find((c) => c.id === 'h')!.start).toBe(10);
    expect(r.cues).toHaveLength(2);
    expect(r.patch.mixOutCueId).not.toBe('h');

    const shared = { id: 'm', kind: 'cue' as const, slot: null, start: 60, name: 'Mix out', color: '#fff' };
    const t2 = track({ cues: [shared] });
    const e1 = entry({ id: 'e1', mixOutCueId: 'm' });
    const e3 = entry({ id: 'e3', mixOutCueId: 'm' });
    expect(setMixPoint(t2, e1, 'out', 90, [e1, e3]).cues).toHaveLength(2);
  });

  it('clears a point, and setting the out point drops a loop ending', () => {
    const e = entry({ mixInCueId: 'x', endLoop: { cueId: 'l', times: 4 } });
    expect(setMixPoint(track(), e, 'in', undefined, [e]).patch).toEqual({ mixInCueId: undefined });
    expect(setMixPoint(track(), e, 'out', 200, [e]).patch).toMatchObject({ endLoop: undefined });
  });
});

describe('cues and loops added on the sheet', () => {
  it('a cue takes the next free pad, a loop is 4 beats long', () => {
    const cues = [newCue([], 'cue', 0)];
    expect(cues[0].slot).toBe(0);
    expect(newCue(cues, 'cue', 10).slot).toBe(1);
    const loop = newCue(cues, 'loop', 60, 120);
    expect(loop).toMatchObject({ kind: 'loop', slot: null, start: 60, end: 62 });
  });
});

describe('leaving on a loop', () => {
  const loop = { id: 'l', kind: 'loop' as const, slot: null, start: 200, end: 208, name: '', color: '#fff' };
  const t = track({ cues: [loop] });

  it('plays up to the loop, then rolls it the chosen number of times', () => {
    // From 0 to the loop's end (208), then 3 more times round 8 s.
    expect(playLength(entry({ endLoop: { cueId: 'l', times: 4 } }), t)).toEqual({ seconds: 232, estimated: false });
    // A loop that's gone falls back to the track's end.
    expect(playLength(entry({ endLoop: { cueId: 'gone', times: 4 } }), t).seconds).toBe(300);
  });

  it('the night goes round the loop instead of past it', () => {
    const set = newSet('S');
    set.entries = [entry({ chapterId: set.chapters[0].id, at: 0, endLoop: { cueId: 'l', times: 4 } })];
    const [slot] = nightSlots(buildTimeline(set, { tracks: { t }, playlists: [] }));
    expect(slot.loop).toEqual({ start: 200, end: 208 });
    expect(slotPos(slot, 100)).toBe(100);
    expect(slotPos(slot, 207)).toBe(207);
    expect(slotPos(slot, 211)).toBe(203);
    expect(slotPos(slot, 230)).toBe(206);
  });
});

describe('transition FX switches', () => {
  it('switching an effect on writes its keyframes on the right deck; off removes them', () => {
    let auto = withFx(undefined, 'echoOut', true, 16, 2);
    expect(auto?.a?.echo).toEqual(fxKeyframes('echoOut', 16, 2));
    expect(auto?.a?.echo?.[0]).toEqual({ t: 8, v: 0 });
    expect(fxIsOn(auto, 'echoOut')).toBe(true);
    auto = withFx(auto, 'filterIn', true, 16, 2);
    expect(auto?.b?.filter?.[0]).toEqual({ t: 0, v: -0.85 });
    auto = withFx(auto, 'echoOut', false, 16, 2);
    expect(fxIsOn(auto, 'echoOut')).toBe(false);
    expect(auto?.a).toBeUndefined();
    expect(withFx(auto, 'filterIn', false, 16, 2)).toBeUndefined();
  });

  it('keeps other keyframes on the same deck', () => {
    const auto = withFx({ a: { bass: [{ t: 0, v: -40 }] } }, 'reverbOut', true, 8, 2);
    expect(auto?.a?.bass).toEqual([{ t: 0, v: -40 }]);
    expect(withFx(auto, 'reverbOut', false, 8, 2)).toEqual({ a: { bass: [{ t: 0, v: -40 }] } });
  });
});

it('formats times short: minutes and seconds, tenths only when there are some', () => {
  expect(formatShort(307)).toBe('5:07');
  expect(formatShort(307.84)).toBe('5:07.8');
  expect(formatShort(59.96)).toBe('1:00');
  expect(formatShort(undefined)).toBe('');
});

it('reads times typed with a colon, a space, or just digits from a number pad', () => {
  expect(parseSheetTime('2:08')).toBe(128);
  expect(parseSheetTime('2:08.5')).toBe(128.5);
  expect(parseSheetTime('2 08')).toBe(128);
  expect(parseSheetTime('208')).toBe(128);
  expect(parseSheetTime('1208.5')).toBe(728.5);
  expect(parseSheetTime('45')).toBe(45);
  expect(parseSheetTime('1:02:03')).toBe(3723);
  expect(parseSheetTime('2:75')).toBeUndefined();
  expect(parseSheetTime('275')).toBeUndefined();
  expect(parseSheetTime('abc')).toBeUndefined();
  expect(parseSheetTime('')).toBeUndefined();
});
