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

  it('stores and restores the three bands', () => {
    const peaks = Float32Array.from([0.5, 1]);
    const bands = { low: Float32Array.from([1, 0]), mid: Float32Array.from([0.5, 0.5]), high: Float32Array.from([0, 1]) };
    const stored = encodeWaveform({ peaks, bands, peaksPerSecond: 150, duration: 2, fileName: 'b.wav' });
    expect(stored.v).toBe(2);
    const back = decodeWaveform(stored)!;
    expect(Array.from(back.bands!.low)).toEqual([1, 0]);
    expect(back.bands!.mid[0]).toBeCloseTo(0.5, 2);
    expect(Array.from(back.bands!.high)).toEqual([0, 1]);
  });

  it('still reads single-colour waveforms saved by the previous version', () => {
    const old = { v: 1 as const, peaks: Uint8Array.from([0, 255]), peaksPerSecond: 150, duration: 2, fileName: 'a.mp3', savedAt: 1 };
    const back = decodeWaveform(old)!;
    expect(back.bands).toBeUndefined();
    expect(Array.from(back.peaks)).toEqual([0, 1]);
  });

  it('ignores missing or unknown data', () => {
    expect(decodeWaveform(undefined)).toBeUndefined();
    expect(decodeWaveform({ v: 3 } as never)).toBeUndefined();
    expect(decodeWaveform({ v: 1, peaks: [1, 2], peaksPerSecond: 150 } as never)).toBeUndefined();
  });
});
