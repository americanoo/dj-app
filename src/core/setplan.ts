/** Narrative analysis of a set: timeline, transition checks and a printable plan. */
import type { Library, SetEntry, SetPlan, Track } from './model';
import { keyRelation, toCamelot, type KeyRelation } from './keys';
import { effectiveBpmDelta } from './tempo';
import { formatTime } from './time';
import {
  incomingCurves,
  incomingPhase,
  integrate,
  emptyCurves,
  mergeCurves,
  outgoingCurves,
  withKeyframes,
  planTransition,
  rideOffset,
  valueAt,
  type BlendStyle,
  type Curves,
  type TransitionAutomation,
  type TransitionPlan,
} from './mixplan';

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
    // Half/double-time counts as the same groove, so 96 -> 192 isn't a "jump".
    const groove = i > 0 && prev?.bpm && track?.bpm ? effectiveBpmDelta(prev.bpm, track.bpm) : undefined;
    if (groove !== undefined && Math.abs(groove) > 6) {
      warnings.push(`BPM jump ${groove > 0 ? '+' : ''}${groove.toFixed(1)}% — plan a cut, echo-out or breakdown`);
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

/**
 * The track after `trackId` in the night, and where to start it: its mix-in
 * cue when the set has one, otherwise its first downbeat.
 */
export function nextInNight(set: SetPlan, lib: Library, trackId: string): { trackId: string; at: number } | undefined {
  const entries = withTimes(set, lib).entries.filter((e) => lib.tracks[e.trackId]);
  const i = entries.findIndex((e) => e.trackId === trackId);
  const next = i >= 0 ? entries.slice(i + 1).find((e) => e.trackId !== trackId) : undefined;
  if (!next) return undefined;
  const t = lib.tracks[next.trackId];
  const mixIn = t.cues.find((c) => c.id === next.mixInCueId)?.start;
  return { trackId: next.trackId, at: Math.max(0, mixIn ?? t.gridStart ?? 0) };
}

/** Where a timeline item's track starts playing (its mix-in cue, else the top of the file). */
export function itemMixIn(it: TimelineItem): number {
  return it.track?.cues.find((c) => c.id === it.entry.mixInCueId)?.start ?? 0;
}

/**
 * The track playing `t` seconds into the night, and the spot in it. During a
 * blend the incoming (later) track wins; in a gap, the next track's start.
 */
export function trackAtNight(items: TimelineItem[], t: number): { trackId: string; pos: number } | undefined {
  const withTrack = items.filter((it) => it.track);
  const playing = withTrack.filter((it) => t >= it.startsAt && t < it.startsAt + it.playFor);
  const it = playing.length
    ? playing.reduce((a, b) => (b.startsAt >= a.startsAt ? b : a))
    : (withTrack.find((x) => x.startsAt > t) ?? withTrack[withTrack.length - 1]);
  if (!it) return undefined;
  const into = Math.max(0, Math.min(it.playFor, t - it.startsAt));
  return { trackId: it.entry.trackId, pos: itemMixIn(it) + into };
}

/** How far into the night a spot in a track is (its first appearance in the set). */
export function nightAtTrack(items: TimelineItem[], trackId: string, pos: number): number | undefined {
  const it = items.find((x) => x.entry.trackId === trackId);
  return it ? it.startsAt + (pos - itemMixIn(it)) : undefined;
}

/** One track's stretch of the night, ready to play: from `mixIn` in the file, at `startsAt`, for `playFor` seconds. */
export interface NightSlot {
  /** The set entry. */
  id: string;
  trackId: string;
  startsAt: number;
  playFor: number;
  mixIn: number;
  bpm?: number;
  gridStart?: number;
  /** How it's mixed in from the previous track (as chosen on its entry). */
  blend?: BlendStyle;
  sync?: boolean;
  /** Keyframes of the transition into this track. */
  automation?: TransitionAutomation;
  /** Tempo, fader, EQ, filter and FX-send automation across both of its transitions. */
  curves: Curves;
  /** Echo out: when the track cuts, leaving its echoes. */
  echoAt?: number;
}

/** What plays when: every track of the night, overlapping ones together, with its mix automation. */
export function nightSlots(items: TimelineItem[]): NightSlot[] {
  const slots: NightSlot[] = items
    .filter((it) => it.track && it.playFor > 0)
    .map((it) => ({
      id: it.entry.id,
      trackId: it.entry.trackId,
      startsAt: it.startsAt,
      playFor: it.playFor,
      mixIn: itemMixIn(it),
      bpm: it.track!.bpm,
      gridStart: it.track!.gridStart,
      blend: it.entry.blend,
      sync: it.entry.sync,
      automation: it.entry.automation,
      curves: emptyCurves(),
    }));
  const parts = new Map<string, Curves[]>();
  const add = (id: string, c: Curves) => parts.set(id, [...(parts.get(id) ?? []), c]);
  for (const { a, b, plan } of transitionsOf(slots)) {
    add(a.id, withKeyframes(outgoingCurves(plan, a), b.automation?.a, plan.inAt));
    add(b.id, withKeyframes(incomingCurves(plan, b), b.automation?.b, plan.inAt));
    if (plan.echoAt !== undefined) a.echoAt = plan.echoAt;
  }
  for (const s of slots) s.curves = mergeCurves(...(parts.get(s.id) ?? []));
  return slots;
}

/** Where a slot's track is in its file at night time `t`, following its tempo automation. */
export function slotPos(s: NightSlot, t: number): number {
  return s.mixIn + integrate(s.curves.rate, s.startsAt, t, 1);
}

/** A slot's playback rate at night time `t` (1 = as recorded). */
export function slotRate(s: NightSlot, t: number): number {
  return valueAt(s.curves.rate, t, 1);
}

/** The slots sounding at `t` (more than one during a blend). */
export function slotsAt(slots: NightSlot[], t: number): NightSlot[] {
  return slots.filter((s) => t >= s.startsAt && t < s.startsAt + s.playFor);
}

/** Consecutive tracks of the night, as outgoing (a) → incoming (b) pairs, with how each transition plays. */
export function transitionsOf<S extends Omit<NightSlot, 'curves'>>(slots: S[]): { a: S; b: S; plan: TransitionPlan }[] {
  const sorted = [...slots].sort((x, y) => x.startsAt - y.startsAt);
  const out: { a: S; b: S; plan: TransitionPlan }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (b.trackId !== a.trackId) out.push({ a, b, plan: planTransition(a, b, { blend: b.blend, sync: b.sync }) });
  }
  return out;
}
export interface TransitionInfo {
  /** Night time the incoming track comes in, and the outgoing one ends. */
  inAt: number;
  outAt: number;
  /** Seconds both play together (0 or less: a cut, or a gap of that length). */
  overlap: number;
  /** The overlap in the outgoing track's bars. */
  overlapBars?: number;
  /** Percent tempo change from the outgoing track to the incoming one. */
  bpmChange?: number;
  /** Where the incoming track lands in the outgoing one's grid: bar and beat (1-based). */
  landsOn?: { bar: number; beat: number; offBeats: number; phrase: boolean };
}

