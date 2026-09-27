import { describe, expect, it } from 'vitest';
import { effectiveBpmDelta, scaleTempo } from '../tempo';

describe('tempo fixes', () => {
  it('halves and doubles the BPM and any grid markers, keeping their positions', () => {
    expect(scaleTempo({ bpm: 192 }, 0.5)).toEqual({ bpm: 96, beatGrid: undefined });
    expect(scaleTempo({ bpm: 87, beatGrid: [{ position: 0.2, bpm: 87, beat: 1 }] }, 2)).toEqual({
      bpm: 174,
      beatGrid: [{ position: 0.2, bpm: 174, beat: 1 }],
    });
    expect(scaleTempo({ bpm: undefined }, 0.5).bpm).toBeUndefined();
  });

  it('treats half- and double-time as the same groove', () => {
    expect(effectiveBpmDelta(96, 192)).toBeCloseTo(0);
    expect(effectiveBpmDelta(192, 96)).toBeCloseTo(0);
    expect(effectiveBpmDelta(96, 196)).toBeCloseTo(2.08, 1);
    expect(effectiveBpmDelta(120, 128)).toBeCloseTo(6.67, 1);
  });
});
