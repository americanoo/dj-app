/**
 * Smart cue merging.
 *
 * When a track that's already in the library is imported again (from the same
 * program or a different one), its cues are merged rather than replaced:
 *
 * 1. **Offset detection.** Different programs decode some files (MP3s
 *    especially) a few milliseconds apart. Matching cue pairs and beat grids
 *    reveal a constant shift, which is removed before matching and remembered
 *    per program so exports can re-apply it.
 * 2. **Matching.** Cues of the same kind within 50 ms (after alignment) are
 *    treated as the same cue, one-to-one, preferring same pad type and slot.
 * 3. **Combining.** Cues edited in Setcraft always win. Otherwise a re-import
 *    from the program a cue came from updates it; a different program only fills
 *    gaps (missing name, pad, or colour from programs that have colours).
 * 4. **Deletions are never automatic.** An unedited cue that came from this
 *    program but is no longer in the file is kept and flagged as `missing`. It is
 *    removed only if the DJ ticks it in the review. Once kept, it is pinned so it
 *    isn't flagged again. Cues from other programs or made in Setcraft are
 *    never flagged.
 * 5. **Pad conflicts.** When two cues want the same pad, the higher-priority
 *    cue keeps it (edited > already in library > new). The other moves to a free
 *    pad, or becomes a memory cue if all eight are taken. Nothing is dropped.
 */
import {
  MAX_HOT_CUES,
  SLOT_LETTERS,
  trackIdentity,
  type Cue,
  type Library,
  type SourceFormat,
  type Track,
} from './model';
import type { ImportResult } from './formats/types';
import { keepTempoFix } from './tempo';
import { beatLength, formatTime, round } from './time';

export type MergeStrategy = 'smart' | 'keep' | 'replace';

export const MATCH_TOLERANCE = 0.05;
const OFFSET_WINDOW = 0.15;
const OFFSET_CLUSTER = 0.004;
const MIN_OFFSET = 0.002;

/** Programs whose exports contain the full cue list of each track. */
export const SOURCES_WITH_CUES: ReadonlySet<SourceFormat> = new Set(['rekordbox', 'traktor']);
/** Programs whose exports contain real cue colours (Traktor's are fixed by type). */
const SOURCES_WITH_COLORS: ReadonlySet<SourceFormat> = new Set(['rekordbox', 'serato', 'djay', 'manual']);

export type CueChange =
  | { kind: 'added'; cue: Cue }
  | { kind: 'matched'; cue: Cue; fields: ('position' | 'name' | 'color' | 'pad')[] }
  | { kind: 'kept'; cue: Cue }
  | { kind: 'missing'; cue: Cue }
  | { kind: 'removed'; cue: Cue }
  | { kind: 'moved'; cue: Cue; fromSlot: number; toSlot: number }
  | { kind: 'demoted'; cue: Cue; fromSlot: number };

export interface CueMergeResult {
  cues: Cue[];
  changes: CueChange[];
}

export interface OffsetEstimate {
  /** Seconds: incoming position = library position + seconds. */
  seconds: number;
  /** Number of agreeing cue/grid pairs. */
  evidence: number;
}

