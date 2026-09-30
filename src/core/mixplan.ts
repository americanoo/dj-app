/**
 * How the night is mixed, as automation curves the player follows.
 *
 * Tempo: during a transition the outgoing track rides its tempo into the
 * incoming one's over the bars before it comes in (like a DJ riding the pitch
 * fader), and holds it through the blend, so the beats lock. The incoming
 * track always plays at its own tempo, so its cues and the next transition
 * stay exactly where they were planned. Speeding a track up this way raises
 * its pitch a little, as on a turntable.
 *
 * Blend: how the two tracks share the overlap, from a straight blend (both at
 * full level) to a crossfade, a bass swap (the classic house and techno blend:
 * the incoming track comes in without its bass, then the basses swap on a bar)
 * or an echo out at the out point.
 */

export type BlendStyle = 'straight' | 'crossfade' | 'bassSwap' | 'echo';

export const BLEND_STYLES: { id: BlendStyle; label: string; hint: string }[] = [
  { id: 'bassSwap', label: 'Bass swap', hint: 'The incoming track comes in without its bass; halfway through, on a bar, the basses swap and the outgoing track fades.' },
  { id: 'crossfade', label: 'Crossfade', hint: 'An even crossfade across the whole overlap.' },
  { id: 'straight', label: 'Straight', hint: 'Both tracks at full level until the outgoing one ends.' },
  { id: 'echo', label: 'Echo out', hint: 'Both at full level, then the outgoing track echoes out at its out point.' },
];

/** A curve through (time, value) points: straight lines between them, flat before the first and after the last. */
export interface EnvPoint {
  t: number;
  v: number;
}
export type Env = EnvPoint[];

/** Bars the outgoing track takes to ride into the incoming tempo. */
export const RIDE_BARS = 8;
/** Furthest a track is pitched to sync (a CDJ's ±16% range). */
export const MAX_PITCH = 0.16;
/** Bass cut on a DJ mixer's low EQ, in dB. */
export const BASS_KILL_DB = -40;
/** Transitions shorter than this (in bars) default to a straight blend. */
const SHORT_BLEND_BARS = 2;

export function valueAt(env: Env, t: number, dflt: number): number {
  if (!env.length) return dflt;
  if (t <= env[0].t) return env[0].v;
  const last = env[env.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < env.length - 1; i++) {
    const p = env[i];
    const q = env[i + 1];
    if (t >= p.t && t < q.t) return q.t === p.t ? q.v : p.v + ((t - p.t) / (q.t - p.t)) * (q.v - p.v);
  }
  return last.v;
}

/** The area under a curve between two times (for a playback-rate curve: how far the track moves). */
export function integrate(env: Env, from: number, to: number, dflt = 1): number {
  if (to < from) return -integrate(env, to, from, dflt);
  const cuts = [from, ...env.map((p) => p.t).filter((t) => t > from && t < to), to];
  let sum = 0;
  // Straight between breakpoints, so the midpoint value is exact.
  for (let i = 0; i < cuts.length - 1; i++) sum += (cuts[i + 1] - cuts[i]) * valueAt(env, (cuts[i] + cuts[i + 1]) / 2, dflt);
  return sum;
}

/**
 * The playback rate that brings the outgoing track's beats onto the incoming
 * track's tempo, allowing for half and double time. Undefined when either BPM is
 * unknown or it would take more than MAX_PITCH.
 */
export function syncRate(bpmOut: number | undefined, bpmIn: number | undefined): number | undefined {
  if (!bpmOut || !bpmIn || bpmOut <= 0 || bpmIn <= 0) return undefined;
  const r = [bpmIn / bpmOut, bpmIn / (2 * bpmOut), (2 * bpmIn) / bpmOut].reduce((best, x) =>
    Math.abs(x - 1) < Math.abs(best - 1) ? x : best,
  );
  return Math.abs(r - 1) <= MAX_PITCH ? r : undefined;
}

export interface MixTrack {
  startsAt: number;
  playFor: number;
  mixIn: number;
  bpm?: number;
  gridStart?: number;
}

