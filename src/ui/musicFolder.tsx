import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { del, get, set as idbSet } from 'idb-keyval';
import { buildIndex, resolveTrackFile, type FileIndex } from '../core/pathmatch';
import { AUDIO_EXTENSIONS } from './audio';

/**
 * A linked music folder lets Setcraft find each track's audio by itself.
 *
 * - Chrome / Edge: the File System Access API. The folder handle is saved in
 *   IndexedDB, so on later visits one click ("Reconnect") restores access.
 * - Safari / Firefox: a folder <input>. Works the same, but only for the
 *   current visit.
 *
 * Only a list of file paths is kept in memory; audio is read when a track needs it.
 */

// Minimal typings for the parts of the File System Access API we use.
export interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}
export interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
type Picker = (o?: { id?: string; mode?: 'read' }) => Promise<DirHandle>;

const HANDLE_KEY = 'setcraft-music-folder-v1';

export type FolderStatus = 'none' | 'needs-permission' | 'indexing' | 'ready';

interface MusicFolderStore {
  status: FolderStatus;
  folderName: string;
  fileCount: number;
  /** The folder is remembered between visits (Chrome / Edge). */
  persistent: boolean;
  supportsPicker: boolean;
  link: () => Promise<void>;
  reconnect: () => Promise<void>;
  /** Fallback for browsers without the picker: files from <input webkitdirectory>. */
  linkFiles: (files: FileList) => void;
  unlink: () => void;
  /** The track's audio file from the linked folder, if it's there. */
  findFile: (trackPath: string | undefined) => Promise<File | undefined>;
}

const Ctx = createContext<MusicFolderStore | null>(null);

const picker = (): Picker | undefined => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

export async function walk(dir: DirHandle, prefix: string, out: Map<string, FileHandle>, onCount: (n: number) => void) {
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue; // hidden files, .Trash, etc.
    const rel = prefix + entry.name;
    if (entry.kind === 'directory') {
      // Skip only folders that hold DJ-software databases, never music:
      // Serato's library/crates and rekordbox's USB export database.
      if (/^(_Serato_|PIONEER)$/i.test(entry.name)) continue;
      await walk(entry, rel + '/', out, onCount);
    } else if (AUDIO_EXTENSIONS.test(entry.name)) {
      out.set(rel, entry);
      if (out.size % 250 === 0) onCount(out.size);
    }
  }
}

export function MusicFolderProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FolderStatus>('none');
  const [folderName, setFolderName] = useState('');
  const [fileCount, setFileCount] = useState(0);
  const [persistent, setPersistent] = useState(false);
  const handle = useRef<DirHandle | null>(null);
  const files = useRef<Map<string, FileHandle | File>>(new Map());
  const index = useRef<FileIndex>(buildIndex([]));

  const indexHandle = useCallback(async (dir: DirHandle) => {
    setStatus('indexing');
    setFolderName(dir.name);
    setFileCount(0);
    const found = new Map<string, FileHandle>();
    await walk(dir, '', found, setFileCount);
    files.current = found;
    index.current = buildIndex(found.keys());
    setFileCount(found.size);
    setStatus('ready');
  }, []);

  // Restore the remembered folder. Browsers need a click before granting access again.
  useEffect(() => {
    get<DirHandle>(HANDLE_KEY)
      .then(async (saved) => {
        if (!saved) return;
        handle.current = saved;
        setFolderName(saved.name);
        setPersistent(true);
        const perm = (await saved.queryPermission?.({ mode: 'read' })) ?? 'prompt';
        if (perm === 'granted') await indexHandle(saved);
        else setStatus('needs-permission');
      })
      .catch(() => undefined);
  }, [indexHandle]);

  const link = useCallback(async () => {
    const pick = picker();
    if (!pick) return;
    let dir: DirHandle;
    try {
      dir = await pick({ id: 'setcraft-music', mode: 'read' });
    } catch {
      return; // cancelled
    }
    handle.current = dir;
    setPersistent(true);
    idbSet(HANDLE_KEY, dir).catch(() => setPersistent(false));
    await indexHandle(dir);
  }, [indexHandle]);

  const reconnect = useCallback(async () => {
    const dir = handle.current;
    if (!dir) return link();
    const perm = (await dir.requestPermission?.({ mode: 'read' })) ?? 'denied';
    if (perm === 'granted') await indexHandle(dir);
  }, [indexHandle, link]);

  const linkFiles = useCallback((list: FileList) => {
    const found = new Map<string, File>();
    let top = '';
    for (const f of Array.from(list)) {
      if (!AUDIO_EXTENSIONS.test(f.name)) continue;
      // webkitRelativePath is "PickedFolder/sub/file.mp3"; drop the picked folder's name.
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const slash = rel.indexOf('/');
      top ||= slash > 0 ? rel.slice(0, slash) : '';
      found.set(slash > 0 ? rel.slice(slash + 1) : rel, f);
    }
    handle.current = null;
    files.current = found;
    index.current = buildIndex(found.keys());
    setFolderName(top || 'Music folder');
    setFileCount(found.size);
    setPersistent(false);
    setStatus('ready');
  }, []);

  const unlink = useCallback(() => {
    handle.current = null;
    files.current = new Map();
    index.current = buildIndex([]);
    del(HANDLE_KEY).catch(() => undefined);
    setStatus('none');
    setFolderName('');
    setFileCount(0);
    setPersistent(false);
  }, []);

  const findFile = useCallback(async (trackPath: string | undefined) => {
    const rel = resolveTrackFile(trackPath, index.current);
    const entry = rel ? files.current.get(rel) : undefined;
    if (!entry) return undefined;
    return entry instanceof File ? entry : entry.getFile();
  }, []);

  return (
    <Ctx.Provider
      value={{
        status,
        folderName,
        fileCount,
        persistent,
        supportsPicker: !!picker(),
        link,
        reconnect,
        linkFiles,
        unlink,
        findFile,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useMusicFolder(): MusicFolderStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useMusicFolder outside provider');
  return s;
}
