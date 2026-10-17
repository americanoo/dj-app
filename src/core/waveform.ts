/**
 * Compact storage for waveform overviews. Values (0..1 per bucket) are
 * quantised to one byte each: the overall peaks plus bass / mid / high bands,
 * about 200 KB for a six-minute track at 150 buckets per second.
 */

export interface WaveformBands {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

export interface WaveformData {
  /** Max-abs amplitude per bucket, 0..1. */
  peaks: Float32Array;
  /** Three-band split for coloured drawing. Missing on waveforms saved by older versions. */
  bands?: WaveformBands;
  peaksPerSecond: number;
  /** Seconds. */
  duration: number;
  /** Name of the audio file the waveform was made from. */
  fileName: string;
}

export interface StoredWaveform {
  v: 1 | 2;
  peaks: Uint8Array;
  low?: Uint8Array;
  mid?: Uint8Array;
  high?: Uint8Array;
  peaksPerSecond: number;
  duration: number;
  fileName: string;
  savedAt: number;
}

function toBytes(a: Float32Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, a[i])) * 255);
  return out;
}

function fromBytes(a: Uint8Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] / 255;
  return out;
}

export function encodeWaveform(w: WaveformData, savedAt = Date.now()): StoredWaveform {
  const base = { peaks: toBytes(w.peaks), peaksPerSecond: w.peaksPerSecond, duration: w.duration, fileName: w.fileName, savedAt };
  if (!w.bands) return { v: 1, ...base };
  return { v: 2, ...base, low: toBytes(w.bands.low), mid: toBytes(w.bands.mid), high: toBytes(w.bands.high) };
}

export function decodeWaveform(s: StoredWaveform | undefined | null): WaveformData | undefined {
  if (!s || (s.v !== 1 && s.v !== 2) || !(s.peaks instanceof Uint8Array) || !(s.peaksPerSecond > 0)) return undefined;
  const bands =
    s.v === 2 && s.low instanceof Uint8Array && s.mid instanceof Uint8Array && s.high instanceof Uint8Array
      ? { low: fromBytes(s.low), mid: fromBytes(s.mid), high: fromBytes(s.high) }
      : undefined;
  return { peaks: fromBytes(s.peaks), bands, peaksPerSecond: s.peaksPerSecond, duration: s.duration, fileName: s.fileName };
}