export interface TransitionPlan {
  /** The style that plays (a bass swap or crossfade needs an overlap; without one it's straight). */
  style: BlendStyle;
  /** What was chosen for this transition, if anything (otherwise the default). */
  chosen?: BlendStyle;
  inAt: number;
  outAt: number;
  overlap: number;
  /** Tempo sync: the outgoing track's rate from `rideTo` on, reached by a ride from `rideFrom`. */
  sync?: { rate: number; rideFrom: number; rideTo: number };
  /** Why the tempos aren't synced, when they could have been asked to be. */
  noSync?: 'off' | 'no-bpm' | 'too-far' | 'no-overlap' | 'same-tempo';
  /** Bass swap: when the basses change over. */
  swapAt?: number;
  /** Echo out: when the outgoing track cuts (its echoes ring on). */
  echoAt?: number;
}

export function defaultBlend(overlap: number, bpm: number | undefined): BlendStyle {
  const bar = (bpm ? 60 / bpm : 0.5) * 4;
  return overlap >= SHORT_BLEND_BARS * bar ? 'bassSwap' : 'straight';
}

/** How the transition from `a` into `b` plays. */
export function planTransition(a: MixTrack, b: MixTrack, opts: { blend?: BlendStyle; sync?: boolean } = {}): TransitionPlan {
  const inAt = b.startsAt;
  const outAt = a.startsAt + a.playFor;
  const overlap = outAt - inAt;
  const barA = (a.bpm ? 60 / a.bpm : 0.5) * 4;
  const chosen = opts.blend;
  let style = chosen ?? defaultBlend(overlap, a.bpm);
  if ((style === 'bassSwap' || style === 'crossfade') && overlap <= 0.05) style = 'straight';
  const plan: TransitionPlan = { style, chosen, inAt, outAt, overlap };

  if (opts.sync === false) plan.noSync = 'off';
  else if (overlap <= 0.05) plan.noSync = 'no-overlap';
  else if (!a.bpm || !b.bpm) plan.noSync = 'no-bpm';
  else {
    const rate = syncRate(a.bpm, b.bpm);
    if (rate === undefined) plan.noSync = 'too-far';
    else if (Math.abs(rate - 1) < 0.0005) plan.noSync = 'same-tempo';
    else plan.sync = { rate, rideFrom: Math.max(a.startsAt, inAt - RIDE_BARS * barA), rideTo: inAt };
  }

  if (style === 'bassSwap') {
    // Halfway through the overlap, on the incoming track's nearest bar.
    const mid = inAt + overlap / 2;
    let swap = mid;
    if (b.bpm) {
      const barB = (60 / b.bpm) * 4;
      const origin = inAt + (b.gridStart ?? 0) - b.mixIn;
      swap = origin + Math.round((mid - origin) / barB) * barB;
    }
    const edge = Math.min(0.5, overlap / 4);
    plan.swapAt = Math.min(outAt - edge, Math.max(inAt + edge, swap));
  }
  if (style === 'echo') plan.echoAt = outAt;
  return plan;
}

/** The outgoing track's position in its file at night time `t`, with its tempo ride. */
export function rideOffset(plan: TransitionPlan, t: number): number {
  const s = plan.sync;
  if (!s || t <= s.rideFrom) return 0;
  const ride: Env = [
    { t: s.rideFrom, v: 1 },
    { t: s.rideTo, v: s.rate },
  ];
  return integrate(ride, s.rideFrom, t) - (t - s.rideFrom);
}

/** What can be automated on each deck with keyframes. */
export type AutoParam = 'level' | 'bass' | 'mid' | 'high' | 'filter' | 'echo' | 'reverb';

export interface AutoParamInfo {
  id: AutoParam;
  label: string;
  min: number;
  max: number;
  /** The value that leaves the sound untouched. */
  neutral: number;
  format: (v: number) => string;
  hint: string;
}

