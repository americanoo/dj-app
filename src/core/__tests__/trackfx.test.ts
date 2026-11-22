import { describe, expect, it } from 'vitest';
import { valueAt } from '../mixplan';
import { emptyProject, newSet, type SetEntry, type Track } from '../model';
import { buildTimeline, nightSlots, reorderEntries } from '../setplan';
import { setTrackMixPoint, stemsAt, trackFxCurves, trackMixCue } from '../trackfx';
import { activeSet, reducer } from '../../ui/store';

const place = { startsAt: 100, playFor: 200, mixIn: 20, bpm: 120 }; // a bar is 2 s; song 20 s plays at night 100 s

describe("a track's own effects in the night", () => {
  it('a keyframe region builds echo / filter up across it and lets go at its end', () => {
    const c = trackFxCurves({ ...place, fx: [{ id: 'r', from: 60, to: 68, tools: ['echo', 'filter'] }] });
    // song 60–68 plays at night 140–148
    expect(valueAt(c.echo, 139, 0)).toBe(0);
    expect(valueAt(c.echo, 144, 0)).toBeCloseTo(0.4, 2);
    expect(valueAt(c.filter, 147.99, 0)).toBeCloseTo(0.85, 2);
    expect(valueAt(c.filter, 148.5, 0)).toBe(0);
  });

  it('kill lows, acapella and instrumental are on between the keyframes', () => {
    const c = trackFxCurves({ ...place, fx: [{ id: 'r', from: 60, to: 70, tools: ['killLows', 'instrumental'] }] });
    expect(valueAt(c.bass, 145, 0)).toBe(-40);
    expect(valueAt(c.mid, 145, 0)).toBe(-24);
    expect(valueAt(c.bass, 151, 0)).toBe(0);
    const a = trackFxCurves({ ...place, fx: [{ id: 'r', from: 60, to: 70, tools: ['acapella'] }] });
    expect(valueAt(a.high, 145, 0)).toBe(-18);
    // Only a start keyframe so far: it runs 4 bars.
    const open = trackFxCurves({ ...place, fx: [{ id: 'r', from: 60, tools: ['killLows'] }] });
    expect(valueAt(open.bass, 147, 0)).toBe(-40);
    expect(valueAt(open.bass, 149, 0)).toBe(0);
  });

  it('end FX happen as the track reaches its end time', () => {
    const c = trackFxCurves({ ...place, endFx: ['echo', 'killLows'] });
    // ends at night 300: echo over the last 4 bars, lows cut 2 bars before
    expect(valueAt(c.echo, 292, 0)).toBe(0);
    expect(valueAt(c.echo, 300, 0)).toBeCloseTo(0.8);
    expect(valueAt(c.bass, 295, 0)).toBe(0);
    expect(valueAt(c.bass, 297, 0)).toBe(-40);
  });

  it('stem levels become EQ (a preview until real stems): vocals the mids, instrumental the lows and highs', () => {
    const stems = [
      { t: 40, vocals: 1, inst: 0.1 },
      { t: 80, vocals: 0.5, inst: 1 },
    ];
    const c = trackFxCurves({ ...place, stems });
    expect(valueAt(c.bass, 120, 0)).toBeCloseTo(-20);
    expect(valueAt(c.mid, 120, 0)).toBe(0);
    expect(valueAt(c.mid, 160, 0)).toBeCloseTo(-6.02, 1);
    expect(stemsAt(stems, 50)).toEqual({ vocals: 1, inst: 0.1 });
    expect(stemsAt(stems, 10)).toEqual({ vocals: 1, inst: 1 });
  });

  it('reaches the night: the slot carries its effects, and the end FX fall back to the track’s own', () => {
    const t: Track = { id: 't', title: 'T', artist: 'A', cues: [], source: 'manual', duration: 200, bpm: 120, endFx: ['killLows'] };
    const set = newSet('S');
    const e: SetEntry = { id: 'e', trackId: 't', chapterId: set.chapters[0].id, energy: 5, transition: '', notes: '', at: 0, fx: [{ id: 'r', from: 10, to: 20, tools: ['reverb'] }] };
    set.entries = [e];
    const [slot] = nightSlots(buildTimeline(set, { tracks: { t }, playlists: [] }));
    expect(slot.endFx).toEqual(['killLows']);
    expect(valueAt(slot.curves.reverb, 19, 0)).toBeGreaterThan(0.7);
    expect(valueAt(slot.curves.bass, 199, 0)).toBe(-40);
  });
});

describe("a track's own play-from / play-until", () => {
  it('Mix in / Mix out cues set in the library become the mix points when it goes into the night', () => {
    const cues = [
      { id: 'i', kind: 'cue' as const, slot: null, start: 30, name: 'Mix in', color: '#fff' },
      { id: 'o', kind: 'cue' as const, slot: null, start: 200, name: 'Mix out', color: '#fff' },
    ];
    const t: Track = { id: 't', title: 'T', artist: 'A', cues, source: 'manual', duration: 240 };
    expect(trackMixCue(t, 'in')?.start).toBe(30);
    const p0 = emptyProject();
    const p = reducer({ ...p0, library: { tracks: { t }, playlists: [] } }, { type: 'addEntries', trackIds: ['t'] });
    expect(activeSet(p).entries[0]).toMatchObject({ mixInCueId: 'i', mixOutCueId: 'o' });
  });
});

describe('setting play-from / play-until in the library', () => {
  it('adds, moves and removes the Mix in / Mix out cue', () => {
    const t: Track = { id: 't', title: 'T', artist: 'A', cues: [], source: 'manual', duration: 240 };
    const added = setTrackMixPoint(t, 'out', 200);
    expect(trackMixCue({ ...t, cues: added }, 'out')?.start).toBe(200);
    const moved = setTrackMixPoint({ ...t, cues: added }, 'out', 180);
    expect(moved).toHaveLength(1);
    expect(moved[0].start).toBe(180);
    expect(setTrackMixPoint({ ...t, cues: moved }, 'out', undefined)).toHaveLength(0);
  });
});

describe('reordering the night', () => {
  it('tracks swap places and each place keeps its overlap', () => {
    const mk = (id: string, duration: number): Track => ({ id, title: id, artist: '', cues: [], source: 'manual', duration });
    const tracks = { a: mk('a', 100), b: mk('b', 200), c: mk('c', 150) };
    const set = newSet('S');
    const e = (id: string, at: number): SetEntry => ({ id, trackId: id, chapterId: set.chapters[0].id, energy: 5, transition: '', notes: '', at });
    // a 0–100, b starts 10 s before a ends (90–290), c starts 20 s before b ends (270–420)
    set.entries = [e('a', 0), e('b', 90), e('c', 270)];
    const out = reorderEntries(set, { tracks, playlists: [] }, ['c', 'a', 'b']);
    expect(out.map((x) => [x.id, x.at])).toEqual([
      ['c', 0],
      ['a', 140], // c is 150 long, 10 s overlap
      ['b', 220], // a is 100 long, 20 s overlap
    ]);
  });
});
