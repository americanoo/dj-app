/**
 * A tiny DJ deck on the Web Audio API.
 *
 * Plays a decoded AudioBuffer directly, which gives sample-accurate, instant
 * cue jumps (no seeking delay like an <audio> element) and true looping via the
 * source node's loopStart / loopEnd. Every start and stop gets a few
 * milliseconds of fade so jumps don't click.
 */

const FADE = 0.004; // seconds

/** Ways to play a track out, like a DJ would into the next one. */
export type OutFx = 'echo' | 'reverb' | 'spin';

/** Beat lengths offered for the effects. */
export const FX_BEATS = [0.25, 0.5, 0.75, 1, 2, 4] as const;

export interface LoopRegion {
  start: number;
  end: number;
}

export class Deck {
  private ctx: AudioContext;
  private out: GainNode;
  private meter: AnalyserNode;
  private meterData: Float32Array<ArrayBuffer>;
  private buffer: AudioBuffer | null = null;
  private voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private startedAt = 0; // ctx time when the current voice started
  private offset = 0; // track position at that moment
  private pausedAt = 0;
  private loop: LoopRegion | null = null;
  private onEnded: () => void;
  // Smooth clock: the audio clock only advances in blocks of a few milliseconds,
  // which makes a scrolling waveform judder. We track the offset between it and
  // the page's high-resolution clock and interpolate between blocks.
  private clockOffset = -Infinity;
  private clockSeenAt = 0;
  /** An out-effect has scheduled the track to stop: when (audio clock) and where it ends up. */
  private fxStop: { at: number; pos: number } | null = null;
  private static impulses = new WeakMap<BaseAudioContext, AudioBuffer>();

