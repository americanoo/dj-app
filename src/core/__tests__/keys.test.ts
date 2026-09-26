import { describe, expect, it } from 'vitest';
import { fromTraktorKeyValue, keyRelation, normaliseKey, toCamelot, toOpenKey, toTraktorKeyValue } from '../keys';
import { barBeatLabel, formatTime, parseTime, snapToBeat } from '../time';

describe('keys', () => {
  it.each([
    ['C', '8B', '1d'],
    ['Am', '8A', '1m'],
    ['G', '9B', '2d'],
    ['F#m', '11A', '4m'],
    ['Db', '3B', '8d'],
    ['Bbm', '3A', '8m'],
    ['B', '1B', '6d'],
    ['G#m', '1A', '6m'],
  ])('%s is %s / %s', (std, camelot, open) => {
    expect(toCamelot(std)).toBe(camelot);
    expect(toOpenKey(std)).toBe(open);
    expect(normaliseKey(camelot)).toBe(std);
    expect(normaliseKey(open)).toBe(std);
  });

  it('parses alternate spellings', () => {
    expect(normaliseKey('A minor')).toBe('Am');
    expect(normaliseKey('C#')).toBe('Db');
    expect(normaliseKey('Ebmin')).toBe('Ebm');
    expect(normaliseKey('mystery')).toBe('mystery');
  });

  it('maps Traktor key values', () => {
    expect(fromTraktorKeyValue(0)).toBe('C');
    expect(fromTraktorKeyValue(21)).toBe('Am');
    expect(toTraktorKeyValue('Am')).toBe(21);
    expect(toTraktorKeyValue('F#')).toBe(6);
  });

  it('rates harmonic transitions', () => {
    expect(keyRelation('Am', '8A')).toBe('same');
    expect(keyRelation('Am', 'Em')).toBe('adjacent');
    expect(keyRelation('Am', 'C')).toBe('relative');
    expect(keyRelation('Am', 'Bm')).toBe('boost');
    expect(keyRelation('Am', 'F')).toBe('diagonal');
    expect(keyRelation('Am', 'G')).toBe('diagonal');
    expect(keyRelation('Am', 'F#')).toBe('clash');
    expect(keyRelation('Am', undefined)).toBe('unknown');
  });
});

describe('time', () => {
  it('formats and parses', () => {
    expect(formatTime(63.066)).toBe('1:03.066');
    expect(formatTime(63.066, false)).toBe('1:03');
    expect(parseTime('1:03.066')).toBeCloseTo(63.066);
    expect(parseTime('90')).toBe(90);
    expect(parseTime('nope')).toBeUndefined();
  });

  it('snaps to the beat grid', () => {
    // 120 BPM -> 0.5s beats, grid at 0.1
    expect(snapToBeat(1.34, 120, 0.1)).toBeCloseTo(1.1);
    expect(barBeatLabel(0.1, 120, 0.1)).toBe('1.1');
    expect(barBeatLabel(2.1, 120, 0.1)).toBe('2.1');
    expect(barBeatLabel(2.6, 120, 0.1)).toBe('2.2');
  });
});
