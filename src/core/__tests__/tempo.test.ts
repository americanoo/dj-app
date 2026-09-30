import { describe, expect, it } from 'vitest';
import { effectiveBpmDelta, findTempoFixes, scaleTempo, tempoFactor } from '../tempo';
import { applyTrackMerge, planMerge } from '../merge';
import type { Track } from '../model';

describe('tempo fixes', () => {
  it('halves and doubles the BPM and any grid markers, keeping their positions', () => {
    expect(scaleTempo({ bpm: 192 }, 0.5)).toEqual({ bpm: 96, beatGrid: undefined, tempoFix: 0.5 });
    expect(scaleTempo({ bpm: 87, beatGrid: [{ position: 0.2, bpm: 87, beat: 1 }] }, 2)).toEqual({
      bpm: 174,
      beatGrid: [{ position: 0.2, bpm: 174, beat: 1 }],
      tempoFix: 2,
    });
    expect(scaleTempo({ bpm: undefined }, 0.5).bpm).toBeUndefined();
  });

  it('remembers the correction, and forgets it when undone', () => {
    const once = scaleTempo({ bpm: 62 }, 2);
    expect(once.tempoFix).toBe(2);
    expect(scaleTempo(once, 0.5)).toMatchObject({ bpm: 62, tempoFix: undefined });
  });

  it('treats half- and double-time as the same groove', () => {
    expect(effectiveBpmDelta(96, 192)).toBeCloseTo(0);
    expect(effectiveBpmDelta(192, 96)).toBeCloseTo(0);
    expect(effectiveBpmDelta(96, 196)).toBeCloseTo(2.08, 1);
    expect(effectiveBpmDelta(120, 128)).toBeCloseTo(6.67, 1);
  });
});

describe('finding half / double-time BPMs', () => {
  const range = { min: 80, max: 160 };
  const track = (id: string, bpm: number | undefined, genre?: string) =>
    ({ id, artist: 'A', title: id, bpm, genre, cues: [] }) as unknown as Track;

  it('doubles anything under the slowest tempo and halves anything over the fastest', () => {
    expect(tempoFactor(62, range)).toBe(2); // 124
    expect(tempoFactor(31, range)).toBe(4); // 124
    expect(tempoFactor(192, range)).toBe(0.5); // Gasolina: 96
    expect(tempoFactor(80, range)).toBe(1);
    expect(tempoFactor(124, range)).toBe(1);
    expect(tempoFactor(160, range)).toBe(1);
  });

  it("doesn't halve below the slowest tempo when the range is narrow", () => {
    expect(tempoFactor(150, { min: 80, max: 140 })).toBe(1); // halving gives 75
  });

  it('lists only tracks that need fixing, and lets fast genres stay fast', () => {
    const fixes = findTempoFixes(
      [track('house', 62), track('gasolina', 192, 'Reggaeton'), track('ok', 128), track('dnb', 174, 'Drum & Bass'), track('dnb-half', 87, 'DnB'), track('none', undefined), track('pop-fast', 174, 'Pop')],
      range,
    );
    expect(fixes).toEqual([
      { trackId: 'house', from: 62, to: 124, factor: 2 },
      { trackId: 'gasolina', from: 192, to: 96, factor: 0.5 },
      { trackId: 'dnb-half', from: 87, to: 174, factor: 2 },
      { trackId: 'pop-fast', from: 174, to: 87, factor: 0.5 },
    ]);
  });
});

describe('keeping fixes', () => {
  const t = (bpm: number, extra: Partial<Track> = {}) =>
    ({ id: 'lib', title: 'Groove', artist: 'Delta', bpm, cues: [], source: 'rekordbox', path: '/m/g.mp3', ...extra }) as Track;
  const merged = (existing: Track, incoming: Track) => {
    const plan = planMerge({ tracks: { [existing.id]: existing }, playlists: [] }, { tracks: [{ ...incoming, id: 'in' }], format: 'rekordbox' });
    return applyTrackMerge(plan.matches[0], 'smart');
  };

  it("survives re-importing the DJ software's old half-time reading", () => {
    const fixed = { ...t(62), ...scaleTempo(t(62), 2) };
    expect(merged(fixed, t(62)).bpm).toBe(124);
    expect(merged(fixed, t(62, { beatGrid: [{ position: 0.1, bpm: 62, beat: 1 }] })).bpm).toBe(124);
  });

  it('lets a genuinely new BPM from the DJ software win', () => {
    const fixed = { ...t(62), ...scaleTempo(t(62), 2) };
    expect(merged(fixed, t(124)).bpm).toBe(124);
    expect(merged(fixed, t(126)).bpm).toBe(126);
  });

  it('skips tracks the DJ confirmed, unless asked', () => {
    const slow = { ...t(45), bpmConfirmed: true };
    expect(findTempoFixes([slow], { min: 80, max: 160 })).toEqual([]);
    expect(findTempoFixes([slow], { min: 80, max: 160 }, true)).toHaveLength(1);
  });
});
