/**
 * Copies and saved versions.
 *
 * A version is a full snapshot of the project (library, cues and sets). From a
 * version the DJ can restore everything, copy out a single set as a new set, or
 * bring back one track's cues.
 */
import { SLOT_LETTERS, uid, type Cue, type Project, type SetPlan, type Track } from './model';
import { formatTime } from './time';

export interface ProjectSummary {
  tracks: number;
  cues: number;
  sets: { id: string; name: string; entries: number }[];
}

export interface VersionMeta {
  id: string;
  name: string;
  createdAt: number;
  /** Saved automatically (before an import or a restore) rather than by the DJ. */
  auto: boolean;
  summary: ProjectSummary;
}

export const MAX_AUTO_VERSIONS = 20;

export function summarize(p: Project): ProjectSummary {
  const tracks = Object.values(p.library.tracks);
  return {
    tracks: tracks.length,
    cues: tracks.reduce((n, t) => n + t.cues.length, 0),
    sets: p.sets.map((s) => ({ id: s.id, name: s.name, entries: s.entries.length })),
  };
}

/** A copy of a set with fresh ids for the set, its chapters and its entries. */
export function copySet(set: SetPlan, name = `${set.name} (copy)`): SetPlan {
  const chapterIds = new Map(set.chapters.map((c) => [c.id, uid('ch')]));
  return {
    ...structuredClone(set),
    id: uid('set'),
    name,
    chapters: set.chapters.map((c) => ({ ...c, id: chapterIds.get(c.id)! })),
    entries: set.entries.map((e) => ({ ...e, id: uid('ent'), chapterId: chapterIds.get(e.chapterId) ?? e.chapterId })),
  };
}

/** Newest first. Keeps every manual version and the newest `maxAuto` automatic ones. */
export function pruneVersions(list: VersionMeta[], maxAuto = MAX_AUTO_VERSIONS): { keep: VersionMeta[]; drop: VersionMeta[] } {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const keep: VersionMeta[] = [];
  const drop: VersionMeta[] = [];
  let autos = 0;
  for (const v of sorted) {
    if (v.auto && ++autos > maxAuto) drop.push(v);
    else keep.push(v);
  }
  return { keep, drop };
}

function cueKey(c: Cue): string {
  return [c.kind, c.slot ?? '-', c.start.toFixed(3), c.end?.toFixed(3) ?? '', c.name, c.color.toLowerCase()].join('|');
}

/** Same cues, ignoring ids, order and provenance flags. */
export function sameCues(a: Cue[], b: Cue[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map(cueKey).sort();
  const kb = b.map(cueKey).sort();
  return ka.every((k, i) => k === kb[i]);
}

export interface CueHistoryEntry {
  version: VersionMeta;
  cues: Cue[];
}

/**
 * Earlier states of one track's cues, newest first. Only versions whose cues
 * differ from the current ones and from the next newer entry are listed.
 */
export function cueHistory(
  trackId: string,
  current: Cue[],
  versions: { meta: VersionMeta; project: Project }[],
): CueHistoryEntry[] {
  const out: CueHistoryEntry[] = [];
  let last = current;
  for (const { meta, project } of [...versions].sort((a, b) => b.meta.createdAt - a.meta.createdAt)) {
    const t = project.library.tracks[trackId];
    if (!t || sameCues(t.cues, last)) continue;
    if (out.some((e) => sameCues(e.cues, t.cues)) || sameCues(t.cues, current)) continue;
    out.push({ version: meta, cues: t.cues });
    last = t.cues;
  }
  return out;
}

/** Tracks a copied-out set needs that the current library no longer has. */
export function missingTracksFor(set: SetPlan, from: Project, into: Project): Track[] {
  const ids = new Set(set.entries.map((e) => e.trackId));
  return [...ids].filter((id) => !into.library.tracks[id] && from.library.tracks[id]).map((id) => from.library.tracks[id]);
}

/** Short, pad-by-pad description of how an earlier set of cues differs from the current one. */
export function cueDiffSummary(then: Cue[], now: Cue[]): string[] {
  const label = (c: Cue | undefined) =>
    c ? `${formatTime(c.start, false)}${c.name ? ` "${c.name}"` : ''}${c.kind === 'loop' ? ' loop' : ''}` : 'empty';
  const out: string[] = [];
  SLOT_LETTERS.forEach((letter, slot) => {
    const a = then.find((c) => c.slot === slot);
    const b = now.find((c) => c.slot === slot);
    if ((!a && !b) || (a && b && cueKey(a) === cueKey(b))) return;
    out.push(`${letter}: ${label(a)} (now ${label(b)})`);
  });
  const memThen = then.filter((c) => c.slot === null);
  const memNow = now.filter((c) => c.slot === null);
  if (!sameCues(memThen, memNow)) {
    out.push(
      memThen.length === memNow.length
        ? 'Memory cues differ'
        : `${memThen.length} memory cue${memThen.length === 1 ? '' : 's'} (now ${memNow.length})`,
    );
  }
  return out;
}
