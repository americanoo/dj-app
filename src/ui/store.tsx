import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { get, set as idbSet } from 'idb-keyval';
import {
  emptyProject,
  newSet,
  uid,
  type Chapter,
  type Cue,
  type Project,
  type SetEntry,
  type SetPlan,
  type Track,
  EDITABLE_TRACK_FIELDS,
} from '../core/model';
import type { ImportResult } from '../core/formats';
import { mergeIntoLibrary, type MergeChoices } from '../core/merge';
import { mergeScan, type ScanEntry } from '../core/musiclib';
import { trackMixCue } from '../core/trackfx';
import { setMixPoint } from '../core/sheet';
import { copySet } from '../core/versions';
import { initHistory, record, redo, undo, type History } from '../core/history';
import { blendLength, blendNight, keepTransitions, setEntrance, startAtZero, tempoFactor, playLength, reorderEntries, setEnd, withTimes } from '../core/setplan';

const STORAGE_KEY = 'setcraft-project-v1';
/**
 * Changes not yet saved when the page was left. IndexedDB writes started while a
 * page unloads can be dropped, so they're also written here, synchronously, and
 * picked up on the next start. Cleared once a normal save has landed.
 */
const PENDING_KEY = 'setcraft-project-pending';

function readPending(): Project | undefined {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const p = raw ? (JSON.parse(raw) as Project) : undefined;
    return p?.version === 1 ? p : undefined;
  } catch {
    return undefined;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // storage unavailable
  }
}

export type Action =
  /** `fresh`: the saved project opened at start-up, which starts a new undo history. */
  | { type: 'load'; project: Project; fresh?: boolean }
  | { type: 'import'; result: ImportResult; choices?: MergeChoices }
  | { type: 'updateTrack'; id: string; patch: Partial<Track> }
  | { type: 'updateTracks'; patches: Record<string, Partial<Track>> }
  | { type: 'setCues'; trackId: string; cues: Cue[] }
  | { type: 'addTrack'; track: Track }
  | { type: 'addSet' }
  | { type: 'selectSet'; id: string }
  | { type: 'updateSet'; patch: Partial<SetPlan> }
  | { type: 'deleteSet'; id: string }
  | { type: 'duplicateSet'; id: string }
  | { type: 'addSetCopy'; set: SetPlan; name: string; tracks: Track[] }
  | { type: 'addEntries'; trackIds: string[]; chapterId?: string; blend?: boolean }
  | { type: 'placeTrack'; trackId: string; at: number; chapterId?: string }
  | { type: 'setEntryTime'; id: string; at: number }
  | { type: 'updateEntry'; id: string; patch: Partial<SetEntry> }
  | { type: 'removeEntry'; id: string }
  | { type: 'reorderEntries'; ids: string[] }
  | { type: 'blendNight'; bars: number }
  /** `keepNext`: the end moves but the next track doesn't (a longer or shorter blend). */
  | { type: 'trimEntry'; id: string; edge: 'start' | 'end'; to: number; keepNext?: boolean }
  | { type: 'setEntrance'; id: string; at: number }
  /** Tracks' real lengths, measured from their audio (not an edit: it isn't undone). */
  | { type: 'measured'; durations: Record<string, number> }
  | { type: 'addChapter' }
  | { type: 'updateChapter'; id: string; patch: Partial<Chapter> }
  | { type: 'removeChapter'; id: string }
  | { type: 'moveChapter'; id: string; delta: number }
  | { type: 'clearLibrary' }
  /** Music folders scanned (desktop app): new files become tracks, known ones fill gaps. */
  | { type: 'scanMerge'; entries: ScanEntry[] }
  /** Missing files found again: each track's new location. */
  | { type: 'relink'; paths: Record<string, string> };

export function activeSet(p: Project): SetPlan {
  return p.sets.find((s) => s.id === p.activeSetId) ?? p.sets[0];
}

function mapActive(p: Project, fn: (s: SetPlan) => SetPlan): Project {
  const a = activeSet(p);
  return { ...p, sets: p.sets.map((s) => (s.id === a.id ? fn(s) : s)) };
}

/** Apply a patch, marking the track changed in Setcraft when the DJ edited something that gets exported. */
function withEdit(t: Track, patch: Partial<Track>): Track {
  const edited = EDITABLE_TRACK_FIELDS.some((k) => k in patch);
  return { ...t, ...patch, ...(edited ? { modified: true } : {}) };
}

export function reducer(p: Project, a: Action): Project {
  const applied = apply(p, a);
  const next = followsLengths(a) ? rippleSets(p, applied) : applied;
  return keepsStart(a) ? fromZero(next) : next;
}

