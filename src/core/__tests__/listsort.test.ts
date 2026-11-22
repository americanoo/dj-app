import { describe, expect, it } from 'vitest';
import { camelotOrder, harmonicOrder, keysMix, matchesFilter, sortTracks, tempoFits } from '../listsort';

const t = (id: string, key?: string, bpm?: number, duration?: number) => ({ id, title: id, artist: `art ${id}`, key, bpm, duration });

describe('sorting music lists', () => {
  it('by key around the Camelot wheel, unknown keys last', () => {
    expect(camelotOrder('Am')).toBe(camelotOrder('8A'));
    const sorted = sortTracks([t('x'), t('b', '9A'), t('a', '8B'), t('c', '8A')], 'key');
    expect(sorted.map((x) => x.id)).toEqual(['c', 'a', 'b', 'x']);
  });

  it('by BPM either way, missing BPMs last; by title A–Z or Z–A', () => {
    const list = [t('b', undefined, 128), t('a', undefined, 122), t('c')];
    expect(sortTracks(list, 'bpm').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(sortTracks(list, 'bpm', true).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(sortTracks(list, 'title', true).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(sortTracks(list, 'added', true).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('filtering music lists', () => {
  it('a BPM range counts half and double time', () => {
    expect(matchesFilter(t('a', undefined, 87), { bpmMin: 170, bpmMax: 176 })).toBe(true);
    expect(matchesFilter(t('a', undefined, 124), { bpmMin: 120, bpmMax: 122 })).toBe(false);
    expect(matchesFilter(t('a'), { bpmMin: 120 })).toBe(false);
    expect(matchesFilter(t('a', undefined, 122), { bpmMin: 123 })).toBe(false); // not as 244
  });

  it('a key, or the keys that mix with it', () => {
    expect(matchesFilter(t('a', 'Am'), { key: '8A' })).toBe(true);
    expect(matchesFilter(t('a', '9A'), { key: '8A' })).toBe(false);
    expect(matchesFilter(t('a', '9A'), { key: '8A', mixable: true })).toBe(true);
    expect(matchesFilter(t('a', '8B'), { key: '8A', mixable: true })).toBe(true);
    expect(matchesFilter(t('a', '2A'), { key: '8A', mixable: true })).toBe(false);
    expect(keysMix('8A', '7B')).toBe(true);
  });

  it('fits after a track: a key that mixes and within 6% tempo', () => {
    const after = { key: '8A', bpm: 124 };
    expect(matchesFilter(t('a', '9A', 126), { fitsAfter: after })).toBe(true);
    expect(matchesFilter(t('a', '9A', 134), { fitsAfter: after })).toBe(false);
    expect(matchesFilter(t('a', '3B', 124), { fitsAfter: after })).toBe(false);
    expect(tempoFits(124, 63)).toBe(true);
  });

  it('in the night or not', () => {
    const night = (id: string) => id === 'a';
    expect(matchesFilter(t('a'), { inNight: false }, night)).toBe(false);
    expect(matchesFilter(t('b'), { inNight: false }, night)).toBe(true);
  });
});

describe('arranging a night harmonically', () => {
  it('walks to keys that mix, nearest tempo first', () => {
    const order = harmonicOrder([t('start', '8A', 122), t('far', '2B', 123), t('next', '9A', 124), t('then', '10A', 126)]);
    expect(order.map((x) => x.id)).toEqual(['start', 'next', 'then', 'far']);
  });
});