/** Find a constant timing shift between two versions of the same track. */
export function detectOffset(existing: Track, incoming: Track): OffsetEstimate | undefined {
  const diffs: number[] = [];
  for (const e of existing.cues) {
    for (const i of incoming.cues) {
      if (e.kind !== i.kind) continue;
      const d = i.start - e.start;
      if (Math.abs(d) <= OFFSET_WINDOW) diffs.push(d);
    }
  }
  if (
    existing.gridStart !== undefined &&
    incoming.gridStart !== undefined &&
    existing.bpm &&
    incoming.bpm &&
    Math.abs(existing.bpm - incoming.bpm) < 0.5
  ) {
    const beat = beatLength(existing.bpm);
    let d = incoming.gridStart - existing.gridStart;
    d -= Math.round(d / beat) * beat; // grids may start on different beats
    if (Math.abs(d) <= OFFSET_WINDOW) diffs.push(d);
  }

  let best: { members: number[] } | undefined;
  for (const d of diffs) {
    const members = diffs.filter((x) => Math.abs(x - d) <= OFFSET_CLUSTER);
    if (
      !best ||
      members.length > best.members.length ||
      (members.length === best.members.length && Math.abs(mean(members)) < Math.abs(mean(best.members)))
    ) {
      best = { members };
    }
  }
  if (!best || best.members.length < 2) return undefined;
  const seconds = mean(best.members);
  return { seconds: Math.abs(seconds) < MIN_OFFSET ? 0 : round(seconds, 4), evidence: best.members.length };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function shiftCue(c: Cue, by: number): Cue {
  if (!by) return c;
  return {
    ...c,
    start: round(Math.max(0, c.start + by), 3),
    end: c.end !== undefined ? round(Math.max(0, c.end + by), 3) : undefined,
  };
}

/** One-to-one greedy matching by distance, preferring the same pad type and slot. */
function matchCues(existing: Cue[], incoming: Cue[]): Map<Cue, Cue> {
  const pairs: { e: Cue; i: Cue; cost: number }[] = [];
  for (const e of existing) {
    for (const i of incoming) {
      if (e.kind !== i.kind) continue;
      const ds = Math.abs(e.start - i.start);
      if (ds > MATCH_TOLERANCE) continue;
      if (e.kind === 'loop' && Math.abs((e.end ?? 0) - (i.end ?? 0)) > MATCH_TOLERANCE) continue;
      let cost = ds;
      if ((e.slot === null) !== (i.slot === null)) cost += 0.02;
      else if (e.slot !== i.slot) cost += 0.005;
      pairs.push({ e, i, cost });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const byExisting = new Map<Cue, Cue>();
  const usedIncoming = new Set<Cue>();
  for (const p of pairs) {
    if (byExisting.has(p.e) || usedIncoming.has(p.i)) continue;
    byExisting.set(p.e, p.i);
    usedIncoming.add(p.i);
  }
  return byExisting;
}

function combine(existing: Cue, i: Cue, source: SourceFormat): Cue {
  // Back in the file, so no longer pinned.
  const { pinned: _p, ...e } = existing;
  if (e.edited) return { ...e, name: e.name || i.name };
  if (e.origin === source) {
    // Re-import from the program this cue came from: it's the newer truth.
    return {
      ...e,
      start: i.start,
      end: i.end,
      name: i.name,
      slot: i.slot,
      color: SOURCES_WITH_COLORS.has(source) ? i.color : e.color,
    };
  }
  const existingHasColor = SOURCES_WITH_COLORS.has(e.origin ?? 'manual');
  return {
    ...e,
    name: e.name || i.name,
    slot: e.slot ?? i.slot,
    color: !existingHasColor && SOURCES_WITH_COLORS.has(source) ? i.color : e.color,
  };
}

function changedFields(before: Cue, after: Cue): ('position' | 'name' | 'color' | 'pad')[] {
  const f: ('position' | 'name' | 'color' | 'pad')[] = [];
  if (before.start !== after.start || before.end !== after.end) f.push('position');
  if (before.name !== after.name) f.push('name');
  if (before.color.toLowerCase() !== after.color.toLowerCase()) f.push('color');
  if (before.slot !== after.slot) f.push('pad');
  return f;
}

/** A cue this program should still have, but the file no longer contains. */
function isMissing(e: Cue, source: SourceFormat): boolean {
  return !e.edited && !e.pinned && e.origin === source && SOURCES_WITH_CUES.has(source);
}

/**
 * Merge `incoming` cues (already in the incoming program's timebase) into
 * `existing`. `offset` is the detected shift in seconds (incoming = existing + offset).
 */
export function mergeCues(
  existing: Cue[],
  incoming: Cue[],
  source: SourceFormat,
  offset = 0,
  /** Ids of missing cues the DJ chose to remove. Every other missing cue is kept and pinned. */
  remove: ReadonlySet<string> = new Set(),
): CueMergeResult {
  const aligned = incoming.map((c) => ({ ...shiftCue(c, -offset), origin: c.origin ?? source }));
  const matches = matchCues(existing, aligned);
  const changes: CueChange[] = [];

  // Priority order for pad contests: edited, then other library cues, then new ones.
  const kept: Cue[] = [];
  const before = new Map(existing.map((e) => [e.id, e]));
  for (const e of existing) {
    const i = matches.get(e);
    if (i) {
      const merged = combine(e, i, source);
      changes.push({ kind: 'matched', cue: merged, fields: changedFields(e, merged) });
      kept.push(merged);
    } else if (isMissing(e, source)) {
      if (remove.has(e.id)) {
        changes.push({ kind: 'removed', cue: e });
      } else {
        const pinned = { ...e, pinned: true };
        changes.push({ kind: 'missing', cue: pinned });
        kept.push(pinned);
      }
    } else {
      changes.push({ kind: 'kept', cue: e });
      kept.push(e);
    }
  }
  const matchedIncoming = new Set(matches.values());
  const added = aligned.filter((c) => !matchedIncoming.has(c));
  for (const c of added) changes.push({ kind: 'added', cue: c });

  const ordered = [...kept.filter((c) => c.edited), ...kept.filter((c) => !c.edited), ...added];

  // Pass 1: everyone whose pad is free gets it. Pass 2: the rest move or demote.
  const taken = new Set<number>();
  const losers = new Set<Cue>();
  for (const c of ordered) {
    if (c.slot === null) continue;
    if (taken.has(c.slot)) losers.add(c);
    else taken.add(c.slot);
  }
  const result = ordered.map((c) => {
    if (!losers.has(c)) return c;
    const from = c.slot!;
    // A library cue whose update asked for a taken pad simply stays where it was.
    const previous = before.get(c.id)?.slot;
    if (previous !== undefined && previous !== null && !taken.has(previous)) {
      taken.add(previous);
      return { ...c, slot: previous };
    }
    let free = -1;
    for (let s = 0; s < MAX_HOT_CUES; s++) {
      if (!taken.has(s)) {
        free = s;
        break;
      }
    }
    if (free >= 0) {
      taken.add(free);
      const moved = { ...c, slot: free };
      changes.push({ kind: 'moved', cue: moved, fromSlot: from, toSlot: free });
      return moved;
    }
    const demoted = { ...c, slot: null };
    changes.push({ kind: 'demoted', cue: demoted, fromSlot: from });
    return demoted;
  });

  // Replace stale cue objects in change records with their final versions.
  const finalById = new Map(result.map((c) => [c.id, c]));
  for (const ch of changes) {
    if (ch.kind === 'removed') continue;
    ch.cue = finalById.get(ch.cue.id) ?? ch.cue;
    if (ch.kind === 'matched') ch.fields = changedFields(before.get(ch.cue.id)!, ch.cue);
  }

  return { cues: result.sort((a, b) => a.start - b.start), changes };
}

export interface TrackMergePlan {
  existing: Track;
  incoming: Track;
  source: SourceFormat;
  /** Applied offset in ms (detected now, or learned on an earlier import). */
  offsetMs: number;
  offsetDetected: boolean;
  smart: CueMergeResult;
  /** Anything differs between library and file. */
  changed: boolean;
  /** Something moved, went missing or got demoted: worth a human look. */
  needsReview: boolean;
  /** Offset used for alignment, seconds. */
  offset: number;
}

export function planTrackMerge(existing: Track, incoming: Track, source: SourceFormat): TrackMergePlan {
  const detected = incoming.cues.length ? detectOffset(existing, incoming) : undefined;
  const offset = detected?.seconds ?? (existing.sourceOffsets?.[source] ?? 0) / 1000;
  const smart = mergeCues(existing.cues, incoming.cues, source, offset);
  const count = (k: CueChange['kind']) => smart.changes.filter((c) => c.kind === k).length;
  const matchedChanged = smart.changes.some((c) => c.kind === 'matched' && c.fields.length > 0);
  const repositioned = smart.changes.some(
    (c) => c.kind === 'matched' && (c.fields.includes('position') || c.fields.includes('pad')),
  );
  const offsetMs = Math.round(offset * 1000);
  const offsetIsNew = detected !== undefined && offsetMs !== (existing.sourceOffsets?.[source] ?? 0);
  const needsReview = count('missing') + count('moved') + count('demoted') > 0 || repositioned || offsetIsNew;
  const changed = needsReview || matchedChanged || count('added') > 0 || (incoming.cues.length > 0 && count('kept') > 0);
  return {
    existing,
    incoming,
    source,
    offset,
    offsetMs,
    offsetDetected: detected !== undefined,
    smart,
    changed,
    needsReview,
  };
}

export function describeChange(ch: CueChange): string {
  const label = (c: Cue) =>
    `${c.slot !== null ? SLOT_LETTERS[c.slot] : 'Memory'} ${c.kind === 'loop' ? 'loop ' : ''}${formatTime(c.start, false)}${c.name ? ` "${c.name}"` : ''}`;
  switch (ch.kind) {
    case 'added':
      return `New: ${label(ch.cue)}`;
    case 'matched':
      return `Same cue: ${label(ch.cue)}${ch.fields.length ? ` (updated ${ch.fields.join(', ')})` : ''}`;
    case 'kept':
      return `Kept from library: ${label(ch.cue)}${ch.cue.edited ? ' (edited in Setcraft)' : ''}`;
    case 'missing':
      return `No longer in ${ch.cue.origin}; kept unless you tick it for removal: ${label(ch.cue)}`;
    case 'removed':
      return `Removed (no longer in ${ch.cue.origin}): ${label(ch.cue)}`;
    case 'moved':
      return `Pad ${SLOT_LETTERS[ch.fromSlot]} was taken; moved to pad ${SLOT_LETTERS[ch.toSlot]}: ${label(ch.cue)}`;
    case 'demoted':
      return `Pad ${SLOT_LETTERS[ch.fromSlot]} was taken and all pads are full; kept as memory cue: ${label(ch.cue)}`;
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Smart result with the DJ's removals applied (pads freed by removals are reused). */
export function smartResult(plan: TrackMergePlan, remove: readonly string[] = []): CueMergeResult {
  if (!remove.length) return plan.smart;
  return mergeCues(plan.existing.cues, plan.incoming.cues, plan.source, plan.offset, new Set(remove));
}

/** The merged track for a given strategy. `remove` lists missing cues to delete (smart only). */
export function applyTrackMerge(plan: TrackMergePlan, strategy: MergeStrategy, remove: readonly string[] = []): Track {
  return keepTempoFix(plan.existing, mergeTrack(plan, strategy, remove), plan.incoming.bpm);
}

function mergeTrack(plan: TrackMergePlan, strategy: MergeStrategy, remove: readonly string[]): Track {
  const { existing, incoming, source } = plan;
  // Metadata: newest non-empty wins. Grid and cues are handled per strategy.
  const {
    cues: _c,
    gridStart: _g,
    beatGrid: _b,
    id: _i,
    source: _s,
    sourceIds,
    sourceOffsets: _o,
    ...meta
  } = incoming;
  const base: Track = {
    ...existing,
    ...stripUndefined(meta),
    sourceIds: { ...existing.sourceIds, ...sourceIds },
  };
  const offset = plan.offsetMs / 1000;
  const hasGrid = existing.gridStart !== undefined || !!existing.beatGrid?.length;
  const incomingGrid = {
    gridStart: incoming.gridStart !== undefined ? round(Math.max(0, incoming.gridStart - offset), 3) : undefined,
    beatGrid: incoming.beatGrid?.map((g) => ({ ...g, position: round(Math.max(0, g.position - offset), 3) })),
  };

  switch (strategy) {
    case 'keep':
      return { ...base, ...(hasGrid ? {} : incomingGrid) };
    case 'replace':
      // Take the file as-is, including its timebase: learned offsets no longer apply.
      return {
        ...base,
        cues: incoming.cues.map((c) => ({ ...c, origin: c.origin ?? source })),
        gridStart: incoming.gridStart ?? existing.gridStart,
        beatGrid: incoming.beatGrid ?? (incoming.gridStart !== undefined ? undefined : existing.beatGrid),
        sourceOffsets: undefined,
      };
    case 'smart': {
      const sourceOffsets = { ...existing.sourceOffsets };
      if (plan.offsetMs) sourceOffsets[source] = plan.offsetMs;
      else delete sourceOffsets[source];
      return {
        ...base,
        ...(hasGrid ? {} : incomingGrid),
        cues: smartResult(plan, remove).cues,
        sourceOffsets: Object.keys(sourceOffsets).length ? sourceOffsets : undefined,
      };
    }
  }
}

export interface MergePlan {
  source: SourceFormat;
  /** Incoming tracks that are already in the library. */
  matches: TrackMergePlan[];
  newTracks: Track[];
  /** incoming track id -> library track id */
  idMap: Record<string, string>;
}

export function planMerge(lib: Library, incoming: Pick<ImportResult, 'tracks' | 'format'>): MergePlan {
  const byIdentity = new Map<string, string>();
  for (const t of Object.values(lib.tracks)) byIdentity.set(trackIdentity(t), t.id);
  const matches: TrackMergePlan[] = [];
  const newTracks: Track[] = [];
  const idMap: Record<string, string> = {};
  for (const t of incoming.tracks) {
    const key = trackIdentity(t);
    const existingId = byIdentity.get(key);
    if (existingId && lib.tracks[existingId]) {
      matches.push(planTrackMerge(lib.tracks[existingId], t, incoming.format));
      idMap[t.id] = existingId;
    } else if (existingId) {
      idMap[t.id] = existingId; // duplicate inside the same file
    } else {
      newTracks.push(t);
      byIdentity.set(key, t.id);
      idMap[t.id] = t.id;
    }
  }
  return { source: incoming.format, matches, newTracks, idMap };
}

export interface MergeChoices {
  strategy: MergeStrategy;
  /** Per incoming-track overrides. */
  perTrack?: Record<string, MergeStrategy>;
  /** Per incoming-track ids of missing cues to delete. Nothing is deleted otherwise. */
  remove?: Record<string, string[]>;
}

export function mergeIntoLibrary(
  lib: Library,
  incoming: Pick<ImportResult, 'tracks' | 'playlists' | 'format'>,
  choices: MergeChoices = { strategy: 'smart' },
): { library: Library; idMap: Record<string, string>; added: number; updated: number } {
  const plan = planMerge(lib, incoming);
  const tracks = { ...lib.tracks };
  for (const t of plan.newTracks) tracks[t.id] = t;
  for (const m of plan.matches) {
    const strategy = choices.perTrack?.[m.incoming.id] ?? choices.strategy;
    tracks[m.existing.id] = applyTrackMerge(m, strategy, choices.remove?.[m.incoming.id]);
  }
  const playlists = [
    ...lib.playlists,
    ...incoming.playlists.map((p) => ({ ...p, trackIds: p.trackIds.map((id) => plan.idMap[id] ?? id) })),
  ];
  return { library: { tracks, playlists }, idMap: plan.idMap, added: plan.newTracks.length, updated: plan.matches.length };
}