/** Edits after which the night starts at 00:00 again (dragging a track in time on the desktop timeline leaves it where it's put). */
function keepsStart(a: Action): boolean {
  return a.type !== 'setEntryTime' && a.type !== 'placeTrack' && a.type !== 'selectSet';
}

function fromZero(p: Project): Project {
  let changed = false;
  const sets = p.sets.map((s) => {
    const z = startAtZero(s, p.library);
    if (z !== s && z.entries.some((e, i) => e.at !== s.entries[i]?.at || e.id !== s.entries[i]?.id)) {
      changed = true;
      return z;
    }
    return s;
  });
  return changed ? { ...p, sets } : p;
}

/** Edits that can change how long tracks play, after which the rest of the night follows (see keepTransitions). */
function followsLengths(a: Action): boolean {
  switch (a.type) {
    case 'setCues':
    case 'updateTrack':
    case 'updateTracks':
    case 'removeEntry':
    case 'import':
    case 'scanMerge':
      return true;
    case 'updateEntry':
      return !('at' in a.patch);
    case 'trimEntry':
      // Trimming the end moves what follows (unless only the blend changes); trimming the start keeps the end where it is.
      return a.edge === 'end' && !a.keepNext;
    case 'measured':
      return true;
    default:
      return false;
  }
}

function rippleSets(prev: Project, next: Project): Project {
  if (next === prev) return next;
  let changed = false;
  const sets = next.sets.map((s) => {
    const old = prev.sets.find((x) => x.id === s.id);
    if (!old) return s;
    const kept = keepTransitions(old, prev.library, s, next.library);
    if (kept !== s) changed = true;
    return kept;
  });
  return changed ? { ...next, sets } : next;
}

