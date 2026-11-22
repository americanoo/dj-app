/**
 * Effects on a track itself (the phone's keyframe tools), on top of the
 * transitions' own curves:
 *
 * - keyframe regions: a start and an end keyframe in the song with the tools
 *   chosen for them (echo, reverb and filter build up across the region and let
 *   go at its end; kill lows, acapella and instrumental are on throughout);
 * - end FX: echo out, filter out or kill lows as the track reaches its end time;
 * - stem levels: vocals and instrumental, as keyframes through the song.
 *
 * Until real stems exist (lalal.ai), acapella, instrumental and the stem levels
 * are previewed with EQ: vocals sit mostly in the mids, so "acapella" cuts the
 * lows and highs and "instrumental" scoops the mids.
 */
import { emptyCurves, type Curves, type Env } from './mixplan';
import type { Cue, Track } from './model';
import { uid } from './model';

export type FxTool = 'echo' | 'reverb' | 'filter' | 'killLows' | 'acapella' | 'instrumental';
export const FX_TOOLS: { id: FxTool; label: string; hint: string }[] = [
  { id: 'echo', label: 'echo out', hint: 'A beat-long echo builds up across the keyframes' },
  { id: 'reverb', label: 'reverb out', hint: 'The track washes into reverb across the keyframes' },
  { id: 'filter', label: 'filter', hint: 'A high-pass filter sweeps up across the keyframes, then lets go' },
  { id: 'killLows', label: 'kill lows', hint: 'The bass is cut between the keyframes' },
  { id: 'acapella', label: 'acapella', hint: 'Vocals only between the keyframes (EQ preview until stems)' },
  { id: 'instrumental', label: 'instrumental', hint: 'No vocals between the keyframes (EQ preview until stems)' },
];

/** A start and (once set) an end keyframe, in seconds into the song, and what they do. */
export interface FxRegion {
  id: string;
  from: number;
  to?: number;
  tools: FxTool[];
}

/** Effects as the track reaches its end time. */
export type EndFx = 'echo' | 'filter' | 'killLows';
export const END_FX: { id: EndFx; short: string; label: string }[] = [
  { id: 'echo', short: 'eo', label: 'echo out at end time' },
  { id: 'filter', short: 'fo', label: 'filter out at end time' },
  { id: 'killLows', short: 'kl', label: 'kill lows at end time' },
];

/** Vocals and instrumental levels (0–1) from a moment in the song on. */
export interface StemKey {
  t: number;
  vocals: number;
  inst: number;
}

export const newRegion = (from: number): FxRegion => ({ id: uid('fx'), from, tools: [] });

const KILL = -40;
const toDb = (level: number) => Math.max(KILL, 20 * Math.log10(Math.max(0.01, level)));

/** What a slot needs to place its own effects in the night. */
export interface FxPlacement {
  startsAt: number;
  playFor: number;
  mixIn: number;
  bpm?: number;
  /** Played faster (>1) or slower than recorded: song moments are this much closer together in the night. */
  stretch?: number;
  fx?: FxRegion[];
  endFx?: EndFx[];
  stems?: StemKey[];
}

/**
 * A slot's own effects as curves in night time (a song moment `s` plays at
 * startsAt + s - mixIn; tempo riding aside), to merge with its transitions'.
 */
export function trackFxCurves(p: FxPlacement): Curves {
  const c = emptyCurves();
  const r = p.stretch ?? 1;
  const at = (songT: number) => p.startsAt + (songT - p.mixIn) / r;
  const bar = (p.bpm ? 60 / p.bpm : 0.5) * 4;
  const beat = bar / 4;
  const ramp = (env: Env, a: number, b: number, v: number) => env.push({ t: a, v: 0 }, { t: Math.max(a + 0.05, b), v }, { t: b + 0.03, v: 0 });
  const hold = (env: Env, a: number, b: number, v: number) => env.push({ t: a, v: 0 }, { t: a + Math.min(beat, (b - a) / 4), v }, { t: b, v }, { t: b + 0.03, v: 0 });
  for (const r of p.fx ?? []) {
    const a = at(r.from);
    const b = at(r.to ?? r.from + 4 * bar);
    if (b <= a) continue;
    for (const tool of r.tools) {
      if (tool === 'echo') ramp(c.echo, a, b, 0.8);
      if (tool === 'reverb') ramp(c.reverb, a, b, 0.9);
      if (tool === 'filter') ramp(c.filter, a, b, 0.85);
      if (tool === 'killLows') hold(c.bass, a, b, KILL);
      if (tool === 'acapella') {
        hold(c.bass, a, b, KILL);
        hold(c.high, a, b, -18);
      }
      if (tool === 'instrumental') hold(c.mid, a, b, -24);
    }
  }
  const end = p.startsAt + p.playFor;
  for (const fx of p.endFx ?? []) {
    if (fx === 'echo') c.echo.push({ t: end - 4 * bar, v: 0 }, { t: end, v: 0.8 });
    if (fx === 'filter') c.filter.push({ t: end - 4 * bar, v: 0 }, { t: end, v: 0.85 });
    if (fx === 'killLows') c.bass.push({ t: end - 2 * bar, v: 0 }, { t: end - 2 * bar + 0.05, v: KILL });
  }
  for (const k of [...(p.stems ?? [])].sort((x, y) => x.t - y.t)) {
    const t = at(k.t);
    c.mid.push({ t, v: toDb(k.vocals) });
    c.bass.push({ t, v: toDb(k.inst) });
    c.high.push({ t, v: toDb(k.inst) });
  }
  for (const env of Object.values(c) as Env[]) env.sort((x, y) => x.t - y.t);
  return c;
}

/** Stem levels at a moment in the song (the last keyframe before it; full before the first). */
export function stemsAt(stems: StemKey[] | undefined, t: number): { vocals: number; inst: number } {
  const before = [...(stems ?? [])].sort((x, y) => x.t - y.t).filter((k) => k.t <= t + 1e-6).pop();
  return before ? { vocals: before.vocals, inst: before.inst } : { vocals: 1, inst: 1 };
}

/** A track's default play-from / play-until, kept as "Mix in" / "Mix out" memory cues (used when it goes into a night). */
export function trackMixCue(track: Track, which: 'in' | 'out'): Cue | undefined {
  const name = which === 'in' ? 'Mix in' : 'Mix out';
  return track.cues.find((c) => c.kind === 'cue' && c.slot === null && c.name === name);
}

/**
 * Set a track's default play-from (`in`) or play-until (`out`) in the library:
 * its "Mix in" / "Mix out" memory cue is moved, or added. `undefined` removes it.
 */
export function setTrackMixPoint(track: Track, which: 'in' | 'out', at: number | undefined): Cue[] {
  const current = trackMixCue(track, which);
  if (at === undefined) return current ? track.cues.filter((c) => c.id !== current.id) : track.cues;
  const start = Math.max(0, at);
  if (current) return track.cues.map((c) => (c.id === current.id ? { ...c, start, edited: true } : c));
  const cue: Cue = {
    id: uid('cue'),
    kind: 'cue',
    slot: null,
    start,
    name: which === 'in' ? 'Mix in' : 'Mix out',
    color: which === 'in' ? '#2d6bff' : '#ff2e2e',
    origin: 'manual',
  };
  return [...track.cues, cue];
}
