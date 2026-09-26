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
}

export function playLength(entry: SetEntry, track: Track | undefined): { seconds: number; estimated: boolean } {
  if (!track) return { seconds: DEFAULT_TRACK_SECONDS, estimated: true };
  const mixIn = track.cues.find((c) => c.id === entry.mixInCueId)?.start;
  const mixOut = track.cues.find((c) => c.id === entry.mixOutCueId)?.start;
  const end = mixOut ?? track.duration;
  if (end === undefined) return { seconds: DEFAULT_TRACK_SECONDS, estimated: true };
  return { seconds: Math.max(0, end - (mixIn ?? 0)), estimated: mixOut === undefined };
}

export function buildTimeline(set: SetPlan, lib: Library): TimelineItem[] {
  const items: TimelineItem[] = [];
  let t = 0;
  let prev: Track | undefined;
  set.entries.forEach((entry, i) => {
    const track = lib.tracks[entry.trackId];
    const { seconds, estimated } = playLength(entry, track);
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
    items.push({ entry, track, startsAt: t, playFor: seconds, estimated, keyRelation: rel, bpmDelta, warnings });
    t += seconds;
    prev = track;
  });
  return items;
}

export function totalSeconds(items: TimelineItem[]): number {
  const last = items[items.length - 1];
  return last ? last.startsAt + last.playFor : 0;
}

/** A human-readable run sheet to print or keep on the phone during the gig. */
export function setPlanMarkdown(set: SetPlan, lib: Library): string {
  const items = buildTimeline(set, lib);
  const out: string[] = [];
  out.push(`# ${set.name}`);
  if (set.venue) out.push(`**Venue:** ${set.venue}`);
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
      out.push(`${n}. **${t ? `${t.artist} – ${t.title}` : 'Missing track'}** @ ${formatTime(it.startsAt, false)}  `);
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
