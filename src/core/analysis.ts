/**
 * Waveform analysis: overall peaks plus a three-band split (bass / mids /
 * highs) for rekordbox-style coloured waveforms.
 *
 * Each band has its own 2nd-order filter on the mono mix (RBJ biquads):
 * low-pass at 200 Hz, band-pass centred between the two cutoffs, and
 * high-pass at 2.5 kHz. Independent filters avoid the phase leakage that
 * subtracting one low-pass from another would cause.
 */

export const LOW_CUTOFF = 200;
export const HIGH_CUTOFF = 2500;

export interface BandPeaks {
  /** Max-abs of the full signal per bucket, 0..1. */
  peaks: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  peaksPerSecond: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ Audio EQ Cookbook coefficients, normalised by a0. */
export function biquad(type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number, b1: number, b2: number;
  if (type === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else if (type === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

export function analyseBands(channels: Float32Array[], sampleRate: number, bucketsPerSecond: number): BandPeaks {
  const length = channels[0]?.length ?? 0;
  const bucket = Math.max(1, Math.floor(sampleRate / bucketsPerSecond));
  const n = Math.ceil(length / bucket);
  const peaks = new Float32Array(n);
  const low = new Float32Array(n);
  const mid = new Float32Array(n);
  const high = new Float32Array(n);
  const centre = Math.sqrt(LOW_CUTOFF * HIGH_CUTOFF);
  const L = biquad('lowpass', LOW_CUTOFF, Math.SQRT1_2, sampleRate);
  const M = biquad('bandpass', centre, centre / (HIGH_CUTOFF - LOW_CUTOFF), sampleRate);
  const H = biquad('highpass', HIGH_CUTOFF, Math.SQRT1_2, sampleRate);
  const nch = channels.length;
  // Direct form I state: previous two inputs (shared) and outputs per filter.
  let x1 = 0, x2 = 0;
  let l1 = 0, l2 = 0, m1 = 0, m2 = 0, h1 = 0, h2 = 0;

  for (let b = 0; b < n; b++) {
    let pk = 0, lo = 0, mi = 0, hi = 0;
    const end = Math.min(length, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) {
      let x = 0;
      for (let c = 0; c < nch; c++) x += channels[c][i];
      x /= nch;
      const yl = L.b0 * x + L.b1 * x1 + L.b2 * x2 - L.a1 * l1 - L.a2 * l2;
      const ym = M.b0 * x + M.b1 * x1 + M.b2 * x2 - M.a1 * m1 - M.a2 * m2;
      const yh = H.b0 * x + H.b1 * x1 + H.b2 * x2 - H.a1 * h1 - H.a2 * h2;
      x2 = x1; x1 = x;
      l2 = l1; l1 = yl;
      m2 = m1; m1 = ym;
      h2 = h1; h1 = yh;
      const ax = x < 0 ? -x : x;
      const al = yl < 0 ? -yl : yl;
      const am = ym < 0 ? -ym : ym;
      const ah = yh < 0 ? -yh : yh;
      if (ax > pk) pk = ax;
      if (al > lo) lo = al;
      if (am > mi) mi = am;
      if (ah > hi) hi = ah;
    }
    peaks[b] = Math.min(1, pk);
    low[b] = Math.min(1, lo);
    mid[b] = Math.min(1, mi);
    high[b] = Math.min(1, hi);
  }
  return { peaks, low, mid, high, peaksPerSecond: sampleRate / bucket };
}

/** Loudest bucket, used to normalise quiet masters so every waveform fills the view. */
export function maxPeak(peaks: Float32Array): number {
  let m = 0;
  for (let i = 0; i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
  return m;
}

/**
 * Value at a fractional bucket position. Zoomed in past the analysis
 * resolution, neighbouring buckets are blended so the drawing stays smooth
 * instead of stepping.
 */
export function sampleAt(arr: Float32Array, pos: number): number {
  if (pos <= 0) return arr[0] ?? 0;
  const i = Math.floor(pos);
  if (i >= arr.length - 1) return arr[arr.length - 1] ?? 0;
  const f = pos - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}
