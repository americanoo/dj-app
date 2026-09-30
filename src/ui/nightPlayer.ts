import { valueAt, type Env } from '../core/mixplan';
import { slotPos, slotRate, type NightSlot } from '../core/setplan';
import { playOutFx, type OutFx } from './deck';
import { transport } from './transport';

/**
 * Plays the journey of the night as planned: every track at its place, from its
 * mix-in, for as long as the plan gives it. Where tracks overlap on the timeline
 * they play together, and one runs straight into the next without a gap.
 *
 * Tracks are decoded a little ahead of time and scheduled on the audio clock,
 * so handovers are sample-accurate. Decoded audio is big, so only a few tracks
 * are kept.
 */
export type NightLoader = (trackId: string) => Promise<AudioBuffer | undefined>;

/** How far ahead voices are scheduled, and how often. */
const HORIZON = 1.5;
const TICK_MS = 150;
/** Tracks starting this soon are decoded ahead of time. */
const PREFETCH = 40;
const KEEP_BUFFERS = 4;
const FADE = 0.012;

interface Voice {
  src: AudioBufferSourceNode;
  /** Start / stop fades (and where an FX cuts the track). */
  gain: GainNode;
  /** The slot as it was when scheduled: if the plan moves it, the voice is redone. */
  sig: string;
}

const sigOf = (s: NightSlot) => `${s.trackId}|${s.startsAt}|${s.playFor}|${s.mixIn}|${s.echoAt}|${JSON.stringify(s.curves)}`;

/** Low EQ corner, like a DJ mixer's bass knob. */
const BASS_HZ = 220;

export class NightPlayer {
  private ctx: AudioContext;
  private out: GainNode;
  private slots: NightSlot[] = [];
  private voices = new Map<string, Voice>();
  private buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  private ready = new Map<string, AudioBuffer | null>();
  private loader: NightLoader;
  private timer = 0;
  private isPlaying = false;
  /** Night time `startNight` happens at audio-clock time `startCtx`. */
  private startCtx = 0;
  private startNight = 0;
  private pausedAt = 0;
  private listeners = new Set<() => void>();
  private clockOffset = -Infinity;
  private clockSeenAt = 0;
  /** The night, not the deck, is what the timeline follows (it played or was scrubbed last). */
  active = false;
  /** Slots an out-effect has played out: they stay silent until the next jump. */
  private cut = new Set<string>();
  /** Slots whose planned echo out has been scheduled. */
  private echoed = new Set<string>();
  private scrubbing: { wasPlaying: boolean; lastAt: number; pending: number | null; timer: number } | null = null;

  constructor(ctx: AudioContext, loader: NightLoader) {
    this.ctx = ctx;
    this.loader = loader;
    this.out = ctx.createGain();
    // Two full-level tracks in a blend add up: a limiter keeps the sum from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 3;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.out.connect(limiter).connect(ctx.destination);
    // The deck taking over the speakers pauses the night.
    transport.onClaim((owner) => {
      if (owner !== 'night') {
        if (this.isPlaying) this.pause();
        this.active = false;
        this.emit();
      }
    });
  }

