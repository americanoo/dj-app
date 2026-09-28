import { describe, expect, it } from 'vitest';
import { cueCandidates, planAutoCues, type AutoCueOptions } from '../autocues';
import type { Cue } from '../model';
import { phraseChanges, type PhraseChange, type Section } from '../sections';

// 120 BPM: a bar is 2 s, 8 bars 16 s.
const sections: Section[] = [
  { kind: 'intro', start: 0, end: 32 },
  { kind: 'main', start: 32, end: 64 },
  { kind: 'breakdown', start: 64, end: 80 },
  { kind: 'build', start: 80, end: 96 },
  { kind: 'drop', start: 96, end: 128 },
  { kind: 'breakdown', start: 128, end: 144 },
  { kind: 'drop', start: 144, end: 176 },
  { kind: 'main', start: 176, end: 192 },
  { kind: 'outro', start: 192, end: 224 },
];

let n = 0;
const opts = (o: Partial<AutoCueOptions> = {}): AutoCueOptions => ({
  mode: 'fill',
  mixLoops: false,
  bpm: 120,
  gridStart: 0.2,
  colorOf: (k) => `#${k.length}${k.length}${k.length}${k.length}${k.length}${k.length}`.slice(0, 7),
  newId: () => `auto${++n}`,
  ...o,
});
const cue = (id: string, start: number, slot: number | null, name = ''): Cue => ({ id, kind: 'cue', slot, start, name, color: '#ffffff' });
const pads = (cues: Cue[]) =>
  cues
    .filter((c) => c.slot !== null)
    .sort((a, b) => a.slot! - b.slot!)
    .map((c) => `${'ABCDEFGH'[c.slot!]}:${c.name}@${c.start}`);

describe('auto cues', () => {
  it('names repeated sections and starts on the first downbeat', () => {
    const c = cueCandidates(sections, 0.2);
    expect(c[0]).toMatchObject({ name: 'Intro', start: 0.2 });
    expect(c.map((x) => x.name)).toEqual(['Intro', 'Main', 'Breakdown', 'Build', 'Drop', 'Breakdown 2', 'Drop 2', 'Main 2', 'Outro']);
  });

  it('puts the eight most useful points on the pads, in time order', () => {
    const plan = planAutoCues([], sections, opts());
    // 9 candidates for 8 pads: "Main 2" is the least useful and is left out.
    expect(pads(plan.cues)).toEqual([
      'A:Intro@0.2',
      'B:Main@32',
      'C:Breakdown@64',
      'D:Build@80',
      'E:Drop@96',
      'F:Breakdown 2@128',
      'G:Drop 2@144',
      'H:Outro@192',
    ]);
  });

  it('fills only empty pads and skips points you already have on a pad', () => {
    const mine = [cue('a', 96.05, 0, 'My drop'), cue('b', 10, 1, 'Vocal')];
    const plan = planAutoCues(mine, sections, opts());
    expect(plan.cues.find((c) => c.id === 'a')?.slot).toBe(0);
    expect(plan.cues.find((c) => c.id === 'b')?.slot).toBe(1);
    expect(plan.added.some((c) => c.name === 'Drop')).toBe(false);
    // 6 free pads: start, outro, breakdown, build, main, drop 2 win.
    expect(plan.added.map((c) => c.name)).toEqual(['Intro', 'Main', 'Breakdown', 'Build', 'Drop 2', 'Outro']);
    expect(plan.added.map((c) => c.slot)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('replace mode keeps your hot cues as memory cues', () => {
    const plan = planAutoCues([cue('a', 50, 0, 'Vocal')], sections, opts({ mode: 'replace' }));
    expect(plan.demoted).toBe(1);
    expect(plan.cues.find((c) => c.id === 'a')).toMatchObject({ slot: null, name: 'Vocal' });
    expect(pads(plan.cues)).toHaveLength(8);
  });

  it('memory mode leaves the pads alone and skips points already cued', () => {
    const plan = planAutoCues([cue('a', 64, 2)], sections, opts({ mode: 'memory' }));
    expect(plan.added.every((c) => c.slot === null)).toBe(true);
    expect(plan.added.some((c) => c.start === 64)).toBe(false);
    expect(plan.added).toHaveLength(8);
  });

  it('adds 4-bar mix loops at the intro and outro', () => {
    const plan = planAutoCues([], sections, opts({ mixLoops: true }));
    const loops = plan.added.filter((c) => c.kind === 'loop');
    expect(loops.map((l) => [l.name, l.start, l.end])).toEqual([
      ['Intro loop', 0.2, 8.2],
      ['Outro loop', 192, 200],
    ]);
    // …but not twice
    expect(planAutoCues(plan.cues, sections, opts({ mixLoops: true })).added.filter((c) => c.kind === 'loop')).toEqual([]);
  });

  it('does nothing when every pad is taken', () => {
    const full = Array.from({ length: 8 }, (_, i) => cue(`c${i}`, 300 + i, i));
    expect(planAutoCues(full, sections, opts()).added).toEqual([]);
  });
});

describe('filling the pads when the sections are few', () => {
  // A song whose bass never drops out: one long section.
  const oneSection: Section[] = [{ kind: 'main', start: 0, end: 200 }];
  const changes: PhraseChange[] = [16, 32, 40, 48, 64, 72, 96, 104, 128, 144, 160, 176].map((t, i) => ({
    start: t,
    score: [0.9, 1.4, 0.2, 0.3, 1.2, 0.1, 1.1, 0.4, 0.8, 0.5, 0.7, 0.6][i],
    lift: i % 2 ? -0.5 : 0.5,
  }));

  it('fills all eight pads with the biggest changes, spread out', () => {
    const plan = planAutoCues([], oneSection, opts({ fillers: changes }));
    const got = pads(plan.cues);
    expect(got).toHaveLength(8);
    expect(got[0]).toBe('A:Start@0.2');
    // at 120 BPM, 16 bars = 32 s apart where possible
    const starts = plan.cues.filter((c) => c.slot !== null).map((c) => c.start).sort((a, b) => a - b);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(8);
    // repeated names are numbered
    expect(plan.added.map((c) => c.name).filter((n) => n.startsWith('Lift')).length).toBeGreaterThan(1);
    expect(new Set(plan.added.map((c) => c.name)).size).toBe(plan.added.length);
  });

  it('still fills only the free pads in fill mode', () => {
    const mine = Array.from({ length: 5 }, (_, i) => cue(`m${i}`, 150 + i * 4, i));
    const plan = planAutoCues(mine, oneSection, opts({ fillers: changes }));
    expect(plan.added.map((c) => c.slot)).toEqual([5, 6, 7]);
  });

  it('finds the phrase where the music changes, even with steady bass', () => {
    const pps = 10;
    const seconds = 120;
    const n = seconds * pps;
    const low = new Float32Array(n).fill(0.8);
    const mid = new Float32Array(n).fill(0.2);
    const high = new Float32Array(n).fill(0.1);
    // 120 BPM, grid at 0: bar 17 starts at 32 s. The mids (a vocal) come in there.
    for (let i = 32 * pps; i < n; i++) mid[i] = 0.7;
    const found = phraseChanges({ low, mid, high }, pps, seconds, 120, 0);
    const top = [...found].sort((a, b) => b.score - a.score)[0];
    expect(top.start).toBe(32);
    expect(top.lift).toBeGreaterThan(0);
  });
});