function apply(p: Project, a: Action): Project {
  switch (a.type) {
    case 'load':
      return a.project;
    case 'import': {
      const { library } = mergeIntoLibrary(p.library, a.result, a.choices);
      return { ...p, library };
    }
    case 'updateTrack': {
      const t = p.library.tracks[a.id];
      if (!t) return p;
      return { ...p, library: { ...p.library, tracks: { ...p.library.tracks, [a.id]: withEdit(t, a.patch) } } };
    }
    case 'scanMerge':
      return { ...p, library: mergeScan(p.library, a.entries).library };
    case 'relink': {
      const tracks = { ...p.library.tracks };
      for (const [id, path] of Object.entries(a.paths)) if (tracks[id]) tracks[id] = { ...tracks[id], path };
      return { ...p, library: { ...p.library, tracks } };
    }
    case 'updateTracks': {
      const tracks = { ...p.library.tracks };
      for (const [id, patch] of Object.entries(a.patches)) if (tracks[id]) tracks[id] = withEdit(tracks[id], patch);
      return { ...p, library: { ...p.library, tracks } };
    }
    case 'setCues': {
      const prev = p.library.tracks[a.trackId]?.cues ?? [];
      return reducer(p, { type: 'updateTrack', id: a.trackId, patch: { cues: markEdits(prev, a.cues) } });
    }
    case 'addTrack':
      return { ...p, library: { ...p.library, tracks: { ...p.library.tracks, [a.track.id]: a.track } } };
    case 'addSet': {
      const s = newSet(`Set ${p.sets.length + 1}`);
      return { ...p, sets: [...p.sets, s], activeSetId: s.id };
    }
    case 'selectSet':
      return { ...p, activeSetId: a.id };
    case 'updateSet':
      return mapActive(p, (s) => ({ ...s, ...a.patch }));
    case 'deleteSet': {
      const sets = p.sets.filter((s) => s.id !== a.id);
      if (!sets.length) sets.push(newSet());
      return { ...p, sets, activeSetId: sets[0].id };
    }
    case 'duplicateSet': {
      const idx = p.sets.findIndex((s) => s.id === a.id);
      if (idx < 0) return p;
      const copy = copySet(p.sets[idx]);
      const sets = [...p.sets];
      sets.splice(idx + 1, 0, copy);
      return { ...p, sets, activeSetId: copy.id };
    }
    case 'addSetCopy': {
      // A set copied out of a saved version, plus any tracks it needs that were since removed.
      const copy = copySet(a.set, a.name);
      const tracks = { ...p.library.tracks };
      for (const t of a.tracks) if (!tracks[t.id]) tracks[t.id] = t;
      return { ...p, library: { ...p.library, tracks }, sets: [...p.sets, copy], activeSetId: copy.id };
    }
    case 'addEntries':
      // Appended after the last track in the night.
      return mapActive(p, (s0) => {
        const s = withTimes(s0, p.library);
        const last = s.entries[s.entries.length - 1];
        const chapterId = a.chapterId ?? last?.chapterId ?? s.chapters[0]?.id ?? '';
        let cursor = setEnd(s, p.library);
        // With `blend`, each one comes in over the end of the one before (see blendLength).
        let prev = a.blend
          ? s.entries.reduce<{ seconds: number; bpm?: number } | undefined>((best, e) => {
              const end = (e.at ?? 0) + playLength(e, p.library.tracks[e.trackId]).seconds;
              return end >= cursor - 1e-6 ? { seconds: playLength(e, p.library.tracks[e.trackId]).seconds, bpm: p.library.tracks[e.trackId]?.bpm } : best;
            }, undefined)
          : undefined;
        const added = a.trackIds.map((trackId) => {
          const track = p.library.tracks[trackId];
          const e = newEntry(s, trackId, chapterId, cursor, track);
          const seconds = playLength(e, track).seconds;
          if (prev) e.at = Math.max(0, cursor - blendLength(prev.seconds, prev.bpm, seconds));
          cursor = (e.at ?? 0) + seconds;
          if (a.blend) prev = { seconds, bpm: track?.bpm };
          return e;
        });
        return { ...s, entries: [...s.entries, ...added] };
      });
    case 'placeTrack':
      return mapActive(p, (s0) => {
        const s = withTimes(s0, p.library);
        const at = Math.max(0, a.at);
        const e = newEntry(s, a.trackId, a.chapterId ?? chapterAt(s, at), at, p.library.tracks[a.trackId]);
        return withTimes({ ...s, entries: [...s.entries, e] }, p.library);
      });
    case 'setEntryTime':
      return mapActive(p, (s0) => {
        const s = withTimes(s0, p.library);
        const at = Math.max(0, a.at);
        const others = s.entries.filter((e) => e.id !== a.id);
        const before = [...others].reverse().find((e) => (e.at ?? 0) <= at);
        const after = others.find((e) => (e.at ?? 0) > at);
        const entries = s.entries.map((e) => {
          if (e.id !== a.id) return e;
          // Dropped in the middle of another chapter: become part of it.
          const adopt = before && after && before.chapterId === after.chapterId && before.chapterId !== e.chapterId;
          return { ...e, at, chapterId: adopt ? before.chapterId : e.chapterId };
        });
        return withTimes({ ...s, entries }, p.library);
      });
    case 'updateEntry':
      return mapActive(p, (s) => ({ ...s, entries: s.entries.map((e) => (e.id === a.id ? { ...e, ...a.patch } : e)) }));
    case 'removeEntry':
      return mapActive(p, (s) => ({ ...s, entries: s.entries.filter((e) => e.id !== a.id) }));
    case 'reorderEntries':
      return mapActive(p, (s) => ({ ...s, entries: reorderEntries(s, p.library, a.ids) }));
    case 'blendNight':
      return mapActive(p, (s) => ({ ...s, entries: blendNight(s, p.library, a.bars) }));
    case 'setEntrance':
      return mapActive(p, (s) => ({ ...s, entries: setEntrance(s, p.library, a.id, a.at) }));
    case 'measured': {
      const tracks = { ...p.library.tracks };
      let changed = false;
      for (const [id, d] of Object.entries(a.durations)) {
        const t = tracks[id];
        if (t && d > 0 && Math.abs((t.duration ?? 0) - d) > 0.02) {
          tracks[id] = { ...t, duration: d };
          changed = true;
        }
      }
      return changed ? { ...p, library: { ...p.library, tracks } } : p;
    }
    case 'trimEntry': {
      // A card's edge dragged on the timeline: its start or end moves to song time `to`.
      // Trimming the start also starts it later in the night, so the rest of it stays put.
      const set = withTimes(activeSet(p), p.library);
      const e = set.entries.find((x) => x.id === a.id);
      const t = e && p.library.tracks[e.trackId];
      if (!e || !t) return p;
      const oldIn = t.cues.find((c) => c.id === e.mixInCueId)?.start ?? 0;
      const to = Math.max(0, t.duration ? Math.min(t.duration, a.to) : a.to);
      const { cues, patch } = setMixPoint(t, e, a.edge === 'start' ? 'in' : 'out', a.edge === 'start' && to < 0.01 ? undefined : to, set.entries);
      const withCues = cues === t.cues ? p : apply(p, { type: 'updateTrack', id: t.id, patch: { cues: markEdits(t.cues, cues) } });
      const shift = a.edge === 'start' ? (to - oldIn) / tempoFactor(e, t) : 0;
      return mapActive(withCues, (s) => ({
        ...s,
        entries: s.entries.map((x) => (x.id === e.id ? { ...x, ...patch, ...(shift ? { at: Math.max(0, (e.at ?? 0) + shift) } : {}) } : x)),
      }));
    }
    case 'addChapter':
      return mapActive(p, (s) => ({
        ...s,
        chapters: [...s.chapters, { id: uid('ch'), name: `Chapter ${s.chapters.length + 1}`, intent: '', color: '#ff47ae' }],
      }));
    case 'updateChapter':
      return mapActive(p, (s) => ({ ...s, chapters: s.chapters.map((c) => (c.id === a.id ? { ...c, ...a.patch } : c)) }));
    case 'removeChapter':
      return mapActive(p, (s) => {
        if (s.chapters.length <= 1) return s;
        const idx = s.chapters.findIndex((c) => c.id === a.id);
        const chapters = s.chapters.filter((c) => c.id !== a.id);
        const fallback = chapters[Math.max(0, idx - 1)].id;
        return { ...s, chapters, entries: s.entries.map((e) => (e.chapterId === a.id ? { ...e, chapterId: fallback } : e)) };
      });
    case 'moveChapter':
      return mapActive(p, (s) => {
        const idx = s.chapters.findIndex((c) => c.id === a.id);
        const to = idx + a.delta;
        if (idx < 0 || to < 0 || to >= s.chapters.length) return s;
        const chapters = [...s.chapters];
        [chapters[idx], chapters[to]] = [chapters[to], chapters[idx]];
        return { ...s, chapters };
      });
    case 'clearLibrary':
      return {
        ...p,
        library: { tracks: {}, playlists: [] },
        sets: p.sets.map((s) => ({ ...s, entries: [] })),
      };
  }
}

