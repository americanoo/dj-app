import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { del, get, set as idbSet } from 'idb-keyval';
import type { Project } from '../core/model';
import { uid } from '../core/model';
import { pruneVersions, summarize, type VersionMeta } from '../core/versions';

const INDEX_KEY = 'setcraft-versions-v1';
const snapshotKey = (id: string) => `setcraft-version-v1:${id}`;

interface VersionsStore {
  /** Newest first. */
  versions: VersionMeta[];
  save: (project: Project, name: string, auto?: boolean) => Promise<VersionMeta>;
  load: (id: string) => Promise<Project | undefined>;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

const Ctx = createContext<VersionsStore | null>(null);

export function VersionsProvider({ children }: { children: ReactNode }) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  // Latest list for async callbacks, so rapid saves don't overwrite each other.
  const ref = useRef<VersionMeta[]>([]);

  const commit = useCallback((next: VersionMeta[]) => {
    ref.current = next;
    setVersions(next);
    idbSet(INDEX_KEY, next).catch(() => undefined);
  }, []);

  useEffect(() => {
    get<VersionMeta[]>(INDEX_KEY)
      .then((list) => {
        if (list?.length) {
          ref.current = list;
          setVersions(list);
        }
      })
      .catch(() => undefined);
  }, []);

  const save = useCallback(
    async (project: Project, name: string, auto = false) => {
      const meta: VersionMeta = { id: uid('ver'), name, createdAt: Date.now(), auto, summary: summarize(project) };
      await idbSet(snapshotKey(meta.id), project);
      const { keep, drop } = pruneVersions([meta, ...ref.current]);
      for (const d of drop) del(snapshotKey(d.id)).catch(() => undefined);
      commit(keep);
      return meta;
    },
    [commit],
  );

  const load = useCallback((id: string) => get<Project>(snapshotKey(id)), []);

  const rename = useCallback(
    (id: string, name: string) => commit(ref.current.map((v) => (v.id === id ? { ...v, name, auto: false } : v))),
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      del(snapshotKey(id)).catch(() => undefined);
      commit(ref.current.filter((v) => v.id !== id));
    },
    [commit],
  );

  return <Ctx.Provider value={{ versions, save, load, rename, remove }}>{children}</Ctx.Provider>;
}

export function useVersions(): VersionsStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useVersions outside provider');
  return s;
}

export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}
