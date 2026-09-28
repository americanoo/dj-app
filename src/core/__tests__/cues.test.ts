import { describe, expect, it } from 'vitest';
import { dragCue, findCueHandle, MIN_LOOP, moveCueToSlot } from '../cues';
import { CUE_COLORS, type Cue } from '../model';
import { snapToBeat } from '../time';

const cue = (id: string, start: number, slot: number | null, extra: Partial<Cue> = {}): Cue => ({
  id,
  kind: 'cue',
  slot,
  start,
  name: '',
  color: slot !== null ? CUE_COLORS[slot] : CUE_COLORS[0],
  ...extra,
});
const loop = (id: string, start: number, end: number, slot: number | null = null) =>
  cue(id, start, slot, { kind: 'loop', end });

describe('grabbing cues on the waveform', () => {
  const cues = [cue('a', 10, 0), cue('b', 10.05, 1), loop('l', 20, 28)];

  it('picks the nearest handle within the tolerance', () => {
    // 100 px per second: 0.03 s = 3 px from a, 2 px from b
    expect(findCueHandle(cues, 10.03, 100)?.cue.id).toBe('b');
    expect(findCueHandle(cues, 10.2, 100)).toBeUndefined();
  });

  it('exposes the end of a loop for resizing', () => {
    expect(findCueHandle(cues, 20.02, 100)).toMatchObject({ edge: 'start' });
    expect(findCueHandle(cues, 27.97, 100)).toMatchObject({ edge: 'end' });
    // Tiny loop at low zoom: both edges in range, the end wins so it can still grow.
    expect(findCueHandle([loop('t', 5, 5.01)], 5.005, 100)).toMatchObject({ edge: 'end' });
  });

  it('lets the letter flag to the right of a marker be grabbed', () => {
    const one = [cue('a', 10, 0)];
    // 12 px right of the line: outside the line's reach, but on a 16 px flag.
    expect(findCueHandle(one, 10.12, 100)).toBeUndefined();
    expect(findCueHandle(one, 10.12, 100, 7, 16)?.cue.id).toBe('a');
    // The flag only reaches right; left of the line keeps the normal tolerance.
    expect(findCueHandle(one, 9.88, 100, 7, 16)).toBeUndefined();
    expect(findCueHandle(one, 10.2, 100, 7, 16)).toBeUndefined();
  });
});

describe('dragging', () => {
  const snap = (s: number) => snapToBeat(s, 120, 0); // 0.5 s beats

  it('moves a cue with snapping, or freely', () => {
    expect(dragCue(cue('a', 10, 0), 'start', 12.3, 300, snap)).toEqual({ start: 12.5, end: undefined });
    expect(dragCue(cue('a', 10, 0), 'start', 12.3, 300)).toEqual({ start: 12.3, end: undefined });
  });

  it('moves a whole loop and keeps its length', () => {
    expect(dragCue(loop('l', 20, 28), 'start', 30.2, 300, snap)).toEqual({ start: 30, end: 38 });
  });

  it('resizes a loop from its end, never below the minimum', () => {
    expect(dragCue(loop('l', 20, 28), 'end', 24.1, 300, snap)).toEqual({ start: 20, end: 24 });
    expect(dragCue(loop('l', 20, 28), 'end', 10, 300)).toEqual({ start: 20, end: 20 + MIN_LOOP });
  });

  it('stays inside the track', () => {
    expect(dragCue(cue('a', 10, 0), 'start', -5, 300)).toEqual({ start: 0, end: undefined });
    expect(dragCue(loop('l', 20, 28), 'start', 299, 300)).toEqual({ start: 292, end: 300 });
    expect(dragCue(loop('l', 20, 28), 'end', 400, 300)).toEqual({ start: 20, end: 300 });
  });
});

describe('moving cues between pads', () => {
  it('moves to an empty pad and takes its default colour', () => {
    const out = moveCueToSlot([cue('a', 10, 0)], 'a', 3);
    expect(out[0]).toMatchObject({ slot: 3, color: CUE_COLORS[3] });
  });

  it('keeps custom colours', () => {
    const out = moveCueToSlot([cue('a', 10, 0, { color: '#123456' })], 'a', 3);
    expect(out[0].color).toBe('#123456');
  });

  it('swaps with the cue already on that pad', () => {
    const out = moveCueToSlot([cue('a', 10, 0), cue('b', 20, 2)], 'a', 2);
    expect(out.map((c) => [c.id, c.slot, c.color])).toEqual([
      ['a', 2, CUE_COLORS[2]],
      ['b', 0, CUE_COLORS[0]],
    ]);
  });

  it('turns pads into memory cues and back', () => {
    const toMemory = moveCueToSlot([cue('a', 10, 1)], 'a', null);
    expect(toMemory[0].slot).toBeNull();
    // A memory cue dropped on a taken pad swaps: the occupant becomes a memory cue.
    const swapped = moveCueToSlot([cue('m', 5, null), cue('b', 20, 2)], 'm', 2);
    expect(swapped.map((c) => [c.id, c.slot])).toEqual([
      ['m', 2],
      ['b', null],
    ]);
  });
});
