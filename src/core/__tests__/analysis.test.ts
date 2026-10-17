import { describe, expect, it } from 'vitest';
import { analyseBands, maxPeak, sampleAt } from '../analysis';

const SR = 44100;
const tone = (freq: number, seconds: number, amp = 0.8) =>
  Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));

const avg = (a: Float32Array) => a.slice(10).reduce((s, v) => s + v, 0) / (a.length - 10);

describe('three-band analysis', () => {
  it('puts a kick-drum frequency in the low band', () => {
    const b = analyseBands([tone(55, 1)], SR, 150);
    expect(avg(b.low)).toBeGreaterThan(avg(b.mid) * 2);
    expect(avg(b.low)).toBeGreaterThan(avg(b.high) * 5);
  });

  it('puts a vocal-range frequency in the mid band', () => {
    const b = analyseBands([tone(700, 1)], SR, 150);
    expect(avg(b.mid)).toBeGreaterThan(avg(b.low));
    expect(avg(b.mid)).toBeGreaterThan(avg(b.high));
  });

  it('puts hi-hat frequencies in the high band', () => {
    const b = analyseBands([tone(9000, 1)], SR, 150);
    expect(avg(b.high)).toBeGreaterThan(avg(b.mid) * 2);
    expect(avg(b.high)).toBeGreaterThan(avg(b.low) * 10);
  });

  it('mixes channels down and reports overall peaks at the requested rate', () => {
    const left = tone(440, 1, 0.5);
    const right = tone(440, 1, 0.5);
    const b = analyseBands([left, right], SR, 150);
    expect(b.peaks.length).toBe(Math.ceil(SR / Math.floor(SR / 150)));
    expect(b.peaksPerSecond).toBeCloseTo(150, 0);
    expect(maxPeak(b.peaks)).toBeCloseTo(0.5, 2);
  });

  it('handles silence and empty input', () => {
    expect(maxPeak(analyseBands([new Float32Array(SR)], SR, 150).peaks)).toBe(0);
    expect(analyseBands([new Float32Array(0)], SR, 150).peaks.length).toBe(0);
  });
});

describe('sampleAt', () => {
  it('blends neighbouring buckets when zoomed in', () => {
    const a = Float32Array.from([0, 1, 0.5]);
    expect(sampleAt(a, 0.5)).toBeCloseTo(0.5);
    expect(sampleAt(a, 1.5)).toBeCloseTo(0.75);
    expect(sampleAt(a, -3)).toBe(0);
    expect(sampleAt(a, 10)).toBe(0.5);
  });
});
