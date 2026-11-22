import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { importFile, type ImportResult } from '../core/formats';
import { planMerge } from '../core/merge';
import type { Track } from '../core/model';
import { applyMove, folderMove, relinkMissing, type ScanEntry } from '../core/musiclib';
import { reducer, useStore } from './store';
import { notify } from './toastBus';

/**
 * The Mac app's side of Setcraft (see desktop/): music folders scanned into the
 * library, files that went missing found again, and the DJ software's
 * collection kept in sync. In the web version none of this exists and
 * `useDesktop().available` is false.
 */

export interface DesktopSettings {
  folders: string[];
  collection?: string;
}
export interface FoundLibrary {
  kind: 'traktor';
  name: string;
  path: string;
  modified: number;
}
export interface ScanProgress {
  done: number;
  total: number;
  folder: string;
}

/** What preload.cjs exposes. */
interface DesktopApi {
  version: number;
  getSettings(): Promise<DesktopSettings>;
  addFolders(): Promise<DesktopSettings>;
  removeFolder(folder: string): Promise<DesktopSettings>;
  scan(): Promise<ScanEntry[]>;
  onScanProgress(cb: (p: ScanProgress) => void): () => void;
  detectLibraries(): Promise<FoundLibrary[]>;
  chooseCollection(): Promise<string | undefined>;
  readFile(path: string): Promise<Uint8Array>;
  syncCollection(path: string | null): Promise<DesktopSettings>;
  onCollectionChanged(cb: (path: string) => void): () => void;
  exists(paths: string[]): Promise<boolean[]>;
  chooseAudio(title?: string): Promise<string | undefined>;
}

const api = (): DesktopApi | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { setcraftDesktop?: DesktopApi }).setcraftDesktop;

/** Open one of the Mac app's panels from anywhere (App.tsx shows it). */
export function openDesktopPanel(panel: 'music' | 'missing') {
  window.dispatchEvent(new CustomEvent('setcraft-open-panel', { detail: panel }));
}

