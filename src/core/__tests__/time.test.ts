import { describe, expect, it } from 'vitest';
import { snapTime } from '../time';

describe('snapTime', () => {
  // 120 BPM: a beat is 0.5 s, a bar 2 s.
  it('snaps to the nearest beat from the grid start', () => {
    expect(snapTime(10.2, 'beat', 120, 0.1)).toBeCloseTo(10.1);
    expect(snapTime(10.4, 'beat', 120, 0.1)).toBeCloseTo(10.6);
  });

  it('snaps to the nearest bar', () => {
    expect(snapTime(10.9, 'bar', 120, 0)).toBeCloseTo(10);
    expect(snapTime(11.1, 'bar', 120, 0)).toBeCloseTo(12);
    expect(snapTime(3.4, 'bar', 120, 0.25)).toBeCloseTo(4.25);
  });

  it('leaves the position alone when free or without a tempo', () => {
    expect(snapTime(10.37, 'off', 120, 0)).toBe(10.37);
    expect(snapTime(10.37, 'beat', undefined)).toBe(10.37);
    expect(snapTime(10.37, 'bar', 0)).toBe(10.37);
  });
});
