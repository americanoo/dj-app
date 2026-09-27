/**
 * A tiny DJ deck on the Web Audio API.
 *
 * Plays a decoded AudioBuffer directly, which gives sample-accurate, instant
 * cue jumps (no seeking delay like an <audio> element) and true looping via the
 * source node's loopStart / loopEnd. Every start and stop gets a few
 * milliseconds of fade so jumps don't click.
 */

const FADE = 0.004; // seconds

export interface LoopRegion {
  start: number;
  end: number;
}

export class Deck {
  private ctx: AudioContext;
  private out: GainNode;
  private buffer: AudioBuffer | null = null;
  private voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private startedAt = 0; // ctx time when the current voice started
  private offset = 0; // track position at that moment
  private pausedAt = 0;
  private loop: LoopRegion | null = null;
  private onEnded: () => void;

  constructor(ctx: AudioContext, onEnded: () => void = () => undefined) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    this.onEnded = onEnded;
  }

  get playing(): boolean {
    return this.voice !== null;
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
    if (!this.voice) return this.pausedAt;
    const raw = this.offset + (this.ctx.currentTime - this.startedAt);
    const l = this.loop;
    if (l && this.offset < l.end && raw >= l.end) {
      return l.start + ((raw - l.start) % (l.end - l.start));
    }
    return Math.min(raw, this.duration);
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
      this.pausedAt = this.duration;
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
    const pos = this.position();
    this.loop = loop && loop.end > loop.start ? loop : null;
    if (!this.voice) return;
    // Re-anchor the timing, then let the running source loop (or stop looping) in place.
    this.startedAt = this.ctx.currentTime;
    this.offset = pos;
    this.applyLoop(this.voice.src);
  }

  setVolume(v: number) {
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.01);
  }

  dispose() {
    this.stopVoice();
    this.out.disconnect();
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
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + FADE);
    v.src.stop(now + FADE + 0.001);
  }
}
