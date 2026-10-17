import { describe, expect, it } from 'vitest';
import { emptyProject, newSet, type Cue, type Project, type Track } from '../model';
import { copySet, cueDiffSummary, cueHistory, missingTracksFor, pruneVersions, sameCues, summarize, type VersionMeta } from '../versions';
import { reducer } from '../../ui/store';

const cue = (start: number, slot: number | null, name = ''): Cue => ({
  id: `c${start}${slot}`,
  kind: 'cue',
  slot,
  start,
  name,
  color: '#e62828',
});
const track = (id: string, cues: Cue[] = []): Track => ({ id, title: id, artist: 'A', cues, source: 'manual' });
const meta = (id: string, createdAt: number, auto = false): VersionMeta => ({
  id,
  name: id,
  createdAt,
  auto,
  summary: { tracks: 0, cues: 0, sets: [] },
});
const projectWith = (tracks: Track[]): Project => {
  const p = emptyProject();
  p.library.tracks = Object.fromEntries(tracks.map((t) => [t.id, t]));
  return p;
};

describe('copying sets', () => {
  it('gives the copy fresh ids but keeps entries in their chapters', () => {
    const set = newSet('Friday');
    set.entries = [{ id: 'e1', trackId: 't1', chapterId: set.chapters[2].id, energy: 8, transition: 'cut', notes: '' }];
    const copy = copySet(set);
    expect(copy.name).toBe('Friday (copy)');
    expect(copy.id).not.toBe(set.id);
    expect(copy.chapters.map((c) => c.name)).toEqual(set.chapters.map((c) => c.name));
    expect(copy.chapters.every((c, i) => c.id !== set.chapters[i].id)).toBe(true);
    expect(copy.entries[0]).toMatchObject({ trackId: 't1', energy: 8, transition: 'cut', chapterId: copy.chapters[2].id });
    expect(copy.entries[0].id).not.toBe('e1');

    copy.entries[0].energy = 2;
    expect(set.entries[0].energy).toBe(8); // deep copy
  });

  it('duplicates the set right after the original and switches to it', () => {
    let p = emptyProject();
    p = reducer(p, { type: 'addSet' });
    const first = p.sets[0];
    p = reducer(p, { type: 'duplicateSet', id: first.id });
    expect(p.sets.map((s) => s.name)).toEqual(['My first set', 'My first set (copy)', 'Set 2']);
    expect(p.activeSetId).toBe(p.sets[1].id);
  });

  it('copies a set out of an old version and restores tracks it needs', () => {
    const old = projectWith([track('t1'), track('t2')]);
    old.sets[0].entries = ['t1', 't2'].map((id, i) => ({
      id: `e${i}`,
      trackId: id,
      chapterId: old.sets[0].chapters[0].id,
      energy: 5,
      transition: '',
      notes: '',
    }));
    let now = projectWith([track('t1', [cue(5, 0, 'kept')])]);
    const missing = missingTracksFor(old.sets[0], old, now);
    expect(missing.map((t) => t.id)).toEqual(['t2']);
    now = reducer(now, { type: 'addSetCopy', set: old.sets[0], name: 'Old plan', tracks: [...missing, track('t1')] });
    expect(now.sets).toHaveLength(2);
    expect(now.activeSetId).toBe(now.sets[1].id);
    expect(Object.keys(now.library.tracks).sort()).toEqual(['t1', 't2']);
    expect(now.library.tracks.t1.cues[0].name).toBe('kept'); // existing tracks untouched
  });
});

describe('versions', () => {
  it('keeps every manual version and only the newest automatic ones', () => {
    const list = [meta('m1', 1), ...Array.from({ length: 5 }, (_, i) => meta(`a${i}`, 10 + i, true)), meta('m2', 100)];
    const { keep, drop } = pruneVersions(list, 3);
    expect(keep.map((v) => v.id)).toEqual(['m2', 'a4', 'a3', 'a2', 'm1']);
    expect(drop.map((v) => v.id)).toEqual(['a1', 'a0']);
  });

  it('summarises a project', () => {
    const p = projectWith([track('t1', [cue(1, 0), cue(2, null)]), track('t2')]);
    expect(summarize(p)).toMatchObject({ tracks: 2, cues: 2, sets: [{ name: 'My first set', entries: 0 }] });
  });

  it('compares cues ignoring ids, order and provenance', () => {
    const a = [cue(1, 0, 'x'), cue(2, null)];
    const b = [{ ...cue(2, null), id: 'other', edited: true }, cue(1, 0, 'x')];
    expect(sameCues(a, b)).toBe(true);
    expect(sameCues(a, [cue(1, 0, 'y'), cue(2, null)])).toBe(false);
  });

  it('lists distinct earlier states of a track, newest first', () => {
    const v = (id: string, at: number, cues: Cue[]) => ({ meta: meta(id, at), project: projectWith([track('t', cues)]) });
    const current = [cue(1, 0, 'now')];
    const history = cueHistory('t', current, [
      v('oldest', 1, [cue(1, 0, 'first')]),
      v('middle', 2, [cue(1, 0, 'second')]),
      v('same-as-middle', 3, [cue(1, 0, 'second')]),
      v('same-as-now', 4, [cue(1, 0, 'now')]),
      { meta: meta('no-track', 5), project: projectWith([]) },
    ]);
    expect(history.map((h) => h.version.id)).toEqual(['same-as-middle', 'oldest']);
  });

  it('describes how earlier cues differ from now', () => {
    const then = [cue(63.066, 1, 'Drop'), cue(10, null)];
    const now = [cue(63.066, 1, 'Renamed drop'), cue(90, 3, 'Break')];
    expect(cueDiffSummary(then, now)).toEqual([
      'B: 1:03 "Drop" (now 1:03 "Renamed drop")',
      'D: empty (now 1:30 "Break")',
      '1 memory cue (now 0)',
    ]);
    expect(cueDiffSummary(now, now)).toEqual([]);
  });
});