/** Tag new cues as made in Setcraft and changed ones as edited, so merges know to keep them. */
export function markEdits(prev: Cue[], next: Cue[]): Cue[] {
  const byId = new Map(prev.map((c) => [c.id, c]));
  return next.map((c) => {
    const before = byId.get(c.id);
    if (!before) return c.origin ? c : { ...c, origin: 'manual' };
    if (c.edited) return c;
    const differs =
      before.start !== c.start ||
      before.end !== c.end ||
      before.name !== c.name ||
      before.color !== c.color ||
      before.slot !== c.slot ||
      before.kind !== c.kind;
    return differs ? { ...c, edited: true } : c;
  });
}

function newEntry(s: SetPlan, trackId: string, chapterId: string, at: number, track?: Track): SetEntry {
  const chapterIdx = Math.max(0, s.chapters.findIndex((c) => c.id === chapterId));
  const energy = Math.round(3 + (chapterIdx / Math.max(1, s.chapters.length - 1)) * 5) || 5;
  // The track's own play-from / play-until (set in the library) become this entry's mix points.
  const mixInCueId = track && trackMixCue(track, 'in')?.id;
  const mixOutCueId = track && trackMixCue(track, 'out')?.id;
  return { id: uid('ent'), trackId, chapterId, energy, transition: '', notes: '', at, ...(mixInCueId ? { mixInCueId } : {}), ...(mixOutCueId ? { mixOutCueId } : {}) };
}

/** The chapter playing at a moment: the track starting at or before it, else the next one. */
export function chapterAt(s: SetPlan, t: number): string {
  const before = [...s.entries].reverse().find((e) => (e.at ?? 0) <= t);
  return before?.chapterId ?? s.entries[0]?.chapterId ?? s.chapters[0]?.id ?? '';
}

export type StoreAction = Action | { type: 'undo' } | { type: 'redo' };

interface Store {
  project: Project;
  dispatch: (a: StoreAction) => void;
  loaded: boolean;
  /** What ⌘Z / ⇧⌘Z would undo / redo, if anything. */
  undoLabel?: string;
  redoLabel?: string;
}