  constructor(ctx: AudioContext, onEnded: () => void = () => undefined) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    // Level meter on what actually goes to the speakers (after the volume).
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.meterData = new Float32Array(this.meter.fftSize);
    this.out.connect(this.meter);
    this.onEnded = onEnded;
  }

  get playing(): boolean {
    return this.voice !== null;
  }

  /** Peak output level right now, 0–1. */
  level(): number {
    this.meter.getFloatTimeDomainData(this.meterData);
    let peak = 0;
    for (const v of this.meterData) if (Math.abs(v) > peak) peak = Math.abs(v);
    return Math.min(1, peak);
  }

  /** Whether the browser is letting the audio run (it can hold it back until a click). */
  get audible(): boolean {
    return this.ctx.state === 'running';
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  load(buffer: AudioBuffer | null) {
    this.stopVoice();
    this.buffer = buffer;
    this.pausedAt = 0;
  }

  /** Current track position in seconds, following loops. */
  position(): number {
    return this.positionAt(this.audioNow());
  }

  private positionAt(time: number): number {
    if (!this.voice) return this.pausedAt;
    if (this.fxStop && time >= this.fxStop.at) return this.fxStop.pos;
    const raw = this.offset + Math.max(0, time - this.startedAt);
    const l = this.loop;
    if (l && this.offset < l.end && raw >= l.end) {
      return l.start + ((raw - l.start) % (l.end - l.start));
    }
    return Math.min(raw, this.duration);
  }

  /**
   * The audio clock, interpolated between its block updates so it moves evenly
   * from one screen frame to the next. Never behind the audio clock, and never
   * more than a block or two ahead of it.
   */
  private audioNow(): number {
    const ct = this.ctx.currentTime;
    if (this.ctx.state !== 'running') return ct;
    const pn = performance.now() / 1000;
    const off = ct - pn;
    if (off > this.clockOffset || off < this.clockOffset - 0.1) {
      // The audio clock just stepped forward (or restarted after a suspend).
      this.clockOffset = off;
    } else {
      // Let the estimate sink very slowly so the two clocks can't drift apart.
      this.clockOffset -= (pn - this.clockSeenAt) * 0.002;
    }
    this.clockSeenAt = pn;
    return Math.min(Math.max(ct, pn + this.clockOffset), ct + 0.03);
  }

  play(from = this.pausedAt) {
    if (!this.buffer) return;
    void this.ctx.resume(); // browsers start contexts suspended until a click
    this.stopVoice();
    const at = Math.max(0, Math.min(from, this.duration - 0.001));
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    this.applyLoop(src);
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE);
    src.connect(gain).connect(this.out);
    src.onended = () => {
      if (this.voice?.src !== src) return; // replaced by a jump, not a real end
      this.voice = null;
      // Stopped by an out-effect: park where it cut, not at the end of the track.
      this.pausedAt = this.fxStop ? this.fxStop.pos : this.duration;
      this.fxStop = null;
      this.onEnded();
    };
    src.start(now, at);
    this.voice = { src, gain };
    this.startedAt = now;
    this.offset = at;
  }

  pause() {
    this.pausedAt = this.position();
    this.stopVoice();
  }

  /** Jump; keeps playing if it was playing. */
  seek(to: number) {
    if (this.playing) this.play(to);
    else this.pausedAt = Math.max(0, Math.min(to, this.duration));
  }

  /** Engage (or with `null`, exit) a loop. Playback continues seamlessly. */
  setLoop(loop: LoopRegion | null) {
    // Read the position with the old loop still in force, before switching.
    const now = this.audioNow();
    const pos = this.positionAt(now);
    this.loop = loop && loop.end > loop.start ? loop : null;
    if (!this.voice) return;
    // Re-anchor the timing, then let the running source loop (or stop looping) in place.
    this.startedAt = now;
    this.offset = pos;
    this.applyLoop(this.voice.src);
  }

  /**
   * Play the track out with an effect. The track stops (after a beat for echo
   * and reverb, straight away for a backspin) and the effect's tail rings on;
   * `onEnded` fires when the track itself has stopped. Beat-synced to `bpm`;
   * `beats` sets the echo time, the reverb swell, or the length of the spin.
   */
  outFx(kind: OutFx, bpm?: number, beats = 1) {
    const v = this.voice;
    if (!v || !this.buffer || this.fxStop) return;
    const ctx = this.ctx;
    const beat = bpm && bpm > 0 ? 60 / bpm : 0.5;
    const now = ctx.currentTime;
    const pos = this.positionAt(this.audioNow());
    const nodes: AudioNode[] = [];
    const keep = <T extends AudioNode>(n: T) => (nodes.push(n), n);
    let cutAt: number;
    let stopPos: number;
    let tail: number;

    if (kind === 'echo') {
      // Classic echo out: 3/4-beat repeats, darker each time, then the track cuts on the beat.
      const send = keep(ctx.createGain());
      const delay = keep(ctx.createDelay(4));
      const fb = keep(ctx.createGain());
      const hp = keep(ctx.createBiquadFilter());
      const lp = keep(ctx.createBiquadFilter());
      const wet = keep(ctx.createGain());
      delay.delayTime.value = Math.min(3.9, Math.max(0.03, beat * beats));
      hp.type = 'highpass';
      hp.frequency.value = 280;
      lp.type = 'lowpass';
      lp.frequency.value = 4200;
      fb.gain.value = 0.62;
      send.gain.setValueAtTime(0, now);
      send.gain.linearRampToValueAtTime(1, now + 0.03);
      v.gain.connect(send).connect(delay).connect(hp).connect(lp);
      lp.connect(fb).connect(delay);
      lp.connect(wet).connect(this.out);
      // The track cuts on the first repeat (at least half a beat in, so the echo has something to repeat).
      cutAt = now + Math.max(beat * 0.5, delay.delayTime.value);
      stopPos = this.positionAt(cutAt);
      tail = 9 * delay.delayTime.value + 1;
      wet.gain.setValueAtTime(0.9, cutAt);
      wet.gain.linearRampToValueAtTime(0, cutAt + tail);
    } else if (kind === 'reverb') {
      // Reverb out: the track swells into a big hall over a beat, cuts, and the hall rings out.
      const send = keep(ctx.createGain());
      const hp = keep(ctx.createBiquadFilter());
      const verb = keep(ctx.createConvolver());
      const wet = keep(ctx.createGain());
      hp.type = 'highpass';
      hp.frequency.value = 200;
      verb.buffer = Deck.impulse(ctx);
      const swell = Math.max(0.1, beat * beats);
      send.gain.setValueAtTime(0.15, now);
      send.gain.linearRampToValueAtTime(1.3, now + swell);
      v.gain.connect(send).connect(hp).connect(verb).connect(wet).connect(this.out);
      wet.gain.setValueAtTime(2.4, now);
      cutAt = now + swell;
      stopPos = this.positionAt(cutAt);
      tail = 5;
      wet.gain.setValueAtTime(2.4, cutAt + 2);
      wet.gain.linearRampToValueAtTime(0, cutAt + tail);
    } else {
      // Backspin: the record is whipped backwards and winds down over half a bar.
      const r0 = 3.2;
      const r1 = 0.2;
      const T = Math.max(0.25, Math.min(4, beat * beats));
      const distance = (T * (r0 - r1)) / Math.log(r0 / r1); // seconds of track travelled backwards
      const span = Math.min(pos, distance + 0.05);
      const rev = Deck.reversed(ctx, this.buffer, pos - span, pos);
      const spin = keep(ctx.createBufferSource());
      const g = keep(ctx.createGain());
      spin.buffer = rev;
      spin.playbackRate.setValueAtTime(r0, now);
      spin.playbackRate.exponentialRampToValueAtTime(r1, now + T);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(1, now + 0.02);
      g.gain.setValueAtTime(1, now + T * 0.6);
      g.gain.linearRampToValueAtTime(0, now + T);
      spin.connect(g).connect(this.out);
      spin.start(now);
      spin.stop(now + T + 0.05);
      cutAt = now + 0.02;
      stopPos = Math.max(0, pos - span);
      tail = T + 0.2;
    }

    // Cut the track itself.
    this.fxStop = { at: cutAt, pos: stopPos };
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(1, Math.max(now, cutAt - 0.02));
    v.gain.gain.linearRampToValueAtTime(0, cutAt);
    try {
      v.src.stop(cutAt + 0.01);
    } catch {
      // already scheduled to stop
    }
    // Tidy up the effect once its tail has died away.
    window.setTimeout(() => nodes.forEach((n) => n.disconnect()), (cutAt - now + tail + 0.5) * 1000);
  }

  /** A 4-second hall: stereo noise with an exponential decay. Made once per audio context. */
  private static impulse(ctx: BaseAudioContext): AudioBuffer {
    let ir = Deck.impulses.get(ctx);
    if (ir) return ir;
    const len = Math.floor(ctx.sampleRate * 4);
    ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * t) / 4) * (t < 0.01 ? t / 0.01 : 1);
      }
    }
    Deck.impulses.set(ctx, ir);
    return ir;
  }

  /** `from`–`to` of the track, reversed, so playing it forwards sounds like spinning back. */
  private static reversed(ctx: BaseAudioContext, buf: AudioBuffer, from: number, to: number): AudioBuffer {
    const a = Math.max(0, Math.floor(from * buf.sampleRate));
    const b = Math.max(a + 1, Math.min(buf.length, Math.floor(to * buf.sampleRate)));
    const out = ctx.createBuffer(buf.numberOfChannels, b - a, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let i = 0; i < b - a; i++) dst[i] = src[b - 1 - i];
    }
    return out;
  }

  setVolume(v: number) {
    if (!Number.isFinite(v)) return;
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.01);
  }

  dispose() {
    this.stopVoice();
    this.out.disconnect();
    this.meter.disconnect();
  }

  private applyLoop(src: AudioBufferSourceNode) {
    if (this.loop) {
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
      src.loop = true;
    } else {
      src.loop = false;
    }
  }

  private stopVoice() {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    this.fxStop = null;
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + FADE);
    try {
      v.src.stop(now + FADE + 0.001);
    } catch {
      // an out-effect already scheduled the stop
    }
  }
}
