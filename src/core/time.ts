/** Time & beat-grid helpers. Positions are seconds. */

export function formatTime(sec: number | undefined, withMs = true): string {
  if (sec === undefined || !Number.isFinite(sec)) return '--:--';
  const neg = sec < 0;
  const s = Math.abs(sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const body = withMs
    ? `${m}:${rest.toFixed(3).padStart(6, '0')}`
    : `${m}:${Math.floor(rest).toString().padStart(2, '0')}`;
  return neg ? '-' + body : body;
}

/** Accepts "83.5", "1:23.5", "1:02:03.25". Returns undefined on bad input. */
export function parseTime(input: string): number | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function beatLength(bpm: number): number {
  return 60 / bpm;
}

/** Snap a position to the nearest beat of the grid. */
export function snapToBeat(sec: number, bpm: number | undefined, gridStart = 0): number {
  if (!bpm || bpm <= 0) return sec;
  const beat = beatLength(bpm);
  return gridStart + Math.round((sec - gridStart) / beat) * beat;
}

/** Bar.beat label (1-based, 4/4) for a position, e.g. "33.1". */
export function barBeatLabel(sec: number, bpm: number | undefined, gridStart = 0): string | undefined {
  if (!bpm || bpm <= 0) return undefined;
  const beats = Math.round((sec - gridStart) / beatLength(bpm));
  const bar = Math.floor(beats / 4) + 1;
  const beat = (((beats % 4) + 4) % 4) + 1;
  return `${bar}.${beat}`;
}

export function beatsToSeconds(beats: number, bpm: number | undefined): number | undefined {
  if (!bpm || bpm <= 0) return undefined;
  return beats * beatLength(bpm);
}

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
