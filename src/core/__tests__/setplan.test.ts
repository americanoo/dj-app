import { describe, expect, it } from 'vitest';
import { newSet, type Library, type Track } from '../model';
import { buildTimeline, setPlanMarkdown, totalSeconds } from '../setplan';
import { reducer } from '../../ui/store';
import { emptyProject } from '../model';

const track = (id: string, patch: Partial<Track> = {}): Track => ({
  id,
  title: id.toUpperCase(),
  artist: 'Artist',
  cues: [],
  source: 'manual',
  ...patch,
});

describe('set timeline', () => {
  const lib: Library = {
    tracks: {
      a: track('a', { duration: 300, bpm: 120, key: 'Am' }),
      b: track('b', {
        duration: 400,
        bpm: 124,
        key: 'Em',
        cues: [
          { id: 'in', kind: 'cue', slot: 0, start: 30, name: 'In', color: '#e62828' },
          { id: 'out', kind: 'cue', slot: 1, start: 330, name: 'Out', color: '#e62828' },
        ],
      }),
      c: track('c', { duration: 360, bpm: 140, key: 'F#' }),
    },
    playlists: [],
  };
  const set = newSet('Test');
  const ch = set.chapters[0].id;
  set.entries = [
    { id: '1', trackId: 'a', chapterId: ch, energy: 3, transition: '', notes: '' },
    { id: '2', trackId: 'b', chapterId: ch, energy: 5, transition: 'bass swap', notes: '', mixInCueId: 'in', mixOutCueId: 'out' },
    { id: '3', trackId: 'c', chapterId: ch, energy: 8, transition: '', notes: '' },
  ];

  it('uses mix-in/out cues for play length', () => {
    const tl = buildTimeline(set, lib);
    expect(tl.map((t) => t.startsAt)).toEqual([0, 300, 600]);
    expect(tl[1]).toMatchObject({ playFor: 300, estimated: false, keyRelation: 'adjacent' });
    expect(totalSeconds(tl)).toBe(960);
  });

  it('flags key clashes and big BPM jumps', () => {
    const tl = buildTimeline(set, lib);
    expect(tl[1].warnings).toEqual([]);
    expect(tl[2].keyRelation).toBe('clash');
    expect(tl[2].warnings.join()).toMatch(/Key clash.*BPM jump \+12\.9%/);
  });

  it('renders a run sheet', () => {
    const md = setPlanMarkdown(set, lib);
    expect(md).toContain('# Test');
    expect(md).toContain('## Warm-up');
    expect(md).toContain('↪ Transition: bass swap');
    expect(md).toContain('Cues: A 0:30 "In", B 5:30 "Out"');
  });
});

describe('set reducer', () => {
  it('keeps chapters contiguous when adding and moving entries', () => {
    let p = emptyProject();
    const [warm, build] = p.sets[0].chapters;
    p = reducer(p, { type: 'addEntries', trackIds: ['x', 'y'], chapterId: build.id });
    p = reducer(p, { type: 'addEntries', trackIds: ['w'], chapterId: warm.id });
    const ids = () => p.sets[0].entries.map((e) => e.trackId);
    expect(ids()).toEqual(['w', 'x', 'y']);

    const y = p.sets[0].entries[2];
    p = reducer(p, { type: 'moveEntry', id: y.id, toIndex: 0, chapterId: warm.id });
    expect(ids()).toEqual(['y', 'w', 'x']);
    expect(p.sets[0].entries[0].chapterId).toBe(warm.id);

    p = reducer(p, { type: 'moveChapter', id: warm.id, delta: 1 });
    expect(ids()).toEqual(['x', 'y', 'w']);

    p = reducer(p, { type: 'removeChapter', id: build.id });
    expect(p.sets[0].entries.every((e) => e.chapterId === warm.id)).toBe(true);
  });
});
