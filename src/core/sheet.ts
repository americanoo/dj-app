/**
 * The Sheet: the night as numbers. Mix points, cues, loops and transition FX
 * set by typing times instead of on waveforms, for DJs who already know their
 * marks (and for phones, where numbers beat dragging).
 */
import { CUE_COLORS, uid, type Cue, type SetEntry, type Track } from './model';
import type { AutoParam, DeckAutomation, Keyframe, TransitionAutomation } from './mixplan';

export const MIX_IN_NAME = 'Mix in';
export const MIX_OUT_NAME = 'Mix out';

/**
 * Where a night entry starts (`in`) or stops (`out`) playing, by its time in the
 * song. Kept as a memory cue named "Mix in" / "Mix out" (so it's exported like any
 * other cue): moved if the entry already has its own, otherwise added. A hot cue
 * or a cue another entry also uses is never moved. `undefined` clears the point
 * (from the start / to the end). Setting the out point drops a loop ending.
 */
export function setMixPoint(
  track: Track,
  entry: SetEntry,
  which: 'in' | 'out',
  at: number | undefined,
  entries: SetEntry[],
): { cues: Cue[]; patch: Partial<SetEntry> } {
  const key = which === 'in' ? 'mixInCueId' : 'mixOutCueId';
  const name = which === 'in' ? MIX_IN_NAME : MIX_OUT_NAME;
  const extra: Partial<SetEntry> = which === 'out' ? { endLoop: undefined } : {};
  if (at === undefined) return { cues: track.cues, patch: { [key]: undefined, ...extra } };
  const start = Math.max(0, at);
  const current = track.cues.find((c) => c.id === entry[key]);
  const shared =
    current &&
    entries.some((e) => e.id !== entry.id && e.trackId === entry.trackId && (e.mixInCueId === current.id || e.mixOutCueId === current.id));
  if (current && current.kind === 'cue' && current.slot === null && current.name === name && !shared) {
    return { cues: track.cues.map((c) => (c.id === current.id ? { ...c, start } : c)), patch: extra };
  }
  const cue: Cue = { id: uid('cue'), kind: 'cue', slot: null, start, name, color: CUE_COLORS[which === 'in' ? 2 : 3], origin: 'manual' };
  return { cues: [...track.cues, cue], patch: { [key]: cue.id, ...extra } };
}

/** A new cue (on the next free pad) or loop (4 beats, a stored loop) at `start`. */
export function newCue(cues: Cue[], kind: 'cue' | 'loop', start: number, bpm?: number): Cue {
  if (kind === 'loop') {
    const len = bpm ? 240 / bpm : 4;
    return { id: uid('cue'), kind: 'loop', slot: null, start, end: start + len, name: '', color: CUE_COLORS[1], origin: 'manual' };
  }
  const used = new Set(cues.map((c) => c.slot));
  const slot = [0, 1, 2, 3, 4, 5, 6, 7].find((s) => !used.has(s)) ?? null;
  return { id: uid('cue'), kind: 'cue', slot, start, name: '', color: CUE_COLORS[slot ?? 0], origin: 'manual' };
}

/** The transition effects the Sheet switches on and off. Each writes keyframes on one deck. */
export type SheetFx = 'echoOut' | 'reverbOut' | 'filterOut' | 'filterIn';

export const SHEET_FX: { id: SheetFx; label: string; deck: 'a' | 'b'; param: AutoParam; hint: string }[] = [
  { id: 'echoOut', label: 'Echo out', deck: 'a', param: 'echo', hint: 'The outgoing track’s echo rises over its last 4 bars' },
  { id: 'reverbOut', label: 'Reverb out', deck: 'a', param: 'reverb', hint: 'The outgoing track washes into reverb over its last 4 bars' },
  { id: 'filterOut', label: 'Filter out', deck: 'a', param: 'filter', hint: 'The outgoing track thins out (high-pass) over its last 4 bars' },
  { id: 'filterIn', label: 'Filter in', deck: 'b', param: 'filter', hint: 'The incoming track starts muffled (low-pass) and opens up' },
];

const fxInfo = (fx: SheetFx) => SHEET_FX.find((f) => f.id === fx)!;

/** Whether an effect is on: its deck has keyframes for its parameter (set here or drawn in the Mix view). */
export function fxIsOn(auto: TransitionAutomation | undefined, fx: SheetFx): boolean {
  const f = fxInfo(fx);
  return !!auto?.[f.deck]?.[f.param]?.length;
}

/**
 * The keyframes for an effect, in seconds from where the incoming track comes in.
 * `overlap`: how long the two tracks play together (the outgoing one ends at
 * `overlap`); `bar`: one bar, seconds.
 */
export function fxKeyframes(fx: SheetFx, overlap: number, bar: number): Keyframe[] {
  const end = overlap;
  const from = end - 4 * bar;
  switch (fx) {
    case 'echoOut':
      return [
        { t: from, v: 0 },
        { t: end, v: 0.8 },
      ];
    case 'reverbOut':
      return [
        { t: from, v: 0 },
        { t: end, v: 0.9 },
      ];
    case 'filterOut':
      return [
        { t: from, v: 0 },
        { t: end, v: 0.85 },
      ];
    case 'filterIn':
      return [
        { t: 0, v: -0.85 },
        { t: Math.max(4 * bar, Math.min(8 * bar, overlap)), v: 0 },
      ];
  }
}

/** The transition's automation with an effect switched on or off. */
export function withFx(
  auto: TransitionAutomation | undefined,
  fx: SheetFx,
  on: boolean,
  overlap: number,
  bar: number,
): TransitionAutomation | undefined {
  const f = fxInfo(fx);
  const deck: DeckAutomation = { ...(auto?.[f.deck] ?? {}) };
  if (on) deck[f.param] = fxKeyframes(fx, overlap, bar);
  else delete deck[f.param];
  const next: TransitionAutomation = { ...(auto ?? {}), [f.deck]: Object.keys(deck).length ? deck : undefined };
  if (!next.a) delete next.a;
  if (!next.b) delete next.b;
  return next.a || next.b ? next : undefined;
}

/** "5:07" or, with a fraction, "5:07.8". */
export function formatShort(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return '';
  const neg = sec < 0;
  const tenths = Math.round(Math.abs(sec) * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const d = tenths % 10;
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}${d ? `.${d}` : ''}`;
}

/**
 * A time typed on the sheet, forgivingly: "2:08", "2:08.5", "2 08", or digits
 * only from a phone's number pad, where the last two are seconds ("208" is
 * 2:08, "45" is 0:45). Undefined when it can't be read.
 */
export function parseSheetTime(input: string): number | undefined {
  const s = input.trim().replace(',', '.');
  if (!s) return undefined;
  if (/[:\s]/.test(s)) {
    const parts = s.split(/[:\s]+/);
    if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return undefined;
    if (parts.slice(1).some((p) => Number(p) >= 60)) return undefined;
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  }
  const m = /^(\d+)(\.\d+)?$/.exec(s);
  if (!m) return undefined;
  const [, whole, frac = ''] = m;
  if (whole.length <= 2) return Number(whole + frac);
  const secs = Number(whole.slice(-2) + frac);
  if (secs >= 60) return undefined;
  return Number(whole.slice(0, -2)) * 60 + secs;
}
