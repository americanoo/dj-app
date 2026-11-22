/**
 * What the Setcraft page may ask of the Mac app (see main.ts). Nothing else of
 * Electron or Node reaches the page.
 */
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const l = (_e, value) => cb(value);
  ipcRenderer.on(channel, l);
  return () => ipcRenderer.removeListener(channel, l);
};

contextBridge.exposeInMainWorld('setcraftDesktop', {
  version: 1,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  addFolders: () => ipcRenderer.invoke('folders:add'),
  removeFolder: (folder) => ipcRenderer.invoke('folders:remove', folder),
  scan: () => ipcRenderer.invoke('scan'),
  onScanProgress: listen('scan:progress'),
  detectLibraries: () => ipcRenderer.invoke('libraries:detect'),
  chooseCollection: () => ipcRenderer.invoke('collection:choose'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  syncCollection: (path) => ipcRenderer.invoke('collection:sync', path),
  onCollectionChanged: listen('collection:changed'),
  exists: (paths) => ipcRenderer.invoke('files:exist', paths),
  chooseAudio: (title) => ipcRenderer.invoke('audio:choose', title),
});
