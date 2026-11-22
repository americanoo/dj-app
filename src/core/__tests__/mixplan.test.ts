import { describe, expect, it } from 'vitest';
import {
  BASS_KILL_DB,
  emptyCurves,
  isCustomBlend,
  mergeCurves,
  seedKeyframes,
  withKeyframes,
  incomingCurves,
  integrate,
  outgoingCurves,
  planTransition,
  rideOffset,
  snapIncoming,
  syncRate,
  valueAt,
  type MixTrack,
} from '../mixplan';

// A: 120 BPM from 0 (beat 0.5 s, bar 2 s); B: 126 BPM, in at 268 s, 32 s before A ends.
const a: MixTrack = { startsAt: 0, playFor: 300, mixIn: 0, bpm: 120, gridStart: 0 };
const b: MixTrack = { startsAt: 268, playFor: 300, mixIn: 30, bpm: 126, gridStart: 0 };

describe('curves', () => {
  const env = [
    { t: 10, v: 1 },
    { t: 20, v: 2 },
    { t: 20, v: 5 },
  ];
  it('interpolates, holds flat outside, and steps where two points share a time', () => {
    expect(valueAt([], 3, 7)).toBe(7);
    expect(valueAt(env, 0, 0)).toBe(1);
    expect(valueAt(env, 15, 0)).toBe(1.5);
    expect(valueAt(env, 25, 0)).toBe(5);
  });
  it('integrates exactly across ramps and steps', () => {
    expect(integrate(env, 0, 10)).toBe(10);
    expect(integrate(env, 10, 20)).toBeCloseTo(15);
    expect(integrate(env, 0, 30)).toBeCloseTo(10 + 15 + 50);
  });
});

describe('tempo sync', () => {
  it('picks the nearest of normal, half and double time, within ±16%', () => {
    expect(syncRate(120, 126)).toBeCloseTo(1.05);
    expect(syncRate(128, 64)).toBe(1);
    expect(syncRate(70, 140)).toBe(1);
    expect(syncRate(120, 150)).toBeUndefined();
    expect(syncRate(undefined, 120)).toBeUndefined();
  });

  it('rides the outgoing track into the incoming tempo over 8 bars before it comes in', () => {
    const p = planTransition(a, b);
    expect(p.sync?.rate).toBeCloseTo(1.05);
    expect(p.sync?.rideFrom).toBe(252); // 8 bars of 2 s before 268
    expect(p.sync?.rideTo).toBe(268);
    // Over the ride A gains half of 5% of 16 s; after it, 5% of every second.
    expect(rideOffset(p, 252)).toBe(0);
    expect(rideOffset(p, 268)).toBeCloseTo(0.4);
    expect(rideOffset(p, 278)).toBeCloseTo(0.9);
  });

  it('explains why a transition is not synced', () => {
    expect(planTransition(a, b, { sync: false }).noSync).toBe('off');
    expect(planTransition(a, { ...b, bpm: 150 }).noSync).toBe('too-far');
    expect(planTransition(a, { ...b, startsAt: 310 }).noSync).toBe('no-overlap');
    expect(planTransition(a, { ...b, bpm: 120 }).noSync).toBe('same-tempo');
  });

  it('snaps the incoming track onto the outgoing beat as it is played', () => {
    const at = snapIncoming(a, b, 268.2);
    const p = planTransition(a, { ...b, startsAt: at });
    const pos = a.mixIn + (at - a.startsAt) + rideOffset(p, at);
    // B's mix-in (30 s at 126 BPM = beat 63 exactly) lands on one of A's beats
    expect((pos / 0.5) % 1).toBeCloseTo(0, 5);
    expect(Math.abs(at - 268.2)).toBeLessThan(0.5);
  });

  it('matches the phase of a mix-in that sits off its own beat', () => {
    const offBeat = { ...b, mixIn: 30 + (60 / 126) * 0.25 }; // a quarter beat late
    const at = snapIncoming(a, offBeat, 268.2);
    const p = planTransition(a, { ...offBeat, startsAt: at });
    const pos = a.mixIn + (at - a.startsAt) + rideOffset(p, at);
    const frac = ((pos / 0.5) % 1 + 1) % 1;
    expect(frac).toBeCloseTo(0.25, 3);
  });
});