const db = (v: number) => (v <= -39.5 ? 'kill' : `${v > 0 ? '+' : ''}${Math.round(v)} dB`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export const AUTO_PARAMS: AutoParamInfo[] = [
  { id: 'level', label: 'Fader', min: 0, max: 1, neutral: 1, format: pct, hint: 'Channel fader' },
  { id: 'bass', label: 'Bass', min: -40, max: 6, neutral: 0, format: db, hint: 'Low EQ (below ~220 Hz)' },
  { id: 'mid', label: 'Mid', min: -40, max: 6, neutral: 0, format: db, hint: 'Mid EQ (around 1 kHz)' },
  { id: 'high', label: 'High', min: -40, max: 6, neutral: 0, format: db, hint: 'High EQ (above ~4 kHz)' },
  {
    id: 'filter',
    label: 'Filter',
    min: -1,
    max: 1,
    neutral: 0,
    format: (v) => (Math.abs(v) < 0.02 ? 'off' : v < 0 ? `low-pass ${pct(-v)}` : `high-pass ${pct(v)}`),
    hint: 'DJ filter: down sweeps a low-pass (muffled), up a high-pass (thin)',
  },
  { id: 'echo', label: 'Echo', min: 0, max: 1, neutral: 0, format: pct, hint: 'Send to a 1-beat echo, in time with the deck' },
  { id: 'reverb', label: 'Reverb', min: 0, max: 1, neutral: 0, format: pct, hint: 'Send to a big hall reverb' },
];

export const autoParam = (id: AutoParam) => AUTO_PARAMS.find((p) => p.id === id)!;

/** A keyframe: `t` seconds from where the incoming track comes in (so it moves with it), and a value. */
export interface Keyframe {
  t: number;
  v: number;
}
export type DeckAutomation = Partial<Record<AutoParam, Keyframe[]>>;
/** Keyframes drawn for a transition, on the outgoing (a) and incoming (b) deck. */
export interface TransitionAutomation {
  a?: DeckAutomation;
  b?: DeckAutomation;
}

export interface Curves extends Record<AutoParam, Env> {
  /** Playback rate (1 = as recorded). */
  rate: Env;
}

export function emptyCurves(): Curves {
  return { rate: [], level: [], bass: [], mid: [], high: [], filter: [], echo: [], reverb: [] };
}

const FAST = 0.03;

/** The outgoing track's side of a transition. */
export function outgoingCurves(p: TransitionPlan, a: MixTrack): Curves {
  const c = emptyCurves();
  if (p.sync) c.rate.push({ t: p.sync.rideFrom, v: 1 }, { t: p.sync.rideTo, v: p.sync.rate });
  const bar = (a.bpm ? 60 / a.bpm : 0.5) * 4 * (p.sync ? 1 / p.sync.rate : 1);
  if (p.style === 'crossfade') {
    for (let k = 0; k <= 4; k++) c.level.push({ t: p.inAt + (k / 4) * p.overlap, v: Math.cos((k / 4) * (Math.PI / 2)) });
  } else if (p.style === 'bassSwap' && p.swapAt !== undefined) {
    c.bass.push({ t: p.swapAt, v: 0 }, { t: p.swapAt + FAST, v: BASS_KILL_DB });
    // After the swap the outgoing track fades out over its last bars.
    c.level.push({ t: Math.max(p.swapAt, p.outAt - 4 * bar), v: 1 }, { t: p.outAt, v: 0 });
  }
  return c;
}

/** The incoming track's side of a transition. */
export function incomingCurves(p: TransitionPlan, b: MixTrack): Curves {
  const c = emptyCurves();
  const bar = (b.bpm ? 60 / b.bpm : 0.5) * 4;
  if (p.style === 'crossfade') {
    for (let k = 0; k <= 4; k++) c.level.push({ t: p.inAt + (k / 4) * p.overlap, v: Math.sin((k / 4) * (Math.PI / 2)) });
  } else if (p.style === 'bassSwap' && p.swapAt !== undefined) {
    c.bass.push({ t: p.swapAt, v: BASS_KILL_DB }, { t: p.swapAt + FAST, v: 0 });
    // Fader up over the first bars, bass still off.
    c.level.push({ t: p.inAt, v: 0 }, { t: p.inAt + Math.min(2 * bar, (p.swapAt - p.inAt) / 2), v: 1 });
  }
  return c;
}

/** One track's curves from both of its transitions (in from the previous track, out to the next). */
export function mergeCurves(...all: Curves[]): Curves {
  const out = emptyCurves();
  for (const k of Object.keys(out) as (keyof Curves)[]) out[k] = all.flatMap((c) => c[k]).sort((x, y) => x.t - y.t);
  return out;
}

/**
 * A deck's side of a transition with its keyframes applied: a parameter with
 * keyframes follows them instead of the blend style's curve.
 */
export function withKeyframes(base: Curves, keys: DeckAutomation | undefined, inAt: number): Curves {
  if (!keys) return base;
  const c = { ...base };
  for (const [param, list] of Object.entries(keys) as [AutoParam, Keyframe[]][]) {
    if (list?.length) c[param] = [...list].sort((x, y) => x.t - y.t).map((k) => ({ t: inAt + k.t, v: k.v }));
  }
  return c;
}

/** True when the transition's fader or bass follow keyframes rather than its blend style. */
export function isCustomBlend(auto: TransitionAutomation | undefined): boolean {
  return !!(auto?.a?.level?.length || auto?.a?.bass?.length || auto?.b?.level?.length || auto?.b?.bass?.length);
}

/**
 * The keyframes a parameter starts with when it's first edited: the blend
 * style's curve for the fader and bass (so you tweak the bass swap rather than
 * start again), otherwise a bump around the new point (neutral a few bars either
 * side), so one keyframe doesn't change the whole track.
 */
export function seedKeyframes(style: Curves, param: AutoParam, inAt: number, at: Keyframe, bar: number): Keyframe[] {
  const existing = style[param];
  if (existing.length) return [...existing.map((p) => ({ t: p.t - inAt, v: p.v })), at].sort((x, y) => x.t - y.t);
  const n = autoParam(param).neutral;
  return [
    { t: at.t - 4 * bar, v: n },
    at,
    { t: at.t + 4 * bar, v: n },
  ];
}

/**
 * How far the incoming track's mix-in sits off its own beat grid, as a
 * fraction of a beat, when its beats and the outgoing track's line up one to
 * one (0 otherwise: half or double time, or no grid).
 */
export function incomingPhase(a: MixTrack, b: MixTrack, rate: number): number {
  if (!a.bpm || !b.bpm || Math.abs(rate * a.bpm - b.bpm) > 0.01) return 0;
  return ((((b.mixIn - (b.gridStart ?? 0)) / (60 / b.bpm)) % 1) + 1) % 1;
}

/**
 * Where to bring the incoming track in so the beats lock: on the outgoing
 * track's beat as it's played (after its tempo ride), matching the phase of the
 * incoming track's mix-in against its own grid. `t` is where the pointer is.
 */
export function snapIncoming(a: MixTrack, b: MixTrack, t: number, sync = true): number {
  if (!a.bpm) return t;
  const beatA = 60 / a.bpm;
  const rate = sync ? syncRate(a.bpm, b.bpm) : undefined;
  const phase = rate !== undefined ? incomingPhase(a, b, rate) : 0;
  // Where the outgoing track is in its file when the incoming one starts at `x`.
  const posAt = (x: number) => a.mixIn + (x - a.startsAt) + rideOffset(planTransition(a, { ...b, startsAt: x }, { sync }), x);
  const grid = a.gridStart ?? 0;
  const target = grid + (Math.round((posAt(t) - grid) / beatA - phase) + phase) * beatA;
  // The ride's length depends a little on where it starts; a few steps settle it.
  let at = t;
  for (let i = 0; i < 3; i++) at += target - posAt(at);
  return Math.max(0, Math.round(at * 1000) / 1000);
}
