import { describe, expect, it } from 'vitest';
import { detectSections } from '../sections';

const PPS = 10;
const BPM = 120; // 2 s bars, 16 s phrases

/** Synthetic band data from a list of [bars, bass 0..1, top 0..1] parts. */
function track(parts: [number, number, number][]) {
  const seconds = parts.reduce((n, [bars]) => n + bars * 2, 0);
  const n = seconds * PPS;
  const low = new Float32Array(n);
  const mid = new Float32Array(n);
  const high = new Float32Array(n);
  let i = 0;
  for (const [bars, bass, top] of parts) {
    for (let k = 0; k < bars * 2 * PPS; k++, i++) {
      low[i] = bass;
      mid[i] = top / 2;
      high[i] = top / 2;
    }
  }
  return { bands: { low, mid, high }, duration: seconds };
}

const summary = (s: ReturnType<typeof detectSections>) => s.map((x) => `${x.kind} ${x.start}-${x.end}`);

describe('section detection', () => {
  it('finds intro, main, breakdown, build, drop and outro on phrase boundaries', () => {
    const { bands, duration } = track([
      [16, 0.05, 0.3], // intro: no bass
      [32, 0.8, 0.5], // main groove
      [16, 0.05, 0.2], // breakdown
      [8, 0.1, 0.6], // build: busier highs, still no bass
      [32, 0.9, 0.6], // drop
      [16, 0.05, 0.3], // outro
    ]);
    expect(summary(detectSections(bands, PPS, duration, BPM, 0))).toEqual([
      'intro 0-32',
      'main 32-96',
      'breakdown 96-128',
      'build 128-144',
      'drop 144-208',
      'outro 208-240',
    ]);
  });

  it('ignores a single bar of missing bass inside a groove', () => {
    const { bands, duration } = track([
      [8, 0.8, 0.5],
      [1, 0.0, 0.5], // one-bar drop-out
      [7, 0.8, 0.5],
      [8, 0.8, 0.5],
    ]);
    expect(summary(detectSections(bands, PPS, duration, BPM, 0))).toEqual(['main 0-48']);
  });

  it('works without a BPM using 16-second blocks', () => {
    const { bands, duration } = track([
      [8, 0.05, 0.3], // 16 s
      [16, 0.8, 0.5], // 32 s
      [8, 0.05, 0.3],
    ]);
    expect(summary(detectSections(bands, PPS, duration))).toEqual(['intro 0-16', 'main 16-48', 'outro 48-64']);
  });

  it('treats a track with no bass at all as one part, and handles empty data', () => {
    const { bands, duration } = track([[16, 0, 0.4]]);
    expect(summary(detectSections(bands, PPS, duration, BPM))).toEqual(['main 0-32']);
    expect(detectSections({ low: new Float32Array(0), mid: new Float32Array(0), high: new Float32Array(0) }, PPS, 0)).toEqual([]);
  });

  it('follows the beat grid when the first downbeat is late', () => {
    // 1 s of silence before bar 1: phrases start at 1, 17, 33...
    const pre = track([[0.5, 0, 0]]);
    const rest = track([
      [8, 0.05, 0.3],
      [8, 0.9, 0.5],
    ]);
    const cat = (a: Float32Array, b: Float32Array) => Float32Array.from([...a, ...b]);
    const bands = { low: cat(pre.bands.low, rest.bands.low), mid: cat(pre.bands.mid, rest.bands.mid), high: cat(pre.bands.high, rest.bands.high) };
    expect(summary(detectSections(bands, PPS, 33, BPM, 1))).toEqual(['intro 0-17', 'main 17-33']);
  });
});