/** Ask the app (App.tsx) to import files as if they'd been picked: same review, same messages. */
export function requestImport(files: File[]) {
  window.dispatchEvent(new CustomEvent('setcraft-import-files', { detail: files }));
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export interface DesktopStore {
  available: boolean;
  /** The app's settings have been read (so an empty folder list really means none yet). */
  ready: boolean;
  settings: DesktopSettings;
  libraries: FoundLibrary[];
  /** Files found by the last scan. */
  entries: ScanEntry[];
  scanning: ScanProgress | null;
  /** Tracks whose file is missing and couldn't be found automatically. */
  missing: Track[];
  addFolders: () => Promise<void>;
  removeFolder: (folder: string) => Promise<void>;
  rescan: () => Promise<void>;
  /** Import a collection file from disk; `keepSynced` re-imports it whenever it changes. */
  importCollection: (path: string, keepSynced: boolean) => Promise<void>;
  chooseCollection: () => Promise<string | undefined>;
  stopSync: () => Promise<void>;
  /** Point at one missing file's new place; others in the same folder follow. */
  locate: (track: Track) => Promise<void>;
  /** Before an import is merged: paths that don't exist here are pointed at the files found in the music folders. */
  remapImport: (result: ImportResult) => Promise<ImportResult>;
}

const Ctx = createContext<DesktopStore | null>(null);

export function DesktopProvider({ children }: { children: ReactNode }) {
  const a = api();
  const { project, dispatch, loaded } = useStore();
  const projectRef = useRef(project);
  projectRef.current = project;
  const [settings, setSettings] = useState<DesktopSettings>({ folders: [] });
  const [ready, setReady] = useState(false);
  const [libraries, setLibraries] = useState<FoundLibrary[]>([]);
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const [missing, setMissing] = useState<Track[]>([]);

  /** Which tracks' files are gone; the ones found in the music folders are fixed straight away. */
  const checkMissing = useCallback(async () => {
    if (!a) return;
    const tracks = Object.values(projectRef.current.library.tracks).filter((t) => t.path);
    const here = await a.exists(tracks.map((t) => t.path!));
    const gone = tracks.filter((_, i) => !here[i]);
    if (!gone.length) {
      setMissing([]);
      return;
    }
    const { found, unresolved } = relinkMissing(gone, entriesRef.current);
    const n = Object.keys(found).length;
    if (n) {
      dispatch({ type: 'relink', paths: found });
      notify(`${n} moved file${n === 1 ? '' : 's'} found again in your music folders.`);
    }
    setMissing(unresolved);
  }, [a, dispatch]);

  const rescan = useCallback(async () => {
    if (!a) return;
    const s = await a.getSettings();
    setSettings(s);
    setReady(true);
    if (!s.folders.length) {
      await checkMissing();
      return;
    }
    setScanning({ done: 0, total: 0, folder: s.folders[0] });
    const off = a.onScanProgress(setScanning);
    try {
      const found = await a.scan();
      setEntries(found);
      entriesRef.current = found;
      const before = Object.keys(projectRef.current.library.tracks).length;
      const action = { type: 'scanMerge' as const, entries: found };
      const after = Object.keys(reducer(projectRef.current, action).library.tracks).length;
      dispatch(action);
      if (after > before) notify(`${after - before} new track${after - before === 1 ? '' : 's'} from your music folders.`);
      // Let the store update before checking files against it.
      await new Promise((r) => setTimeout(r, 0));
      await checkMissing();
    } finally {
      off();
      setScanning(null);
    }
  }, [a, checkMissing, dispatch]);

  // On launch (once the saved library is loaded): settings, libraries on this Mac, and a quick rescan.
  const started = useRef(false);
  useEffect(() => {
    if (!a || !loaded || started.current) return;
    started.current = true;
    void a.detectLibraries().then(setLibraries, () => undefined);
    void rescan();
  }, [a, loaded, rescan]);

  // Tracks added or removed (an import, a clear): check their files again, once things settle.
  const trackCount = Object.keys(project.library.tracks).length;
  useEffect(() => {
    if (!a || !ready || !started.current || scanning) return;
    const t = window.setTimeout(() => void checkMissing(), 600);
    return () => window.clearTimeout(t);
  }, [a, ready, trackCount, scanning, checkMissing]);

  const remapImport = useCallback(
    async (result: ImportResult): Promise<ImportResult> => {
      if (!a || !entriesRef.current.length) return result;
      const withPath = result.tracks.filter((t) => t.path);
      if (!withPath.length) return result;
      const here = await a.exists(withPath.map((t) => t.path!));
      const gone = withPath.filter((_, i) => !here[i]);
      if (!gone.length) return result;
      const { found } = relinkMissing(gone, entriesRef.current);
      if (!Object.keys(found).length) return result;
      return { ...result, tracks: result.tracks.map((t) => (found[t.id] ? { ...t, path: found[t.id] } : t)) };
    },
    [a],
  );

  // The synced collection changed (the DJ software saved it): bring the changes in, keeping Setcraft's edits.
  useEffect(() => {
    if (!a) return;
    return a.onCollectionChanged(async (path) => {
      try {
        const raw = importFile(fileName(path), await a.readFile(path));
        const result = await remapImport(raw);
        const plan = planMerge(projectRef.current.library, result);
        const changed = plan.matches.filter((m) => m.changed).length;
        if (!plan.newTracks.length && !changed) return;
        dispatch({ type: 'import', result, choices: { strategy: 'smart' } });
        const parts = [plan.newTracks.length ? `+${plan.newTracks.length} tracks` : '', changed ? `${changed} updated` : ''].filter(Boolean);
        notify(`${fileName(path)} changed: ${parts.join(' · ')} (your Setcraft edits kept).`, 'info', {
          label: 'Undo',
          run: () => dispatch({ type: 'undo' }),
        });
        await new Promise((r) => setTimeout(r, 0));
        await checkMissing();
      } catch (e) {
        notify(`Couldn't read ${fileName(path)}: ${(e as Error).message}`, 'error');
      }
    });
  }, [a, checkMissing, dispatch, remapImport]);

  const value = useMemo<DesktopStore>(
    () => ({
      available: !!a,
      ready,
      settings,
      libraries,
      entries,
      scanning,
      missing,
      rescan,
      remapImport,
      addFolders: async () => {
        if (!a) return;
        const before = settings.folders.length;
        const s = await a.addFolders();
        setSettings(s);
        if (s.folders.length > before) await rescan();
      },
      removeFolder: async (folder) => {
        if (!a) return;
        setSettings(await a.removeFolder(folder));
      },
      chooseCollection: async () => a?.chooseCollection(),
      importCollection: async (path, keepSynced) => {
        if (!a) return;
        const bytes = await a.readFile(path);
        requestImport([new File([bytes as BlobPart], fileName(path))]);
        setSettings(await a.syncCollection(keepSynced ? path : null));
      },
      stopSync: async () => {
        if (a) setSettings(await a.syncCollection(null));
      },
      locate: async (track) => {
        if (!a || !track.path) return;
        const picked = await a.chooseAudio(`Where is “${track.artist ? `${track.artist} - ` : ''}${track.title}” now?`);
        if (!picked) return;
        const paths: Record<string, string> = { [track.id]: picked };
        const move = folderMove(track.path, picked);
        const others = missing.filter((t) => t.id !== track.id && t.path);
        if (move && others.length) {
          const candidates = others.map((t) => [t, applyMove(t.path!, move)] as const).filter((x): x is readonly [Track, string] => !!x[1]);
          const here = await a.exists(candidates.map(([, p]) => p));
          candidates.forEach(([t, p], i) => here[i] && (paths[t.id] = p));
        }
        dispatch({ type: 'relink', paths });
        const n = Object.keys(paths).length;
        setMissing((m) => m.filter((t) => !paths[t.id]));
        notify(n > 1 ? `Found ${n} files: the others in that folder followed.` : 'Found it.');
      },
    }),
    [a, ready, settings, libraries, entries, scanning, missing, rescan, remapImport, dispatch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDesktop(): DesktopStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useDesktop outside DesktopProvider');
  return s;
}
