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
import { copySet } from '../core/versions';
import { initHistory, record, redo, undo, type History } from '../core/history';
import { playLength, setEnd, withTimes } from '../core/setplan';

const STORAGE_KEY = 'setcraft-project-v1';

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
  | { type: 'addEntries'; trackIds: string[]; chapterId?: string }
  | { type: 'placeTrack'; trackId: string; at: number; chapterId?: string }
  | { type: 'setEntryTime'; id: string; at: number }
  | { type: 'updateEntry'; id: string; patch: Partial<SetEntry> }
  | { type: 'removeEntry'; id: string }
  | { type: 'addChapter' }
  | { type: 'updateChapter'; id: string; patch: Partial<Chapter> }
  | { type: 'removeChapter'; id: string }
  | { type: 'moveChapter'; id: string; delta: number }
  | { type: 'clearLibrary' };

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
        const added = a.trackIds.map((trackId) => {
          const e = newEntry(s, trackId, chapterId, cursor);
          cursor += playLength(e, p.library.tracks[trackId]).seconds;
          return e;
        });
        return { ...s, entries: [...s.entries, ...added] };
      });
    case 'placeTrack':
      return mapActive(p, (s0) => {
        const s = withTimes(s0, p.library);
        const at = Math.max(0, a.at);
        const e = newEntry(s, a.trackId, a.chapterId ?? chapterAt(s, at), at);
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

function newEntry(s: SetPlan, trackId: string, chapterId: string, at: number): SetEntry {
  const chapterIdx = Math.max(0, s.chapters.findIndex((c) => c.id === chapterId));
  const energy = Math.round(3 + (chapterIdx / Math.max(1, s.chapters.length - 1)) * 5) || 5;
  return { id: uid('ent'), trackId, chapterId, energy, transition: '', notes: '', at };
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
  // Switching between sets is navigation, not an edit.
  if (a.type === 'selectSet') return { ...h, present: next };
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
        if (saved?.version === 1) dispatch({ type: 'load', project: saved, fresh: true });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) – run in-memory.
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    // Saving copies the whole project; do it when the browser is idle so it
    // never competes with pads, drags or playback.
    saveTimer.current = window.setTimeout(() => {
      const save = () => idbSet(STORAGE_KEY, project).catch(() => undefined);
      if ('requestIdleCallback' in window) window.requestIdleCallback(save, { timeout: 2000 });
      else save();
    }, 600);
  }, [project, loaded]);

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
