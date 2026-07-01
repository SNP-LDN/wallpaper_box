const { contextBridge, ipcRenderer } = require('electron');

function toLocalFileUrl(filePath) {
  // Electron 的 preload 环境中不依赖 node:url，避免某些版本的兼容性问题。
  // encodeURI 会保留盘符冒号与路径分隔符，并处理中文、空格等文件名。
  return `file:///${encodeURI(String(filePath).replace(/\\/g, '/'))}`;
}

contextBridge.exposeInMainWorld('wallpaperLibrary', {
  getRoot: () => ipcRenderer.invoke('library:get-root'),
  chooseRoot: () => ipcRenderer.invoke('library:choose-root'),
  scan: (rootPath) => ipcRenderer.invoke('library:scan', rootPath),
  getSteamStatusCache: () => ipcRenderer.invoke('library:get-steam-status-cache'),
  saveSteamStatusCache: (data) => ipcRenderer.invoke('library:save-steam-status-cache', data),
  checkSteamStatus: (data) => ipcRenderer.invoke('library:check-steam-status', data),
  onSteamCheckProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('library:steam-check-progress', listener);
    return () => ipcRenderer.removeListener('library:steam-check-progress', listener);
  },
  rename: (data) => ipcRenderer.invoke('library:rename', data),
  remove: (data) => ipcRenderer.invoke('library:delete', data),
  moveMany: (data) => ipcRenderer.invoke('library:move-many', data),
  openFolder: (folderPath) => ipcRenderer.invoke('library:open-folder', folderPath),
  getCollections: (rootPath) => ipcRenderer.invoke('collections:get', rootPath),
  createCollection: (data) => ipcRenderer.invoke('collections:create', data),
  addManyToCollection: (data) => ipcRenderer.invoke('collections:add-many', data),
  toggleFavorite: (data) => ipcRenderer.invoke('collections:toggle-favorite', data),
  toggleCollection: (data) => ipcRenderer.invoke('collections:toggle-wallpaper', data),
  deleteCollection: (data) => ipcRenderer.invoke('collections:delete', data),
  getCustomization: () => ipcRenderer.invoke('app:get-customization'),
  saveCustomization: (data) => ipcRenderer.invoke('app:save-customization', data),
  chooseMedia: (type) => ipcRenderer.invoke('app:choose-media', type),
  getUserGuide: () => ipcRenderer.invoke('app:get-user-guide'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update', true),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  toFileUrl: toLocalFileUrl
});
