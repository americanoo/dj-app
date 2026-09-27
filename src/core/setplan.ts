/** Narrative analysis of a set: timeline, transition checks and a printable plan. */
import type { Library, SetEntry, SetPlan, Track } from './model';
import { keyRelation, toCamelot, type KeyRelation } from './keys';
import { formatTime } from './time';

export const DEFAULT_TRACK_SECONDS = 5 * 60;

export interface TimelineItem {
  entry: SetEntry;
  track: Track | undefined;
  /** Seconds from the start of the set. */
  startsAt: number;
  /** How long this track is planned to play before the next one takes over. */
  playFor: number;
  estimated: boolean;
  keyRelation: KeyRelation;
  /** Percent change from the previous track's BPM. */
  bpmDelta: number | undefined;
  warnings: string[];
  /** Seconds between the previous track's end and this start: negative = the two overlap (a blend). */
  gap: number;
}

export function playLength(entry: SetEntry, track: Track | undefined): { seconds: number; estimated: boolean } {
  if (!track) return { seconds: DEFAULT_TRACK_SECONDS, estimated: true };
  const mixIn = track.cues.find((c) => c.id === entry.mixInCueId)?.start;
  const mixOut = track.cues.find((c) => c.id === entry.mixOutCueId)?.start;
  const end = mixOut ?? track.duration;
  if (end === undefined) return { seconds: DEFAULT_TRACK_SECONDS, estimated: true };
  return { seconds: Math.max(0, end - (mixIn ?? 0)), estimated: mixOut === undefined };
}

/**
 * The set with a start time on every entry, sorted by time. Entries without
 * one (from older versions) are placed straight after the entry before them.
 */
export function withTimes(set: SetPlan, lib: Library): SetPlan {
  if (set.entries.every((e) => e.at !== undefined)) {
    const sorted = sortByTime(set.entries);
    return sorted === set.entries ? set : { ...set, entries: sorted };
  }
  let cursor = 0;
  const entries = set.entries.map((e) => {
    const at = e.at ?? cursor;
    cursor = at + playLength(e, lib.tracks[e.trackId]).seconds;
    return e.at === undefined ? { ...e, at } : e;
  });
  return { ...set, entries: sortByTime(entries) };
}

function sortByTime(entries: SetEntry[]): SetEntry[] {
  const sorted = [...entries].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return sorted.every((e, i) => e === entries[i]) ? entries : sorted;
}

/** End of the last track, seconds. */
export function setEnd(set: SetPlan, lib: Library): number {
  return withTimes(set, lib).entries.reduce(
    (end, e) => Math.max(end, (e.at ?? 0) + playLength(e, lib.tracks[e.trackId]).seconds),
    0,
  );
}

export function buildTimeline(set: SetPlan, lib: Library): TimelineItem[] {
  const items: TimelineItem[] = [];
  let prev: Track | undefined;
  let prevEnd: number | undefined;
  withTimes(set, lib).entries.forEach((entry, i) => {
    const track = lib.tracks[entry.trackId];
    const { seconds, estimated } = playLength(entry, track);
    const startsAt = entry.at ?? 0;
    const rel = i === 0 ? 'unknown' : keyRelation(prev?.key, track?.key);
    const bpmDelta =
      i > 0 && prev?.bpm && track?.bpm ? ((track.bpm - prev.bpm) / prev.bpm) * 100 : undefined;
    const warnings: string[] = [];
    if (rel === 'clash') warnings.push(`Key clash: ${toCamelot(prev?.key)} → ${toCamelot(track?.key)}`);
    if (bpmDelta !== undefined && Math.abs(bpmDelta) > 6) {
      warnings.push(`BPM jump ${bpmDelta > 0 ? '+' : ''}${bpmDelta.toFixed(1)}% — plan a cut, echo-out or breakdown`);
    }
    if (track && entry.mixInCueId && !track.cues.some((c) => c.id === entry.mixInCueId)) {
      warnings.push('Mix-in cue was deleted');
    }
    const gap = prevEnd === undefined ? 0 : startsAt - prevEnd;
    if (gap > 1) warnings.push(`${formatTime(gap, false)} of silence before this track`);
    items.push({ entry, track, startsAt, playFor: seconds, estimated, keyRelation: rel, bpmDelta, warnings, gap });
    prev = track;
    prevEnd = startsAt + seconds;
  });
  return items;
}

export function totalSeconds(items: TimelineItem[]): number {
  return items.reduce((end, it) => Math.max(end, it.startsAt + it.playFor), 0);
}

/** "22:30" -> seconds after midnight. */
export function parseClock(clock: string | undefined): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock?.trim() ?? '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

/**
 * A moment of the set as a label: wall-clock time when the set has a start
 * time ("23:15" / "23:15:30"), otherwise elapsed time ("1:15:00").
 */
export function formatSetTime(t: number, startClock?: string, withSeconds = false): string {
  const base = parseClock(startClock);
  const pad = (n: number) => String(n).padStart(2, '0');
  const s = Math.max(0, Math.round(t));
  if (base === undefined) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  const clock = (base + s) % 86400;
  const h = Math.floor(clock / 3600);
  const m = Math.floor((clock % 3600) / 60);
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(clock % 60)}` : `${pad(h)}:${pad(m)}`;
}

/** A human-readable run sheet to print or keep on the phone during the gig. */
export function setPlanMarkdown(set: SetPlan, lib: Library): string {
  const items = buildTimeline(set, lib);
  const out: string[] = [];
  out.push(`# ${set.name}`);
  if (set.venue) out.push(`**Venue:** ${set.venue}`);
  if (parseClock(set.startClock) !== undefined) out.push(`**Starts:** ${set.startClock}`);
  out.push(`**Planned length:** ${formatTime(totalSeconds(items), false)} of ${set.targetMinutes} min target`);
  out.push('');
  if (set.story.trim()) {
    out.push('## The story');
    out.push(set.story.trim());
    out.push('');
  }
  for (const ch of set.chapters) {
    const chItems = items.filter((it) => it.entry.chapterId === ch.id);
    if (!chItems.length) continue;
    out.push(`## ${ch.name}`);
    if (ch.intent) out.push(`_${ch.intent}_`);
    out.push('');
    for (const it of chItems) {
      const n = items.indexOf(it) + 1;
      const t = it.track;
      const meta = [t?.bpm ? `${t.bpm.toFixed(1)} BPM` : '', t?.key ? `${t.key} / ${toCamelot(t.key)}` : '', `energy ${it.entry.energy}/10`]
        .filter(Boolean)
        .join(' · ');
      out.push(`${n}. **${t ? `${t.artist} – ${t.title}` : 'Missing track'}** @ ${formatSetTime(it.startsAt, set.startClock)}  `);
      out.push(`   ${meta}`);
      if (it.entry.transition) out.push(`   ↪ Transition: ${it.entry.transition}`);
      if (it.entry.notes) out.push(`   ✎ ${it.entry.notes}`);
      const cues = t?.cues.filter((c) => c.slot !== null) ?? [];
      if (cues.length) {
        out.push(
          '   Cues: ' +
            cues
              .sort((a, b) => a.slot! - b.slot!)
              .map((c) => `${'ABCDEFGH'[c.slot!]} ${formatTime(c.start, false)}${c.name ? ` "${c.name}"` : ''}${c.kind === 'loop' ? ' (loop)' : ''}`)
              .join(', '),
        );
      }
      for (const w of it.warnings) out.push(`   ⚠ ${w}`);
    }
    out.push('');
  }
  return out.join('\n');
}
