/**
 * Undo / redo history over immutable states.
 *
 * Every change is a step, except that changes sharing a merge key in quick
 * succession (a cue being dragged, a BPM being typed) fold into one step, so
 * one ⌘Z undoes the whole drag rather than its last pixel.
 */

export const HISTORY_LIMIT = 100;
/** Changes with the same key closer together than this become one step. */
export const MERGE_MS = 800;

export interface Step<T> {
  state: T;
  /** What the change after this state did, e.g. "Move cue". */
  label: string;
}

export interface History<T> {
  past: Step<T>[];
  present: T;
  future: Step<T>[];
  lastKey?: string;
  lastAt: number;
}

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastAt: 0 };
}

export function record<T>(h: History<T>, next: T, label: string, key: string | undefined, now: number): History<T> {
  if (next === h.present) return h;
  const merge = key !== undefined && key === h.lastKey && now - h.lastAt < MERGE_MS && h.past.length > 0;
  return {
    past: merge ? h.past : [...h.past, { state: h.present, label }].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (!prev) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev.state,
    future: [{ state: h.present, label: prev.label }, ...h.future],
    lastAt: 0,
  };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (!next) return h;
  return {
    past: [...h.past, { state: h.present, label: next.label }],
    present: next.state,
    future: h.future.slice(1),
    lastAt: 0,
  };
}