  setLoader(loader: NightLoader) {
    this.loader = loader;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  /** Where the night is, in seconds from its start. */
  position(): number {
    if (!this.isPlaying) return this.pausedAt;
    return Math.max(0, this.startNight + (this.audioNow() - this.startCtx));
  }

  /** Track audio decoded and ready ('missing' when there's no file to play). */
  status(trackId: string): 'ready' | 'loading' | 'missing' | 'idle' {
    const r = this.ready.get(trackId);
    if (r) return 'ready';
    if (r === null) return 'missing';
    return this.buffers.has(trackId) ? 'loading' : 'idle';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Bumped on every change, for React's useSyncExternalStore. */
  version = 0;

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  setVolume(v: number) {
    if (Number.isFinite(v)) this.out.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.01);
  }

  /** The plan changed (a track moved, added, removed): only the voices it touches are redone. */
  setSlots(slots: NightSlot[]) {
    this.slots = slots;
    if (this.isPlaying) this.schedule();
    this.prefetch(this.position());
  }

  play(from = this.pausedAt) {
    void this.ctx.resume();
    this.stopAll();
    this.cut.clear();
    this.echoed.clear();
    this.active = true;
    transport.claim('night');
    this.isPlaying = true;
    // A few milliseconds of lead so the first voices start on time.
    this.startCtx = this.ctx.currentTime + 0.02;
    this.startNight = Math.max(0, from);
    this.schedule();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.emit();
  }

  pause() {
    if (!this.isPlaying) return;
    this.pausedAt = this.position();
    this.isPlaying = false;
    window.clearInterval(this.timer);
    this.stopAll();
    this.emit();
  }

  /** The planned tracks, in night order. */
  get plan(): readonly NightSlot[] {
    return this.slots;
  }

  /** Listen to the night (the deck pauses) without starting it. */
  focus() {
    if (this.active) return;
    this.active = true;
    transport.claim('night');
    this.prefetch(this.pausedAt);
    this.emit();
  }

  /** Back to the deck: the night stops. */
  release() {
    this.pause();
    this.active = false;
    this.emit();
  }

  /**
   * Jump to just before the next (+1) or previous (-1) moment a track comes in,
   * with `lead` seconds to hear the outgoing track first.
   */
  jumpMix(dir: 1 | -1, lead = 12) {
    const t = this.position();
    const ins = [...new Set(this.slots.map((s) => s.startsAt).filter((x) => x > 0))].sort((a, b) => a - b);
    // "At" a mix means within the lead-in before it (plus a little, so repeated presses move on).
    const target = dir > 0 ? ins.find((x) => x - lead > t + 0.5) : [...ins].reverse().find((x) => x - lead < t - 1.5);
    if (target === undefined) return dir < 0 ? this.seek(0) : undefined;
    this.seek(Math.max(0, target - lead));
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /** Jump; keeps playing if it was playing. */
  seek(t: number) {
    const to = Math.max(0, t);
    if (!this.active) {
      this.active = true;
      transport.claim('night');
    }
    if (this.isPlaying) this.play(to);
    else {
      this.pausedAt = to;
      this.prefetch(to);
      this.emit();
    }
  }

  /**
   * Dragging along the night plays from under the pointer, like a CD player's
   * needle search: re-cued at most every 70 ms. Let go to play on (`resume`)
   * or stop where it landed.
   */
  scrubStart() {
    if (this.scrubbing) return;
    this.scrubbing = { wasPlaying: this.isPlaying, lastAt: 0, pending: null, timer: 0 };
    this.active = true;
    if (!this.isPlaying) this.play(this.pausedAt);
  }

  scrubTo(t: number) {
    const sc = this.scrubbing;
    if (!sc) return this.seek(t);
    sc.pending = t;
    this.pausedAt = t;
    const flush = () => {
      if (sc.pending === null) return;
      this.play(sc.pending);
      sc.pending = null;
      sc.lastAt = performance.now();
    };
    const wait = 70 - (performance.now() - sc.lastAt);
    window.clearTimeout(sc.timer);
    if (wait <= 0) flush();
    else sc.timer = window.setTimeout(flush, wait);
  }

  scrubEnd(resume = this.scrubbing?.wasPlaying ?? false) {
    const sc = this.scrubbing;
    if (!sc) return;
    window.clearTimeout(sc.timer);
    if (sc.pending !== null) this.play(sc.pending);
    this.scrubbing = null;
    if (!resume) this.pause();
  }

  get isScrubbing(): boolean {
    return this.scrubbing !== null;
  }

  /**
   * Play the outgoing track out with an effect (echo, reverb, loop roll or
   * backspin), beat-synced to it, while the rest of the night plays on. During
   * a blend that's the track that came in first. Returns the slot it cut, or
   * undefined when nothing was playing.
   */
  outFx(kind: OutFx, beats = 1, mix = 0.5): string | undefined {
    if (!this.isPlaying) return undefined;
    const now = this.ctx.currentTime;
    const t = this.startNight + Math.max(0, now - this.startCtx);
    const s = this.slots
      .filter((x) => this.voices.has(x.id) && !this.cut.has(x.id) && x.startsAt <= t && t < x.startsAt + x.playFor)
      .sort((a, b) => a.startsAt - b.startsAt)[0];
    const v = s && this.voices.get(s.id);
    const buf = s && this.ready.get(s.trackId);
    if (!s || !v || !buf) return undefined;
    const posAt = (time: number) => slotPos(s, this.startNight + (time - this.startCtx));
    this.cut.add(s.id);
    // Beat-synced to the track as it's playing (it may be riding into the next one's tempo).
    const bpm = s.bpm ? s.bpm * slotRate(s, t) : undefined;
    playOutFx(this.ctx, this.out, v, buf, posAt(now), posAt, kind, bpm, beats, mix);
    return s.id;
  }

  /**
   * Schedule an automation curve (night times) onto an audio parameter, for a
   * voice that joins at night time `from` (audio-clock `when`).
   */
  private follow(param: AudioParam, env: Env, dflt: number, from: number, when: number) {
    param.setValueAtTime(valueAt(env, from, dflt), when);
    // The curve is straight between its points, so ramping point to point reproduces it.
    for (const p of env) if (p.t > from) param.linearRampToValueAtTime(p.v, Math.max(when, this.ctxAt(p.t)));
  }

  /** Audio-clock time of a moment in the night (while playing). */
  private ctxAt(t: number): number {
    return this.startCtx + (t - this.startNight);
  }

  private schedule() {
    if (!this.isPlaying) return;
    const now = this.ctx.currentTime;
    const t = this.startNight + Math.max(0, now - this.startCtx);
    const bySlot = new Map(this.slots.map((s) => [s.id, s]));
    // Voices whose slot was removed or moved stop (a moved one starts again below, in its new place).
    for (const [id, v] of this.voices) {
      const s = bySlot.get(id);
      if (!s || sigOf(s) !== v.sig) this.stopVoice(id);
    }
    for (const s of this.slots) {
      const end = s.startsAt + s.playFor;
      if (this.voices.has(s.id) || this.cut.has(s.id) || end <= t || s.startsAt > t + HORIZON) continue;
      const buf = this.ready.get(s.trackId);
      if (buf === undefined) {
        void this.load(s.trackId);
        continue; // picked up on a later tick, joining at the right spot
      }
      if (buf === null) continue;
      // Joining late (a seek, or the audio was still decoding) starts part-way in.
      const from = Math.max(s.startsAt, t + 0.01);
      const offset = slotPos(s, from);
      if (offset >= buf.duration) continue;
      const when = Math.max(now, this.ctxAt(from));
      const stopAt = Math.max(when + FADE * 2, this.ctxAt(end));
      // source → bass EQ → fader → start/stop fades → out
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const eq = this.ctx.createBiquadFilter();
      eq.type = 'lowshelf';
      eq.frequency.value = BASS_HZ;
      const level = this.ctx.createGain();
      const gain = this.ctx.createGain();
      // The mix automation: tempo ride, fader and bass, from wherever the voice joins.
      this.follow(src.playbackRate, s.curves.rate, 1, from, when);
      this.follow(level.gain, s.curves.level, 1, from, when);
      this.follow(eq.gain, s.curves.bass, 0, from, when);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(1, when + FADE);
      gain.gain.setValueAtTime(1, Math.max(when + FADE, stopAt - FADE));
      gain.gain.linearRampToValueAtTime(0, stopAt);
      src.connect(eq).connect(level).connect(gain).connect(this.out);
      src.start(when, offset);
      src.stop(stopAt + 0.02);
      const id = s.id;
      src.onended = () => {
        if (this.voices.get(id)?.src === src) this.voices.delete(id);
        gain.disconnect();
        level.disconnect();
        eq.disconnect();
      };
      this.voices.set(id, { src, gain, sig: sigOf(s) });
    }
    // Planned echo outs: set off a beat before the out point, so the track cuts right on it.
    for (const s of this.slots) {
      if (s.echoAt === undefined || this.echoed.has(s.id) || this.cut.has(s.id)) continue;
      const v = this.voices.get(s.id);
      const buf = this.ready.get(s.trackId);
      if (!v || !buf) continue;
      const bpm = s.bpm ? s.bpm * slotRate(s, s.echoAt) : undefined;
      const fireAt = s.echoAt - (bpm ? 60 / bpm : 0.5);
      if (fireAt > t + HORIZON || s.echoAt <= t) continue;
      this.echoed.add(s.id);
      const posAt = (time: number) => slotPos(s, this.startNight + (time - this.startCtx));
      const at = Math.max(now, this.ctxAt(fireAt));
      playOutFx(this.ctx, this.out, v, buf, posAt(at), posAt, 'echo', bpm, 1, 0.5, at);
    }
    this.prefetch(t);
    // The end of the night: stop.
    const last = this.slots.reduce((m, s) => Math.max(m, s.startsAt + s.playFor), 0);
    if (!this.scrubbing && this.slots.length && t >= last + 0.5) {
      this.pause();
      this.pausedAt = last;
      this.emit();
    }
  }

  private prefetch(t: number) {
    const soon = this.slots.filter((s) => s.startsAt + s.playFor > t && s.startsAt < t + PREFETCH);
    for (const s of soon) void this.load(s.trackId);
    // Keep what's playing or coming up; let older decoded audio go.
    const keep = new Set(soon.map((s) => s.trackId));
    if (this.buffers.size > KEEP_BUFFERS) {
      for (const id of [...this.buffers.keys()]) {
        if (this.buffers.size <= KEEP_BUFFERS) break;
        if (!keep.has(id)) {
          this.buffers.delete(id);
          this.ready.delete(id);
        }
      }
    }
  }

  private load(trackId: string): Promise<AudioBuffer | undefined> {
    let p = this.buffers.get(trackId);
    if (!p) {
      p = this.loader(trackId)
        .catch(() => undefined)
        .then((buf) => {
          if (this.buffers.get(trackId) === p) {
            this.ready.set(trackId, buf ?? null);
            this.emit();
            if (this.isPlaying) this.schedule();
          }
          return buf;
        });
      this.buffers.set(trackId, p);
    }
    return p;
  }

  /** Forget decoded audio (e.g. the music folder changed), so it's loaded again when needed. */
  forget(trackId?: string) {
    if (trackId) {
      if (this.ready.get(trackId)) return;
      this.buffers.delete(trackId);
      this.ready.delete(trackId);
    } else {
      for (const [id, b] of this.ready) if (!b) (this.buffers.delete(id), this.ready.delete(id));
    }
    if (this.isPlaying) this.schedule();
  }

  private stopVoice(id: string) {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + FADE);
    try {
      v.src.stop(now + FADE + 0.005);
    } catch {
      // already stopped
    }
  }

  private stopAll() {
    for (const id of [...this.voices.keys()]) this.stopVoice(id);
  }

  /** The audio clock, smoothed between its block updates (see Deck). */
  private audioNow(): number {
    const ct = this.ctx.currentTime;
    if (this.ctx.state !== 'running') return ct;
    const pn = performance.now() / 1000;
    const off = ct - pn;
    if (off > this.clockOffset || off < this.clockOffset - 0.1) this.clockOffset = off;
    else this.clockOffset -= (pn - this.clockSeenAt) * 0.002;
    this.clockSeenAt = pn;
    return Math.min(Math.max(ct, pn + this.clockOffset), ct + 0.03);
  }
}