describe('blend styles', () => {
  it('defaults to a bass swap on a real overlap, and straight on a cut', () => {
    expect(planTransition(a, b).style).toBe('bassSwap');
    expect(planTransition(a, { ...b, startsAt: 299 }).style).toBe('straight');
    expect(planTransition(a, b, { blend: 'crossfade' }).style).toBe('crossfade');
    // a crossfade needs an overlap
    expect(planTransition(a, { ...b, startsAt: 310 }, { blend: 'crossfade' }).style).toBe('straight');
  });

  it('bass swap: the basses change over on a bar of the incoming track, halfway through', () => {
    const p = planTransition(a, b);
    // halfway = 284; B's bars (1.905 s) counted from where its grid sits at 268
    const barB = (60 / 126) * 4;
    const origin = 268 - 30;
    expect(((p.swapAt! - origin) / barB) % 1).toBeCloseTo(0, 6);
    expect(Math.abs(p.swapAt! - 284)).toBeLessThan(barB);
    const out = outgoingCurves(p, a);
    const inc = incomingCurves(p, b);
    expect(valueAt(inc.bass, p.swapAt! - 1, 0)).toBe(BASS_KILL_DB);
    expect(valueAt(inc.bass, p.swapAt! + 1, 0)).toBe(0);
    expect(valueAt(out.bass, p.swapAt! - 1, 0)).toBe(0);
    expect(valueAt(out.bass, p.swapAt! + 1, 0)).toBe(BASS_KILL_DB);
    // B's fader comes up at the start; A's goes down to nothing at its out point
    expect(valueAt(inc.level, 268, 1)).toBe(0);
    expect(valueAt(inc.level, 276, 1)).toBe(1);
    expect(valueAt(out.level, 300, 1)).toBe(0);
    expect(valueAt(out.level, p.swapAt! + 0.1, 1)).toBe(1);
  });

  it('crossfade: equal power across the overlap', () => {
    const p = planTransition(a, b, { blend: 'crossfade' });
    const out = outgoingCurves(p, a);
    const inc = incomingCurves(p, b);
    expect(valueAt(out.level, 284, 1)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(valueAt(inc.level, 284, 1)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(valueAt(out.level, 300, 1)).toBeCloseTo(0);
    expect(valueAt(inc.level, 300, 1)).toBeCloseTo(1);
  });

  it('echo out: the outgoing track echoes out at its out point', () => {
    const p = planTransition(a, b, { blend: 'echo' });
    expect(p.echoAt).toBe(300);
    expect(outgoingCurves(p, a).level).toEqual([]);
  });
});

describe('keyframes', () => {
  const p = planTransition(a, b);
  const base = outgoingCurves(p, a);

  it('replace the blend style for the parameters that have them, relative to where B comes in', () => {
    const c = withKeyframes(base, { level: [{ t: -4, v: 1 }, { t: 8, v: 0.2 }], echo: [{ t: 0, v: 0.6 }] }, 268);
    expect(c.level).toEqual([
      { t: 264, v: 1 },
      { t: 276, v: 0.2 },
    ]);
    expect(c.echo).toEqual([{ t: 268, v: 0.6 }]);
    // untouched: the bass swap still comes from the style
    expect(c.bass).toEqual(base.bass);
    expect(withKeyframes(base, undefined, 268)).toBe(base);
  });

  it('start from the blend style for the fader and bass, and as a bump for the rest', () => {
    const bass = seedKeyframes(base, 'bass', 268, { t: 2, v: -20 }, 2);
    const want = [2, p.swapAt! - 268, p.swapAt! - 268 + 0.03];
    bass.forEach((k, i) => expect(k.t).toBeCloseTo(want[i], 6));
    expect(bass.map((k) => k.v)).toEqual([-20, 0, BASS_KILL_DB]);
    expect(seedKeyframes(emptyCurves(), 'reverb', 268, { t: 10, v: 0.8 }, 2)).toEqual([
      { t: 2, v: 0 },
      { t: 10, v: 0.8 },
      { t: 18, v: 0 },
    ]);
  });

  it('mark the blend as custom only when the fader or bass are drawn', () => {
    expect(isCustomBlend(undefined)).toBe(false);
    expect(isCustomBlend({ a: { echo: [{ t: 0, v: 1 }] } })).toBe(false);
    expect(isCustomBlend({ b: { bass: [{ t: 0, v: -40 }] } })).toBe(true);
  });

  it('merge every parameter of both transitions of a track', () => {
    const m = mergeCurves(withKeyframes(emptyCurves(), { filter: [{ t: 5, v: 0.5 }] }, 100), withKeyframes(emptyCurves(), { filter: [{ t: 0, v: -1 }] }, 10));
    expect(m.filter).toEqual([
      { t: 10, v: -1 },
      { t: 105, v: 0.5 },
    ]);
  });
});
