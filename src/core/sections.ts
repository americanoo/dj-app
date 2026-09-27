/**
 * Find the parts of a dance track (intro, breakdown, build, drop, outro) from
 * its three-band waveform.
 *
 * The main signal is bass: sections where the kick and bassline drop out are
 * intros, breakdowns and outros; sections with full bass are the main parts
 * and drops. The track is measured bar by bar (or in 2-second steps without a
 * BPM) and decided in 8-bar phrases, the building block of most dance music.
 */
import type { WaveformBands } from './waveform';

export type SectionKind = 'intro' | 'breakdown' | 'build' | 'drop' | 'main' | 'outro';

export interface Section {
  kind: SectionKind;
  /** Seconds. */
  start: number;
  end: number;
}

export const SECTION_LABELS: Record<SectionKind, string> = {
  intro: 'Intro',
  breakdown: 'Breakdown',
  build: 'Build',
  drop: 'Drop',
  main: 'Main',
  outro: 'Outro',
};

/** A section counts as "full" when its bass reaches this share of the track's typical bass. */
const BASS_THRESHOLD = 0.45;
const PHRASE_BARS = 8;
const PHRASE_SECONDS_NO_BPM = 16;

interface Window {
  start: number;
  end: number;
  bass: number;
  top: number; // mids + highs
}

function mean(arr: Float32Array, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(arr.length, Math.ceil(to));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += arr[i];
  return s / (b - a);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function detectSections(
  bands: WaveformBands,
  peaksPerSecond: number,
  duration: number,
  bpm?: number,
  gridStart = 0,
): Section[] {
  if (!(duration > 0) || !bands.low.length) return [];

  // 1. Measure: one window per bar (or 2 s), aligned to the beat grid.
  const barLen = bpm && bpm > 0 ? (4 * 60) / bpm : 2;
  const phrase = bpm && bpm > 0 ? PHRASE_BARS * barLen : PHRASE_SECONDS_NO_BPM;
  const origin = bpm && bpm > 0 ? gridStart - Math.ceil(gridStart / barLen) * barLen : 0;
  // Phrases count from the first downbeat, so bar 1 always starts a phrase.
  const phraseOrigin = bpm && bpm > 0 ? gridStart - Math.ceil(gridStart / phrase) * phrase : 0;
  const windows: Window[] = [];
  for (let t = origin; t < duration; t += barLen) {
    const s = Math.max(0, t);
    const e = Math.min(duration, t + barLen);
    if (e - s < barLen * 0.25) continue;
    const i0 = s * peaksPerSecond;
    const i1 = e * peaksPerSecond;
    windows.push({ start: s, end: e, bass: mean(bands.low, i0, i1), top: mean(bands.mid, i0, i1) + mean(bands.high, i0, i1) });
  }
  if (!windows.length) return [];

  // 2. Decide per phrase: full bass or not, relative to the track's own loud parts.
  const reference = percentile(
    windows.map((w) => w.bass),
    0.9,
  );
  if (reference <= 0.01) return [{ kind: 'main', start: 0, end: duration }];
  interface Phrase {
    start: number;
    end: number;
    bars: Window[];
    full: boolean;
    top: number;
  }
  const phrases: Phrase[] = [];
  for (const w of windows) {
    const pStart = Math.max(0, phraseOrigin + Math.floor((w.start - phraseOrigin + 1e-6) / phrase) * phrase);
    let p = phrases[phrases.length - 1];
    if (!p || p.start !== pStart) {
      p = { start: pStart, end: w.end, bars: [], full: false, top: 0 };
      phrases.push(p);
    }
    p.end = w.end;
    p.bars.push(w);
  }
  for (const p of phrases) {
    const fullBars = p.bars.filter((b) => b.bass / reference >= BASS_THRESHOLD).length;
    p.full = fullBars * 2 >= p.bars.length;
    p.top = p.bars.reduce((sum, b) => sum + b.top, 0) / p.bars.length;
  }

  // 3. Merge phrases into runs of full / quiet.
  const runs: { start: number; end: number; full: boolean; phrases: Phrase[] }[] = [];
  for (const p of phrases) {
    const last = runs[runs.length - 1];
    if (last && last.full === p.full) {
      last.end = p.end;
      last.phrases.push(p);
    } else runs.push({ start: p.start, end: p.end, full: p.full, phrases: [p] });
  }

  // 4. Name them. Quiet runs: intro at the start, outro at the end, breakdown
  //    in between (its last phrase is a build if it gets clearly busier up top).
  //    Full runs: a drop when they follow a breakdown, otherwise the main groove.
  const sections: Section[] = [];
  runs.forEach((r, i) => {
    if (r.full) {
      const afterBreakdown = i >= 2 && !runs[i - 1].full;
      sections.push({ kind: afterBreakdown ? 'drop' : 'main', start: r.start, end: r.end });
      return;
    }
    const kind: SectionKind = i === 0 ? 'intro' : i === runs.length - 1 ? 'outro' : 'breakdown';
    if (kind === 'breakdown' && r.phrases.length >= 2) {
      const lastP = r.phrases[r.phrases.length - 1];
      if (lastP.top > r.phrases[0].top * 1.25) {
        sections.push({ kind: 'breakdown', start: r.start, end: lastP.start });
        sections.push({ kind: 'build', start: lastP.start, end: r.end });
        return;
      }
    }
    sections.push({ kind, start: r.start, end: r.end });
  });
  if (sections.length) {
    sections[0].start = 0;
    sections[sections.length - 1].end = duration;
  }
  return sections;
}