/** How a transition lines up: overlap, tempo change, and whether it comes in on the beat (after the tempo ride). */
export function describeTransition(a: Omit<NightSlot, 'curves'>, b: Omit<NightSlot, 'curves'>): TransitionInfo {
  const inAt = b.startsAt;
  const outAt = a.startsAt + a.playFor;
  const overlap = outAt - inAt;
  const info: TransitionInfo = { inAt, outAt, overlap };
  if (a.bpm && a.bpm > 0) {
    const beat = 60 / a.bpm;
    if (overlap > 0) info.overlapBars = Math.round((overlap / beat / 4) * 10) / 10;
    // B's start, as a spot in A's file (after A's tempo ride), counted in A's beats from its
    // grid; with the tempos synced, relative to where B's mix-in sits on its own beat.
    const plan = planTransition(a, b, { blend: b.blend, sync: b.sync });
    const posInA = a.mixIn + (inAt - a.startsAt) + rideOffset(plan, inAt);
    const phase = plan.sync ? incomingPhase(a, b, plan.sync.rate) : 0;
    const beats = (posInA - (a.gridStart ?? 0)) / beat - phase;
    const whole = Math.round(beats);
    info.landsOn = {
      bar: Math.floor(whole / 4) + 1,
      beat: (((whole % 4) + 4) % 4) + 1,
      offBeats: Math.round((beats - whole) * 100) / 100,
      phrase: Math.abs(beats - whole) < 0.1 && ((whole % 32) + 32) % 32 === 0,
    };
  }
  if (a.bpm && b.bpm) info.bpmChange = Math.round(((b.bpm - a.bpm) / a.bpm) * 1000) / 10;
  return info;
}
