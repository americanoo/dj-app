/** Tempo helpers: fixing half / double-time BPM readings. */
import type { Track } from './model';
import { round } from './time';

/**
 * Halve (0.5) or double (2) a track's tempo, e.g. a reggaeton track read as
 * 192 instead of 96. Grid markers keep their positions; only the tempo between
 * them changes, so the first downbeat stays where it is.
 */
export function scaleTempo(
  t: Pick<Track, 'bpm' | 'beatGrid' | 'tempoFix'>,
  factor: number,
): Pick<Track, 'bpm' | 'beatGrid' | 'tempoFix'> {
  const fix = (t.tempoFix ?? 1) * factor;
  return {
    bpm: t.bpm ? round(t.bpm * factor, 3) : t.bpm,
    beatGrid: t.beatGrid?.map((g) => ({ ...g, bpm: round(g.bpm * factor, 3) })),
    tempoFix: fix === 1 ? undefined : fix,
  };
}

/**
 * When a re-import brings back the reading a BPM was fixed from (62 for a
 * track fixed to 124), keep the fix. A genuinely new value from the DJ
 * software (they fixed it there too, or changed it) wins as usual.
 */
export function keepTempoFix(existing: Track, merged: Track, incomingBpm: number | undefined): Track {
  const fix = existing.tempoFix;
  if (!fix || fix === 1 || !existing.bpm || !incomingBpm) return merged;
  if (Math.abs((incomingBpm * fix) / existing.bpm - 1) > 0.005) return merged;
  return {
    ...merged,
    bpm: existing.bpm,
    tempoFix: fix,
    // A grid taken from the import still has the old reading's tempo.
    beatGrid:
      merged.beatGrid && merged.beatGrid !== existing.beatGrid
        ? merged.beatGrid.map((g) => ({ ...g, bpm: round(g.bpm * fix, 3) }))
        : merged.beatGrid,
  };
}

/**
 * Percent tempo change from one track to the next, treating half- and
 * double-time as the same groove (96 -> 192 BPM mixes like 96 -> 96).
 */
export function effectiveBpmDelta(from: number, to: number): number {
  const candidates = [to, to / 2, to * 2].map((t) => ((t - from) / from) * 100);
  return candidates.reduce((best, d) => (Math.abs(d) < Math.abs(best) ? d : best));
}

/** The tempo range a library's BPMs should sit in. */
export interface TempoRange {
  /** Slowest believable BPM: anything below is read as half-time and doubled. */
  min: number;
  /** Fastest believable BPM: anything above is read as double-time and halved. */
  max: number;
}

export const DEFAULT_TEMPO_RANGE: TempoRange = { min: 80, max: 160 };

/** Genres that really live above 160 BPM (drum & bass, footwork…) use this range instead, so 174 stays 174 and a half-time 87 becomes 174. */
export const FAST_GENRE_RANGE: TempoRange = { min: 100, max: 200 };
const FAST_GENRES = /drum\s*(?:&|and|n|'n'|\+)?\s*bass|\bdnb\b|\bd&b\b|jungle|footwork|juke|hardcore|gabber|hardstyle|breakcore/i;

export function isFastGenre(genre: string | undefined): boolean {
  return !!genre && FAST_GENRES.test(genre);
}

/**
 * Power-of-two factor that brings a BPM into the range: ×2 (or ×4) for
 * half-time readings, ×½ for double-time ones. 1 when it already fits, or when
 * halving would drop it below the slowest tempo.
 */
export function tempoFactor(bpm: number, range: TempoRange): number {
  if (!(bpm > 0)) return 1;
  let f = 1;
  while (bpm * f < range.min && f < 8) f *= 2;
  while (bpm * f > range.max && (bpm * f) / 2 >= range.min && f > 1 / 8) f /= 2;
  return f;
}

export interface TempoFix {
  trackId: string;
  from: number;
  to: number;
  factor: number;
}

/**
 * Every track whose BPM looks like a half- or double-time reading, with the
 * fix. Tracks the DJ said to keep as they are are left out unless asked for.
 */
export function findTempoFixes(
  tracks: Iterable<Track>,
  range: TempoRange = DEFAULT_TEMPO_RANGE,
  includeConfirmed = false,
): TempoFix[] {
  const out: TempoFix[] = [];
  for (const t of tracks) {
    if (!t.bpm || (t.bpmConfirmed && !includeConfirmed)) continue;
    const r = isFastGenre(t.genre)
      ? { min: Math.max(range.min, FAST_GENRE_RANGE.min), max: Math.max(range.max, FAST_GENRE_RANGE.max) }
      : range;
    const factor = tempoFactor(t.bpm, r);
    if (factor !== 1) out.push({ trackId: t.id, from: t.bpm, to: round(t.bpm * factor, 3), factor });
  }
  return out;
}
