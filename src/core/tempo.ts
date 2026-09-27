/** Tempo helpers: fixing half / double-time BPM readings. */
import type { Track } from './model';
import { round } from './time';

/**
 * Halve (0.5) or double (2) a track's tempo, e.g. a reggaeton track read as
 * 192 instead of 96. Grid markers keep their positions; only the tempo between
 * them changes, so the first downbeat stays where it is.
 */
export function scaleTempo(t: Pick<Track, 'bpm' | 'beatGrid'>, factor: 0.5 | 2): Pick<Track, 'bpm' | 'beatGrid'> {
  return {
    bpm: t.bpm ? round(t.bpm * factor, 3) : t.bpm,
    beatGrid: t.beatGrid?.map((g) => ({ ...g, bpm: round(g.bpm * factor, 3) })),
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
