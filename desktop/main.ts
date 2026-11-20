/**
 * Setcraft for Mac (Electron main process).
 *
 * The window shows the same Setcraft as the web version, served by the built-in
 * Setcraft helper on this Mac's own address (a secure page, so key lock works),
 * which also plays every track straight from where it is on disk. On top of
 * that the app can do what a web page can't: remember your music folders and
 * scan them, find your Traktor collection, notice when Traktor saves it, and
 * check which files have gone missing. The page reaches these through
 * window.setcraftDesktop (see preload.cjs).
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';
import { createHelper, loadToken } from '../helper/setcraft-helper.mjs';
import type { ScanEntry } from '../src/core/musiclib';
import { findLibraries } from './libraries';
import { scanFolders } from './scan';

const here = dirname(fileURLToPath(import.meta.url));
// Always the same address, so the page's saved library is found again on every launch.
const PORT = Number(process.env.SETCRAFT_PORT || 47173);
const COLLECTION_TYPES = ['nml', 'xml', 'crate', 'm3u', 'm3u8', 'csv', 'tsv', 'txt', 'json'];
const AUDIO_TYPES = ['mp3', 'wav', 'aif', 'aiff', 'flac', 'm4a', 'mp4', 'aac', 'ogg', 'opus'];

// Tests run the app with their own data folder and home.
if (process.env.SETCRAFT_USER_DATA) app.setPath('userData', process.env.SETCRAFT_USER_DATA);
const HOME = process.env.SETCRAFT_HOME || homedir();
app.setName('Setcraft');

interface Settings {
  folders: string[];
  /** The DJ-software collection kept in sync (re-imported when it changes). */
  collection?: string;
}

const file = (name: string) => join(app.getPath('userData'), name);
async function loadJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}
async function saveJson(name: string, data: unknown) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(file(name), JSON.stringify(data));
}

let settings: Settings = { folders: [] };
let win: BrowserWindow | null = null;
let helper: Awaited<ReturnType<typeof createHelper>> | null = null;
const saveSettings = () => saveJson('settings.json', settings);

async function readTags(path: string): Promise<Partial<ScanEntry>> {
  const { common, format } = await parseFile(path, { skipCovers: true });
  return {
    title: common.title,
    artist: common.artist,
    album: common.album,
    genre: common.genre?.[0],
    bpm: common.bpm ? Math.round(common.bpm * 100) / 100 : undefined,
    key: common.key,
    duration: format.duration,
  };
}

// Traktor saves its collection by writing a new file in its place, so the folder is watched.
let watcher: FSWatcher | null = null;
let lastSeen = 0;
let debounce: NodeJS.Timeout | undefined;
function watchCollection(path: string | undefined) {
  watcher?.close();
  watcher = null;
  if (!path) return;
  void stat(path).then((s) => (lastSeen = s.mtimeMs), () => undefined);
  try {
    watcher = watch(dirname(path), (_event, name) => {
      if (name && name !== basename(path)) return;
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const s = await stat(path).catch(() => undefined);
        if (!s || s.mtimeMs === lastSeen) return;
        lastSeen = s.mtimeMs;
        win?.webContents.send('collection:changed', path);
      }, 1500);
    });
  } catch {
    // the folder is gone: nothing to watch
  }
}

function pick(options: Electron.OpenDialogOptions) {
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('folders:add', async () => {
  const r = await pick({ title: 'Add a music folder or drive', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return settings;
  settings.folders = [...new Set([...settings.folders, ...r.filePaths])];
  await saveSettings();
  void helper?.setMusic(settings.folders);
  return settings;
});
ipcMain.handle('folders:remove', async (_e, folder: string) => {
  settings.folders = settings.folders.filter((f) => f !== folder);
  await saveSettings();
  void helper?.setMusic(settings.folders);
  return settings;
});
ipcMain.handle('scan', async () => {
  const cache = await loadJson<Record<string, ScanEntry>>('scan-cache.json', {});
  const result = await scanFolders(settings.folders, cache, readTags, (p) => win?.webContents.send('scan:progress', p));
  await saveJson('scan-cache.json', result.cache);
  return result.entries;
});
ipcMain.handle('libraries:detect', () => findLibraries(HOME));
ipcMain.handle('collection:choose', async () => {
  const r = await pick({ title: 'Choose your DJ software’s collection', properties: ['openFile'], filters: [{ name: 'Collections and playlists', extensions: COLLECTION_TYPES }] });
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle('file:read', async (_e, path: string) => {
  // Collections and playlists only: audio is played through the helper, nothing else is read.
  if (!COLLECTION_TYPES.includes(extname(path).slice(1).toLowerCase())) throw new Error('Not a collection file');
  return new Uint8Array(await readFile(path));
});
ipcMain.handle('collection:sync', async (_e, path: string | null) => {
  settings.collection = path ?? undefined;
  await saveSettings();
  watchCollection(settings.collection);
  return settings;
});
ipcMain.handle('files:exist', (_e, paths: string[]) =>
  Promise.all(paths.map((p) => stat(p).then((s) => s.isFile(), () => false))),
);
ipcMain.handle('audio:choose', async (_e, title?: string) => {
  const r = await pick({ title: title || 'Locate the file', properties: ['openFile'], filters: [{ name: 'Audio', extensions: AUDIO_TYPES }] });
  return r.canceled ? undefined : r.filePaths[0];
});

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Setcraft',
    backgroundColor: '#040406',
    show: false,
    webPreferences: { preload: join(here, '..', 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win?.show());
  // Links to the web open in the browser, not in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => (win = null));
  await win.loadURL(`http://127.0.0.1:${PORT}/`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    settings = await loadJson<Settings>('settings.json', { folders: [] });
    helper = await createHelper({
      token: loadToken(file('helper.json')),
      app: join(app.getAppPath(), 'dist'),
      music: settings.folders,
      trustLoopback: true,
    });
    await new Promise<void>((resolve, reject) => {
      helper!.once('error', reject);
      helper!.listen(PORT, '127.0.0.1', () => resolve());
    });
    watchCollection(settings.collection);
    await createWindow();
    app.on('activate', () => {
      if (!win) void createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
