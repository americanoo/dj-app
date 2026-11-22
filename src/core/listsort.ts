/**
 * Sorting and filtering music lists (the phone's library and night): by title,
 * artist, BPM, key on the Camelot wheel or length, and filters for a BPM range,
 * a key (and the keys that mix with it), what fits after a track, and whether a
 * track is in the night.
 */
import { keyRelation, toCamelot } from './keys';
import type { Track } from './model';
import { effectiveBpmDelta } from './tempo';

export type SortKey = 'added' | 'title' | 'artist' | 'bpm' | 'key' | 'length';
export const SORT_KEYS: { id: SortKey; label: string }[] = [
  { id: 'added', label: 'added' },
  { id: 'title', label: 'title' },
  { id: 'artist', label: 'artist' },
  { id: 'bpm', label: 'bpm' },
  { id: 'key', label: 'key' },
  { id: 'length', label: 'length' },
];

export interface ListFilter {
  /** BPM range, inclusive (half / double time counts: 87 is in 170–180). */
  bpmMin?: number;
  bpmMax?: number;
  /** Camelot key, e.g. "8A"; with `mixable`, the keys that mix with it too. */
  key?: string;
  mixable?: boolean;
  /** Only tracks that mix after this one: a compatible key and within 6% tempo. */
  fitsAfter?: Pick<Track, 'key' | 'bpm'>;
  /** In the night or not (`undefined`: both). */
  inNight?: boolean;
  /** The night only: tracks whose way in is rough (keys that don't mix, or more than 6% tempo). */
  rough?: boolean;
}

/** Position on the Camelot wheel: 1A, 1B, 2A, 2B … so neighbours sort together. Unknown keys last. */
export function camelotOrder(key: string | undefined): number {
  const c = toCamelot(key);
  if (!c) return 1000;
  return (Number(c.slice(0, -1)) - 1) * 2 + (c.endsWith('B') ? 1 : 0);
}

/** Keys that mix: the same key, its neighbours on the wheel, the relative major/minor, and the diagonals. */
export function keysMix(a: string | undefined, b: string | undefined): boolean {
  return ['same', 'adjacent', 'relative', 'diagonal'].includes(keyRelation(a, b));
}

/** Tempo within `pct` percent, counting half and double time as the same groove. */
export function tempoFits(a: number | undefined, b: number | undefined, pct = 6): boolean {
  if (!a || !b) return false;
  return Math.abs(effectiveBpmDelta(a, b)) <= pct;
}

function inBpmRange(bpm: number | undefined, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true;
  if (!bpm) return false;
  const lo = min ?? 0;
  const hi = max ?? Infinity;
  // Half and double time only count against a closed range ("over 123" means 123 and up, not 61.5).
  const candidates = min !== undefined && max !== undefined ? [bpm, bpm * 2, bpm / 2] : [bpm];
  return candidates.some((b) => b >= lo - 0.05 && b <= hi + 0.05);
}

export function matchesFilter(t: Pick<Track, 'key' | 'bpm' | 'id'>, f: ListFilter, inNight?: (id: string) => boolean): boolean {
  if (!inBpmRange(t.bpm, f.bpmMin, f.bpmMax)) return false;
  if (f.key) {
    const c = toCamelot(t.key);
    if (!c) return false;
    if (f.mixable ? !keysMix(f.key, t.key) : c !== toCamelot(f.key)) return false;
  }
  if (f.fitsAfter && !(keysMix(f.fitsAfter.key, t.key) && tempoFits(f.fitsAfter.bpm, t.bpm))) return false;
  if (f.inNight !== undefined && inNight && inNight(t.id) !== f.inNight) return false;
  return true;
}

export function filterActive(f: ListFilter): number {
  return [f.bpmMin !== undefined || f.bpmMax !== undefined, !!f.key, !!f.fitsAfter, f.inNight !== undefined, !!f.rough].filter(Boolean).length;
}

/** Tracks in order. `added` keeps the order they came in. Tracks missing the value go last either way. */
export function sortTracks<T extends Pick<Track, 'title' | 'artist' | 'bpm' | 'key' | 'duration'>>(tracks: T[], by: SortKey, desc = false): T[] {
  if (by === 'added') return desc ? [...tracks].reverse() : tracks;
  const text = (a: string, b: string) => (a || '￿').localeCompare(b || '￿', undefined, { sensitivity: 'base', numeric: true });
  const num = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
    return desc ? b - a : a - b;
  };
  const out = [...tracks];
  out.sort((a, b) => {
    switch (by) {
      case 'title':
        return (desc ? -1 : 1) * text(a.title, b.title) || text(a.artist, b.artist);
      case 'artist':
        return (desc ? -1 : 1) * text(a.artist, b.artist) || text(a.title, b.title);
      case 'bpm':
        return num(a.bpm, b.bpm) || text(a.title, b.title);
      case 'key': {
        const ka = camelotOrder(a.key);
        const kb = camelotOrder(b.key);
        return num(ka === 1000 ? undefined : ka, kb === 1000 ? undefined : kb) || num(a.bpm, b.bpm);
      }
      case 'length':
        return num(a.duration, b.duration) || text(a.title, b.title);
    }
    return 0;
  });
  return out;
}

/**
 * An order for a night that mixes smoothly: from the first track, each next one
 * is the closest that mixes (compatible key, nearest tempo); when none does,
 * the nearest tempo.
 */
export function harmonicOrder<T extends Pick<Track, 'key' | 'bpm'>>(tracks: T[]): T[] {
  if (tracks.length < 3) return tracks;
  const left = tracks.slice(1);
  const out = [tracks[0]];
  while (left.length) {
    const cur = out[out.length - 1];
    const dist = (t: T) => (cur.bpm && t.bpm ? Math.abs(effectiveBpmDelta(cur.bpm, t.bpm)) : 50);
    let best = -1;
    left.forEach((t, i) => {
      if (best < 0) return (best = i);
      const better = Number(keysMix(cur.key, t.key)) - Number(keysMix(cur.key, left[best].key)) || dist(left[best]) - dist(t);
      if (better > 0) best = i;
    });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}
