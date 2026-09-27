import { describe, expect, it } from 'vitest';
import { decodeWaveform, encodeWaveform } from '../waveform';

describe('waveform storage', () => {
  it('round-trips peaks at one byte each', () => {
    const peaks = Float32Array.from([0, 0.25, 0.5, 1, 1.4, -0.2]);
    const stored = encodeWaveform({ peaks, peaksPerSecond: 150, duration: 372.5, fileName: 'a.mp3' }, 42);
    expect(stored.peaks).toBeInstanceOf(Uint8Array);
    expect(Array.from(stored.peaks)).toEqual([0, 64, 128, 255, 255, 0]);
    expect(stored).toMatchObject({ v: 1, peaksPerSecond: 150, duration: 372.5, fileName: 'a.mp3', savedAt: 42 });

    const back = decodeWaveform(stored)!;
    expect(back.peaks.length).toBe(6);
    Array.from(back.peaks).forEach((p, i) => expect(p).toBeCloseTo(Math.max(0, Math.min(1, peaks[i])), 2));
    expect(back).toMatchObject({ peaksPerSecond: 150, duration: 372.5, fileName: 'a.mp3' });
  });

  it('ignores missing or unknown data', () => {
    expect(decodeWaveform(undefined)).toBeUndefined();
    expect(decodeWaveform({ v: 2 } as never)).toBeUndefined();
    expect(decodeWaveform({ v: 1, peaks: [1, 2], peaksPerSecond: 150 } as never)).toBeUndefined();
  });
});
