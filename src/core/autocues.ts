/**
 * Automatic cue points from a track's detected sections.
 *
 * Each section change is a candidate (the first downbeat, the drop, each
 * breakdown, the outro…). When there are more candidates than free pads, the
 * ones a DJ reaches for most win: the start, the first drop, the outro, the
 * first breakdown and build. When the sections leave pads free (a song whose
 * bass never drops out is one long section), the biggest phrase changes fill
 * the rest, spread across the track. Chosen cues go on the pads in time order,
 * so A is always the earliest. Optional 4-bar loops at the intro and outro help mixing.
 */
import { MAX_HOT_CUES, type Cue } from './model';
import { SECTION_LABELS, type PhraseChange, type Section, type SectionKind } from './sections';
import { beatLength, round } from './time';

export type AutoCueMode = 'fill' | 'replace' | 'memory';

export interface AutoCueOptions {
  /**
   * fill: only empty pads, keeping every cue you have.
   * replace: all eight pads; your existing hot cues become memory cues.
   * memory: memory cues, pads untouched.
   */
  mode: AutoCueMode;
  /** Also add 4-bar memory loops at the intro and the outro. */
  mixLoops: boolean;
  bpm?: number;
  gridStart?: number;
  colorOf: (kind: SectionKind) => string;
  newId: () => string;
  /** Phrase changes (see phraseChanges) used to fill pads the sections leave free. */
  fillers?: PhraseChange[];
}

export interface AutoCuePlan {
  /** The track's full cue list after applying. */
  cues: Cue[];
  /** Just the cues this adds. */
  added: Cue[];
  /** Existing hot cues moved off their pads (replace mode). */
  demoted: number;
}

interface Candidate {
  start: number;
  kind: SectionKind;
  name: string;
  rank: number;
}

const FIRST_RANK: Partial<Record<SectionKind, number>> = { drop: 1, outro: 2, breakdown: 3, build: 4, main: 5 };
const MIX_LOOP_BEATS = 16;

/** Section changes worth a cue, named ("Drop", "Drop 2") and ranked by usefulness. */
export function cueCandidates(sections: Section[], gridStart = 0): Candidate[] {
  const seen: Partial<Record<SectionKind, number>> = {};
  return sections.map((sec, i) => {
    const n = (seen[sec.kind] = (seen[sec.kind] ?? 0) + 1);
    // The first cue sits on the first downbeat rather than at 0:00 of the file.
    const start = i === 0 && sec.start < 0.5 && gridStart > 0 && gridStart < sec.end ? gridStart : sec.start;
    // A track that starts straight into the groove starts with "Start", not "Main".
    const name = i === 0 && sec.kind === 'main' ? 'Start' : n === 1 ? SECTION_LABELS[sec.kind] : `${SECTION_LABELS[sec.kind]} ${n}`;
    let rank: number;
    if (i === 0) rank = 0;
    else if (n === 1) rank = FIRST_RANK[sec.kind] ?? 6;
    else rank = sec.kind === 'drop' ? 6 : sec.kind === 'breakdown' ? 7 : 8 + i;
    return { start: round(start, 3), kind: sec.kind, name, rank };
  });
}

export function planAutoCues(existing: Cue[], sections: Section[], o: AutoCueOptions): AutoCuePlan {
  const beat = o.bpm && o.bpm > 0 ? beatLength(o.bpm) : undefined;
  // Two cues closer than this are the same point.
  const near = Math.max(0.25, (beat ?? 0.5) * 0.9);
  const candidates = cueCandidates(sections, o.gridStart);

  let base = existing;
  let demoted = 0;
  if (o.mode === 'replace') {
    base = existing.map((c) => {
      if (c.slot === null) return c;
      demoted++;
      return { ...c, slot: null, edited: true };
    });
  }

  const added: Cue[] = [];
  if (o.mode === 'memory') {
    for (const c of candidates) {
      if (base.some((e) => Math.abs(e.start - c.start) < near)) continue;
      added.push({ id: o.newId(), kind: 'cue', slot: null, start: c.start, name: c.name, color: o.colorOf(c.kind), origin: 'manual' });
    }
  } else {
    const used = new Set(base.filter((c) => c.slot !== null).map((c) => c.slot));
    const free = Array.from({ length: MAX_HOT_CUES }, (_, i) => i).filter((i) => !used.has(i));
    // Points already on a pad don't need another one.
    const wanted = candidates.filter((c) => !base.some((e) => e.slot !== null && Math.abs(e.start - c.start) < near));
    const chosen = [...wanted].sort((a, b) => a.rank - b.rank).slice(0, free.length);
    // Pads still free: the biggest phrase changes, kept apart so they spread
    // over the track (16 bars apart if possible, then 8, then 4).
    const bar = beat ? beat * 4 : 2;
    const taken = () => [...chosen.map((c) => c.start), ...base.filter((c) => c.slot !== null).map((c) => c.start)];
    const fillers = [...(o.fillers ?? [])].sort((a, b) => b.score - a.score);
    for (const gapBars of [16, 8, 4]) {
      for (const f of fillers) {
        if (chosen.length >= free.length) break;
        if (taken().some((t) => Math.abs(t - f.start) < gapBars * bar - 0.01)) continue;
        const kind: SectionKind = f.lift > 0.25 ? 'build' : f.lift < -0.25 ? 'breakdown' : 'main';
        // Only call it a change if something really changes; otherwise it's just the next phrase.
        const name = f.score < 0.2 ? 'Phrase' : f.lift > 0.25 ? 'Lift' : f.lift < -0.25 ? 'Dip' : 'Switch';
        chosen.push({ start: round(f.start, 3), kind, name, rank: 100 });
      }
    }
    chosen.sort((a, b) => a.start - b.start);
    const count: Record<string, number> = {};
    chosen.forEach((c, i) => {
      // Phrase-change cues can repeat ("Lift", "Lift 2").
      const n = c.rank === 100 ? (count[c.name] = (count[c.name] ?? 0) + 1) : 1;
      const name = n > 1 ? `${c.name} ${n}` : c.name;
      added.push({ id: o.newId(), kind: 'cue', slot: free[i], start: c.start, name, color: o.colorOf(c.kind), origin: 'manual' });
    });
  }

  if (o.mixLoops && beat) {
    const len = MIX_LOOP_BEATS * beat;
    const intro = candidates[0];
    const outro = candidates.find((c) => c.kind === 'outro');
    for (const [c, name] of [
      [intro, intro?.kind === 'intro' ? 'Intro loop' : 'Start loop'],
      [outro, 'Outro loop'],
    ] as const) {
      if (!c) continue;
      const hasLoop = [...base, ...added].some((e) => e.kind === 'loop' && Math.abs(e.start - c.start) < near);
      if (hasLoop) continue;
      added.push({
        id: o.newId(),
        kind: 'loop',
        slot: null,
        start: c.start,
        end: round(c.start + len, 3),
        name,
        color: o.colorOf(c.kind),
        origin: 'manual',
      });
    }
  }

  return { cues: [...base, ...added], added, demoted };
}