/** A short name for each kind of change, shown when it's undone. */
function actionLabel(a: Action): string {
  switch (a.type) {
    case 'load':
      return 'Restore';
    case 'import':
      return 'Import';
    case 'updateTrack': {
      const k = Object.keys(a.patch);
      if (k.includes('bpm')) return 'BPM change';
      if (k.includes('key')) return 'Key change';
      if (k.includes('gridStart')) return 'Grid change';
      if (k.includes('path')) return 'File location change';
      if (k.includes('cues')) return 'Cue change';
      return 'Track edit';
    }
    case 'updateTracks':
      return Object.values(a.patches).some((p) => 'cues' in p) ? 'Auto cues' : 'BPM fixes';
    case 'scanMerge':
      return 'Music folder scan';
    case 'relink':
      return 'Found missing files';
    case 'setCues':
      return 'Cue change';
    case 'addTrack':
      return 'Add track';
    case 'addSet':
      return 'New set';
    case 'selectSet':
      return 'Switch set';
    case 'updateSet':
      return 'Set details';
    case 'deleteSet':
      return 'Delete set';
    case 'duplicateSet':
    case 'addSetCopy':
      return 'Copy set';
    case 'addEntries':
      return 'Add to set';
    case 'placeTrack':
      return 'Place track';
    case 'setEntryTime':
      return 'Move track';
    case 'updateEntry':
      return 'Track in set';
    case 'removeEntry':
      return 'Remove from set';
    case 'reorderEntries':
      return 'Reorder the night';
    case 'blendNight':
      return 'Blend the night';
    case 'trimEntry':
      return a.edge === 'start' ? 'Trim the start' : 'Trim the end';
    case 'setEntrance':
      return 'When it comes in';
    case 'measured':
      return 'Track lengths';
    case 'addChapter':
      return 'Add chapter';
    case 'updateChapter':
      return 'Chapter edit';
    case 'removeChapter':
      return 'Remove chapter';
    case 'moveChapter':
      return 'Reorder chapters';
    case 'clearLibrary':
      return 'Clear library';
  }
}

/** Continuous edits (drags, typing, sliders) share a key so they undo as one step. */
function mergeKey(a: Action): string | undefined {
  switch (a.type) {
    case 'setCues':
      return `cues:${a.trackId}`;
    case 'setEntryTime':
      return `time:${a.id}`;
    case 'updateTrack':
      return `track:${a.id}:${Object.keys(a.patch).sort().join()}`;
    case 'updateEntry':
      return `entry:${a.id}:${Object.keys(a.patch).sort().join()}`;
    case 'updateSet':
      return `set:${Object.keys(a.patch).sort().join()}`;
    case 'updateChapter':
      return `chapter:${a.id}:${Object.keys(a.patch).sort().join()}`;
    default:
      return undefined;
  }
}

function historyReducer(h: History<Project>, a: StoreAction): History<Project> {
  if (a.type === 'undo') return undo(h);
  if (a.type === 'redo') return redo(h);
  const next = reducer(h.present, a);
  if (a.type === 'load' && a.fresh) return initHistory(next);
  // Switching between sets is navigation, and a measured length is a fact: neither is an edit to undo.
  if (a.type === 'selectSet' || a.type === 'measured') return { ...h, present: next };
  return record(h, next, actionLabel(a), mergeKey(a), Date.now());
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => initHistory(emptyProject()));
  const project = history.present;
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    get<Project>(STORAGE_KEY)
      .then((saved) => {
        const pending = readPending();
        if (pending) {
          // Left with changes unsaved: they're the latest. Save them properly now.
          dispatch({ type: 'load', project: pending, fresh: true });
          idbSet(STORAGE_KEY, pending).then(clearPending, () => undefined);
        } else if (saved?.version === 1) dispatch({ type: 'load', project: saved, fresh: true });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) – run in-memory.
      })
      .finally(() => setLoaded(true));
  }, []);

  // The project still to be saved, if a save is waiting.
  const unsaved = useRef<Project | null>(null);
  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    unsaved.current = project;
    // Saving copies the whole project; do it when the browser is idle so it
    // never competes with pads, drags or playback.
    saveTimer.current = window.setTimeout(() => {
      const save = () => {
        if (unsaved.current !== project) return; // a newer change is on its way
        unsaved.current = null;
        idbSet(STORAGE_KEY, project).then(() => {
          if (!unsaved.current) clearPending();
        }, () => undefined);
      };
      if ('requestIdleCallback' in window) window.requestIdleCallback(save, { timeout: 2000 });
      else save();
    }, 600);
  }, [project, loaded]);

  // Leaving (closing the tab, reloading, switching apps on a phone): save now,
  // not after the idle wait, or the last few seconds of changes would be lost.
  useEffect(() => {
    const flush = () => {
      const p = unsaved.current;
      if (!p) return;
      window.clearTimeout(saveTimer.current);
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(p));
      } catch {
        // Too big for this storage (a huge library): the IndexedDB save below still usually lands.
      }
      unsaved.current = null;
      idbSet(STORAGE_KEY, p).catch(() => undefined);
    };
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{ project, dispatch, loaded, undoLabel: history.past.at(-1)?.label, redoLabel: history.future[0]?.label }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}
