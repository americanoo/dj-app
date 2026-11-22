import { describe, expect, it } from 'vitest';
import { keyMatchShift, keyRelation, transposeKey } from '../keys';
import { incomingCurves, planTransition, snapIncoming, tempoMode, valueAt } from '../mixplan';
import { newSet, type SetEntry, type Track } from '../model';
import { buildTimeline, nightSlots, slotKey, slotPos } from '../setplan';
import { rideTimes } from '../../ui/nightPlayer';

describe('key matching', () => {
  it('transposes keys by semitones', () => {
    expect(transposeKey('Am', 2)).toBe('Bm');
    expect(transposeKey('8A', -1)).toBe('G#m');
    expect(transposeKey('C', 12)).toBe('C');
  });

  it('leaves keys that already mix smoothly alone', () => {
    expect(keyMatchShift('Am', 'Am')).toBe(0);
    expect(keyMatchShift('C', 'Am')).toBe(0); // relative
    expect(keyMatchShift('Em', 'Am')).toBe(0); // 9A next to 8A
  });

  it('finds the smallest shift that makes a clash mix smoothly', () => {
    // Am (8A) under Bbm (3A): a semitone down makes it Am.
    expect(keyMatchShift('Bbm', 'Am')).toBe(-1);
    const shifted = transposeKey('F#', keyMatchShift('F#', 'Am')!);
    expect(['same', 'relative', 'adjacent', 'diagonal']).toContain(keyRelation('Am', shifted));
    expect(Math.abs(keyMatchShift('F#', 'Am')!)).toBe(1);
    expect(keyMatchShift(undefined, 'Am')).toBeUndefined();
  });
});

const track = (id: string, patch: Partial<Track>): Track => ({ id, title: id, artist: 'X', cues: [], source: 'manual', duration: 120, ...patch });
const entry = (id: string, trackId: string, at: number, patch: Partial<SetEntry> = {}): SetEntry => ({
  id,
  trackId,
  chapterId: 'c',
  energy: 5,
  transition: '',
  notes: '',
  at,
  ...patch,
});

describe('tempo modes', () => {
  const a = { startsAt: 0, playFor: 60, mixIn: 0, bpm: 120 };
  const b = { startsAt: 30, playFor: 60, mixIn: 0, bpm: 132 };

  it('ride: the outgoing track rides into the incoming tempo (as before); older plans still read Sync', () => {
    const p = planTransition(a, b);
    expect(p.tempo).toBe('ride');
    expect(p.sync?.rate).toBeCloseTo(1.1);
    expect(p.match).toBeUndefined();
    expect(tempoMode({ sync: false })).toBe('free');
    expect(planTransition(a, b, { sync: false }).noSync).toBe('off');
  });

  it('match: the incoming track comes in at the playing tempo, then settles back to its own over 8 bars', () => {
    const p = planTransition(a, b, { tempo: 'match' });
    expect(p.sync).toBeUndefined();
    expect(p.match!.rate).toBeCloseTo(120 / 132);
    expect(p.match!.until).toBe(60);
    expect(p.match!.settle).toBeCloseTo(60 + 8 * (240 / 132));
    const rate = incomingCurves(p, b).rate;
    expect(valueAt(rate, 40, 1)).toBeCloseTo(120 / 132);
    expect(valueAt(rate, p.match!.settle + 1, 1)).toBe(1);
    // Snapping still lands the incoming track on the outgoing beat (the outgoing track isn't ridden).
    const at = snapIncoming(a, b, 30.2, 'match');
    expect(((at / 0.5) % 1 + 1) % 1).toBeCloseTo(0, 3);
  });

  it('match plays through the night: the incoming slot runs at the outgoing tempo', () => {
    const set = newSet('S');
    set.entries = [entry('1', 'a', 0), entry('2', 'b', 30, { tempo: 'match' })];
    const lib = { tracks: { a: track('a', { bpm: 120, duration: 60 }), b: track('b', { bpm: 132 }) }, playlists: [] };
    const slots = nightSlots(buildTimeline(set, lib));
    const sb = slots.find((s) => s.id === '2')!;
    expect(slotPos(sb, 40)).toBeCloseTo(10 * (120 / 132));
    const sa = slots.find((s) => s.id === '1')!;
    expect(slotPos(sa, 50)).toBeCloseTo(50); // the outgoing track keeps its tempo
  });
});

describe('key matching through the night', () => {
  it('transposes a matched track to the key the one before it plays in, and the next follows that', () => {
    const set = newSet('S');
    set.entries = [entry('1', 'a', 0), entry('2', 'b', 100, { matchKey: true }), entry('3', 'c', 200, { matchKey: true })];
    const lib = {
      tracks: {
        a: track('a', { key: 'Am' }),
        b: track('b', { key: 'Bbm' }),
        c: track('c', { key: 'Bbm' }),
      },
      playlists: [],
    };
    const slots = nightSlots(buildTimeline(set, lib));
    expect(slots.map((s) => s.semitones ?? 0)).toEqual([0, -1, -1]);
    expect(slots.map(slotKey)).toEqual(['Am', 'Am', 'Am']);
  });

  it('only when asked', () => {
    const set = newSet('S');
    set.entries = [entry('1', 'a', 0), entry('2', 'b', 100)];
    const lib = { tracks: { a: track('a', { key: 'Am' }), b: track('b', { key: 'Bbm' }) }, playlists: [] };
    expect(nightSlots(buildTimeline(set, lib)).map((s) => s.semitones ?? 0)).toEqual([0, 0]);
  });
});

describe('the time-stretcher follows a tempo ride', () => {
  it('in steps along the slope, and only at the corners elsewhere', () => {
    const env = [
      { t: 10, v: 1 },
      { t: 12, v: 1.1 },
    ];
    const ts = rideTimes(env, 0, 20);
    expect(ts[0]).toBe(0);
    expect(ts).toContain(10);
    expect(ts).toContain(12);
    expect(ts.filter((t) => t > 10 && t < 12)).toHaveLength(7);
    expect(ts.every((t, i) => i === 0 || t > ts[i - 1])).toBe(true);
    expect(rideTimes([], 5, 9)).toEqual([5]);
  });
});
