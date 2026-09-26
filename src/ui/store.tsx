import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { get, set as idbSet } from 'idb-keyval';
import {
  emptyProject,
  mergeIntoLibrary,
  newSet,
  uid,
  type Chapter,
  type Cue,
  type Project,
  type SetEntry,
  type SetPlan,
  type Track,
} from '../core/model';
import type { ImportResult } from '../core/formats';

const STORAGE_KEY = 'setcraft-project-v1';

export type Action =
  | { type: 'load'; project: Project }
  | { type: 'import'; result: ImportResult }
  | { type: 'updateTrack'; id: string; patch: Partial<Track> }
  | { type: 'setCues'; trackId: string; cues: Cue[] }
  | { type: 'addTrack'; track: Track }
  | { type: 'addSet' }
  | { type: 'selectSet'; id: string }
  | { type: 'updateSet'; patch: Partial<SetPlan> }
  | { type: 'deleteSet'; id: string }
  | { type: 'addEntries'; trackIds: string[]; chapterId?: string }
  | { type: 'updateEntry'; id: string; patch: Partial<SetEntry> }
  | { type: 'removeEntry'; id: string }
  | { type: 'moveEntry'; id: string; toIndex: number; chapterId?: string }
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

export function reducer(p: Project, a: Action): Project {
  switch (a.type) {
    case 'load':
      return a.project;
    case 'import': {
      const { library } = mergeIntoLibrary(p.library, a.result);
      return { ...p, library };
    }
    case 'updateTrack': {
      const t = p.library.tracks[a.id];
      if (!t) return p;
      return { ...p, library: { ...p.library, tracks: { ...p.library.tracks, [a.id]: { ...t, ...a.patch } } } };
    }
    case 'setCues':
      return reducer(p, { type: 'updateTrack', id: a.trackId, patch: { cues: a.cues } });
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
    case 'addEntries':
      return mapActive(p, (s) => {
        const chapterId = a.chapterId ?? s.chapters[s.chapters.length - 1]?.id ?? '';
        const chapterIdx = s.chapters.findIndex((c) => c.id === chapterId);
        const energy = Math.round(3 + (chapterIdx / Math.max(1, s.chapters.length - 1)) * 5) || 5;
        const added: SetEntry[] = a.trackIds.map((trackId) => ({
          id: uid('ent'),
          trackId,
          chapterId,
          energy,
          transition: '',
          notes: '',
        }));
        // Insert after the last entry of that chapter so chapters stay contiguous.
        const lastIdx = findLastIndex(s.entries, (e) => chapterOrder(s, e.chapterId) <= chapterIdx);
        const entries = [...s.entries];
        entries.splice(lastIdx + 1, 0, ...added);
        return { ...s, entries };
      });
    case 'updateEntry':
      return mapActive(p, (s) => ({ ...s, entries: s.entries.map((e) => (e.id === a.id ? { ...e, ...a.patch } : e)) }));
    case 'removeEntry':
      return mapActive(p, (s) => ({ ...s, entries: s.entries.filter((e) => e.id !== a.id) }));
    case 'moveEntry':
      return mapActive(p, (s) => {
        const from = s.entries.findIndex((e) => e.id === a.id);
        if (from < 0) return s;
        const entries = [...s.entries];
        const [moved] = entries.splice(from, 1);
        const to = Math.max(0, Math.min(entries.length, a.toIndex > from ? a.toIndex - 1 : a.toIndex));
        entries.splice(to, 0, a.chapterId ? { ...moved, chapterId: a.chapterId } : moved);
        return { ...s, entries };
      });
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
        // Keep entries grouped in chapter order.
        const order = new Map(chapters.map((c, i) => [c.id, i]));
        const entries = [...s.entries].sort((x, y) => (order.get(x.chapterId) ?? 0) - (order.get(y.chapterId) ?? 0));
        return { ...s, chapters, entries };
      });
    case 'clearLibrary':
      return {
        ...p,
        library: { tracks: {}, playlists: [] },
        sets: p.sets.map((s) => ({ ...s, entries: [] })),
      };
  }
}

function chapterOrder(s: SetPlan, chapterId: string): number {
  const i = s.chapters.findIndex((c) => c.id === chapterId);
  return i < 0 ? s.chapters.length : i;
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

interface Store {
  project: Project;
  dispatch: (a: Action) => void;
  loaded: boolean;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [project, dispatch] = useReducer(reducer, undefined, emptyProject);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    get<Project>(STORAGE_KEY)
      .then((saved) => {
        if (saved?.version === 1) dispatch({ type: 'load', project: saved });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) – run in-memory.
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      idbSet(STORAGE_KEY, project).catch(() => undefined);
    }, 400);
  }, [project, loaded]);

  return <Ctx.Provider value={{ project, dispatch, loaded }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}
