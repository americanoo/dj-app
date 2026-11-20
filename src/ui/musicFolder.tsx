import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { clear, createStore, del, get, keys, set as idbSet } from 'idb-keyval';
import { buildIndex, findTrackFile, type FileIndex, type TrackRef } from '../core/pathmatch';
import { AUDIO_EXTENSIONS } from './audio';
import { detectHelper, helperFile, type HelperInfo } from './helper';

/**
 * A linked music folder lets Setcraft find each track's audio by itself.
 *
 * - Chrome / Edge: the File System Access API. The folder handle is saved in
 *   IndexedDB, so on later visits one click ("Reconnect") restores access.
 * - Safari / Firefox: a folder <input>. Works the same, but only for the
 *   current visit.
 *
 * - Anywhere, and the only way on a phone: songs added with "Add music" are
 *   kept on this device (in the browser's storage), so they're there on every
 *   visit with nothing to link. Picked from the Files app, they can come from
 *   iCloud, the phone itself or a drive plugged into it.
 *
 * - The Setcraft helper on the computer with the music (helper/): when it's
 *   serving the page, every track's audio comes straight from that computer's
 *   drives, from where the DJ software saved it. Nothing to link or add.
 *
 * Only a list of file paths is kept in memory; audio is read when a track needs it.
 * Tracks are matched to files by name, loosely (see core/pathmatch), never by
 * where the DJ software said the file was.
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

/** Songs kept on this device, by file name. A store of its own, so it's never mixed up with project data. */
const deviceStore = createStore('setcraft-music', 'files');

export interface AddMusicResult {
  /** Names of the songs now kept on this device. */
  added: string[];
  /** Songs that couldn't be kept (storage full): they still play until the page is closed. */
  notKept: number;
}

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
  /** Songs kept on this device ("Add music"). */
  deviceCount: number;
  addMusic: (files: File[]) => Promise<AddMusicResult>;
  removeDeviceMusic: () => Promise<void>;
  /** The Setcraft helper serving this page, if it is (see helper.ts). */
  helper: HelperInfo | null;
  /** A linked folder, songs on this device or the helper: somewhere tracks' audio can come from. */
  hasMusic: boolean;
  /** Changes whenever the music available changes, so missing tracks are looked for again. */
  revision: number;
  /** The track's audio file from the linked folder or this device, if it's there. */
  findFile: (track: TrackRef | undefined) => Promise<File | undefined>;
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
  const [deviceCount, setDeviceCount] = useState(0);
  const deviceIndex = useRef<FileIndex>(buildIndex([]));
  /** Songs added this visit, so they aren't read back from storage. Also holds any that couldn't be kept. */
  const deviceFiles = useRef<Map<string, File>>(new Map());
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  const [helper, setHelper] = useState<HelperInfo | null>(null);
  const helperRef = useRef<HelperInfo | null>(null);
  useEffect(() => {
    void detectHelper().then((h) => {
      helperRef.current = h;
      setHelper(h);
      if (h?.paired) bump();
    });
  }, [bump]);

  // The songs kept on this device: only their names are read now.
  useEffect(() => {
    keys(deviceStore)
      .then((names) => {
        const list = names.filter((k): k is string => typeof k === 'string');
        deviceIndex.current = buildIndex(list);
        setDeviceCount(list.length);
        if (list.length) bump();
      })
      .catch(() => undefined);
  }, [bump]);

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
    bump();
  }, [bump]);

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
    bump();
  }, [bump]);

  const unlink = useCallback(() => {
    handle.current = null;
    files.current = new Map();
    index.current = buildIndex([]);
    del(HANDLE_KEY).catch(() => undefined);
    setStatus('none');
    setFolderName('');
    setFileCount(0);
    setPersistent(false);
    bump();
  }, [bump]);

  const addMusic = useCallback(
    async (picked: File[]): Promise<AddMusicResult> => {
      const songs = picked.filter((f) => AUDIO_EXTENSIONS.test(f.name));
      // Ask the browser not to clear these when space runs low (granted for installed apps).
      void navigator.storage?.persist?.().catch(() => undefined);
      const added: string[] = [];
      let notKept = 0;
      for (const f of songs) {
        deviceFiles.current.set(f.name, f);
        added.push(f.name);
        try {
          await idbSet(f.name, f, deviceStore);
        } catch {
          notKept++;
        }
      }
      const kept = await keys<string>(deviceStore).catch((): string[] => []);
      const names = new Set([...kept.filter((k) => typeof k === 'string'), ...added]);
      deviceIndex.current = buildIndex(names);
      setDeviceCount(names.size);
      bump();
      return { added, notKept };
    },
    [bump],
  );

  const removeDeviceMusic = useCallback(async () => {
    await clear(deviceStore).catch(() => undefined);
    deviceFiles.current = new Map();
    deviceIndex.current = buildIndex([]);
    setDeviceCount(0);
    bump();
  }, [bump]);

  const findFile = useCallback(async (track: TrackRef | undefined) => {
    if (!track) return undefined;
    const rel = findTrackFile(track, index.current);
    const entry = rel ? files.current.get(rel) : undefined;
    if (entry) return entry instanceof File ? entry : entry.getFile();
    const name = findTrackFile(track, deviceIndex.current);
    const here = name ? deviceFiles.current.get(name) : undefined;
    if (here) return here;
    const kept = name ? await get<Blob>(name, deviceStore).catch(() => undefined) : undefined;
    if (kept) return kept instanceof File ? kept : new File([kept], name!, { type: kept.type });
    if (helperRef.current?.paired) return helperFile(track);
    return undefined;
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
        deviceCount,
        addMusic,
        removeDeviceMusic,
        helper,
        hasMusic: status === 'ready' || deviceCount > 0 || !!helper?.paired,
        revision,
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
