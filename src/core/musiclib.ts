/**
 * The library built from music folders (the desktop app scans them), and
 * keeping every track linked to its file: a scan adds and updates tracks, and
 * files that went missing are found again by fingerprint, by name, or by
 * pointing at one of them, which fixes the rest of its folder.
 */
import { normaliseKey } from './keys';
import { normalisePath, trackIdentity, uid, type Library, type Track } from './model';
import { buildIndex, findTrackFile } from './pathmatch';
import { guessFromFileName } from './xml';

/** One audio file found in a music folder, with what its tags say. */
export interface ScanEntry {
  path: string;
  size: number;
  mtimeMs: number;
  /** Fingerprint: size and a hash of the file's start and end. */
  fileId: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  bpm?: number;
  key?: string;
  /** Seconds. */
  duration?: number;
}

const clean = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);

/**
 * A scan merged into the library. A file already in it (same path, or same
 * fingerprint when it moved) keeps everything you or your DJ software set, and
 * only gains what it was missing (duration, tags); a moved one takes its new
 * place. A new file becomes a new track, named from its tags or its file name.
 */
export function mergeScan(lib: Library, entries: ScanEntry[]): { library: Library; added: number; updated: number; moved: number } {
  const tracks = { ...lib.tracks };
  const byPath = new Map<string, string>();
  const byFile = new Map<string, string>();
  for (const t of Object.values(tracks)) {
    if (t.path) byPath.set(trackIdentity(t), t.id);
    if (t.fileId) byFile.set(t.fileId, t.id);
  }
  let added = 0;
  let updated = 0;
  let moved = 0;
  for (const e of entries) {
    const tagKey = normaliseKey(clean(e.key));
    const hereId = byPath.get(trackIdentity({ path: e.path, artist: '', title: '' }));
    const movedId = hereId ? undefined : byFile.get(e.fileId);
    const id = hereId ?? movedId;
    if (id) {
      const t = tracks[id];
      const patch: Partial<Track> = {};
      if (t.fileId !== e.fileId) patch.fileId = e.fileId;
      if (movedId) patch.path = e.path;
      if (!t.duration && e.duration) patch.duration = e.duration;
      if (!t.bpm && e.bpm) patch.bpm = e.bpm;
      if (!t.key && tagKey) patch.key = tagKey;
      if (!t.album && clean(e.album)) patch.album = clean(e.album);
      if (!t.genre && clean(e.genre)) patch.genre = clean(e.genre);
      if (Object.keys(patch).length) {
        tracks[id] = { ...t, ...patch };
        if (movedId) moved++;
        else updated++;
      }
      continue;
    }
    const guess = guessFromFileName(e.path);
    const t: Track = {
      id: uid('trk'),
      title: clean(e.title) ?? guess.title,
      artist: clean(e.artist) ?? guess.artist,
      album: clean(e.album),
      genre: clean(e.genre),
      bpm: e.bpm || undefined,
      key: tagKey,
      duration: e.duration,
      path: e.path,
      fileId: e.fileId,
      cues: [],
      source: 'folder',
    };
    tracks[t.id] = t;
    byPath.set(trackIdentity(t), t.id);
    byFile.set(e.fileId, t.id);
    added++;
  }
  return { library: { ...lib, tracks }, added, updated, moved };
}

/**
 * Missing tracks found again in the scanned folders: by fingerprint (certain),
 * or by name, loosely (see pathmatch), when no other missing track claims the
 * same file. Returns the new path for each one found, and those still missing.
 */
export function relinkMissing(missing: Track[], entries: ScanEntry[]): { found: Record<string, string>; unresolved: Track[] } {
  const byFile = new Map(entries.map((e) => [e.fileId, e.path]));
  const index = buildIndex(entries.map((e) => e.path));
  const found: Record<string, string> = {};
  const claims = new Map<string, string[]>();
  for (const t of missing) {
    const sure = t.fileId ? byFile.get(t.fileId) : undefined;
    if (sure) {
      found[t.id] = sure;
      continue;
    }
    const byName = findTrackFile(t, index);
    if (byName) claims.set(byName, [...(claims.get(byName) ?? []), t.id]);
  }
  for (const [path, ids] of claims) if (ids.length === 1) found[ids[0]] = path;
  return { found, unresolved: missing.filter((t) => !found[t.id]) };
}

const segs = (p: string) => normalisePath(p).split('/');

/**
 * Pointing at one missing file's new place gives the move for its folder: the
 * part of the old path that changed and what it became ("/Volumes/DJ DRIVE" to
 * "/Volumes/DJ DRIVE 2"), from the end of the paths that stayed the same.
 */
export function folderMove(oldPath: string, newPath: string): { from: string; to: string } | undefined {
  const a = segs(oldPath);
  const b = segs(newPath);
  let same = 0;
  while (same < a.length && same < b.length && a[a.length - 1 - same].normalize('NFC').toLowerCase() === b[b.length - 1 - same].normalize('NFC').toLowerCase()) same++;
  if (same === 0) return undefined; // not even the file name matches: no folder rule
  return { from: a.slice(0, a.length - same).join('/'), to: b.slice(0, b.length - same).join('/') };
}

/** A path with a folder move applied, or undefined when it isn't under the moved folder. */
export function applyMove(path: string, move: { from: string; to: string }): string | undefined {
  const p = normalisePath(path);
  const from = move.from.normalize('NFC').toLowerCase();
  if (!p.normalize('NFC').toLowerCase().startsWith(from + '/')) return undefined;
  return move.to + p.slice(move.from.length);
}
