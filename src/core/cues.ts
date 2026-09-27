/** Editing helpers for dragging cues on the waveform and between pads. */
import { CUE_COLORS, type Cue } from './model';
import { round } from './time';

export type CueEdge = 'start' | 'end';

/** Shortest loop a drag can make, seconds. */
export const MIN_LOOP = 0.02;

/**
 * The cue handle under a position, if any. `pxPerSec` converts the distance to
 * screen pixels. Loops also expose their end edge, for resizing.
 */
export function findCueHandle(
  cues: Cue[],
  sec: number,
  pxPerSec: number,
  tolerancePx = 7,
): { cue: Cue; edge: CueEdge } | undefined {
  let best: { cue: Cue; edge: CueEdge; d: number } | undefined;
  for (const cue of cues) {
    const dStart = Math.abs(cue.start - sec) * pxPerSec;
    if (dStart <= tolerancePx && (!best || dStart < best.d)) best = { cue, edge: 'start', d: dStart };
    if (cue.kind === 'loop' && cue.end !== undefined) {
      const dEnd = Math.abs(cue.end - sec) * pxPerSec;
      // Prefer the end edge on a tie so short loops can still be resized.
      if (dEnd <= tolerancePx && (!best || dEnd <= best.d)) best = { cue, edge: 'end', d: dEnd };
    }
  }
  return best && { cue: best.cue, edge: best.edge };
}

/**
 * New position for a dragged cue. Dragging the start moves the whole cue
 * (loops keep their length); dragging a loop's end resizes it. `snap` quantises
 * to the beat grid and is skipped when the DJ holds Shift.
 */
export function dragCue(
  original: Cue,
  edge: CueEdge,
  sec: number,
  duration: number,
  snap: (s: number) => number = (s) => s,
): Pick<Cue, 'start' | 'end'> {
  const len = original.end !== undefined ? original.end - original.start : undefined;
  if (edge === 'end' && original.end !== undefined) {
    const end = Math.min(duration, Math.max(original.start + MIN_LOOP, snap(sec)));
    return { start: original.start, end: round(end, 3) };
  }
  const maxStart = Math.max(0, duration - (len ?? 0));
  const start = round(Math.min(maxStart, Math.max(0, snap(sec))), 3);
  return { start, end: len !== undefined ? round(start + len, 3) : undefined };
}

/**
 * Put a cue on a pad (`slot` 0-7) or make it a memory cue (`null`). If the pad
 * is taken, the two cues swap places. Cues still wearing their pad's default
 * colour take on the new pad's colour.
 */
export function moveCueToSlot(cues: Cue[], cueId: string, slot: number | null): Cue[] {
  const moving = cues.find((c) => c.id === cueId);
  if (!moving || moving.slot === slot) return cues;
  const from = moving.slot;
  const occupant = slot === null ? undefined : cues.find((c) => c.slot === slot && c.id !== cueId);
  const recolor = (c: Cue, oldSlot: number | null, newSlot: number | null): string =>
    oldSlot !== null && newSlot !== null && c.color.toLowerCase() === CUE_COLORS[oldSlot] ? CUE_COLORS[newSlot] : c.color;
  return cues.map((c) => {
    if (c.id === cueId) return { ...c, slot, color: recolor(c, from, slot) };
    if (occupant && c.id === occupant.id) return { ...c, slot: from, color: recolor(c, slot, from) };
    return c;
  });
}
