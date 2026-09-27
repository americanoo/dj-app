/**
 * Compact storage for waveform overviews. Peaks (0..1 per bucket) are
 * quantised to one byte each: about 50 KB for a six-minute track at 150
 * buckets per second, which is plenty for drawing.
 */

export interface WaveformData {
  /** Max-abs amplitude per bucket, 0..1. */
  peaks: Float32Array;
  peaksPerSecond: number;
  /** Seconds. */
  duration: number;
  /** Name of the audio file the waveform was made from. */
  fileName: string;
}

export interface StoredWaveform {
  v: 1;
  peaks: Uint8Array;
  peaksPerSecond: number;
  duration: number;
  fileName: string;
  savedAt: number;
}

export function encodeWaveform(w: WaveformData, savedAt = Date.now()): StoredWaveform {
  const peaks = new Uint8Array(w.peaks.length);
  for (let i = 0; i < w.peaks.length; i++) peaks[i] = Math.round(Math.max(0, Math.min(1, w.peaks[i])) * 255);
  return { v: 1, peaks, peaksPerSecond: w.peaksPerSecond, duration: w.duration, fileName: w.fileName, savedAt };
}

export function decodeWaveform(s: StoredWaveform | undefined | null): WaveformData | undefined {
  if (!s || s.v !== 1 || !(s.peaks instanceof Uint8Array) || !(s.peaksPerSecond > 0)) return undefined;
  const peaks = new Float32Array(s.peaks.length);
  for (let i = 0; i < s.peaks.length; i++) peaks[i] = s.peaks[i] / 255;
  return { peaks, peaksPerSecond: s.peaksPerSecond, duration: s.duration, fileName: s.fileName };
}
