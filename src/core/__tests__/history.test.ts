import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, initHistory, record, redo, undo } from '../history';

describe('undo history', () => {
  it('undoes and redoes steps in order', () => {
    let h = initHistory('a');
    h = record(h, 'b', 'B', undefined, 0);
    h = record(h, 'c', 'C', undefined, 10);
    h = undo(h);
    expect(h.present).toBe('b');
    expect(h.future[0].label).toBe('C');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(undo(h)).toBe(h); // nothing left
    h = redo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    expect(redo(h)).toBe(h);
  });

  it('folds quick changes with the same key into one step', () => {
    let h = initHistory(0);
    h = record(h, 1, 'Move cue', 'cue:t1', 1000);
    h = record(h, 2, 'Move cue', 'cue:t1', 1016);
    h = record(h, 3, 'Move cue', 'cue:t1', 1032);
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(0);
    // a pause, or a different key, starts a new step
    h = record(h, 4, 'Move cue', 'cue:t1', 5000);
    h = record(h, 5, 'Edit BPM', 'track:t1', 5010);
    expect(h.past).toHaveLength(3);
  });

  it('drops the redo branch after a new change, and caps its length', () => {
    let h = initHistory(0);
    h = record(h, 1, 'x', undefined, 0);
    h = undo(h);
    h = record(h, 2, 'y', undefined, 10);
    expect(h.future).toEqual([]);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, 100 + i, 'z', undefined, 100 + i * 2000);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });

  it('ignores changes that change nothing', () => {
    const h = initHistory({ a: 1 });
    expect(record(h, h.present, 'x', undefined, 0)).toBe(h);
  });
});
