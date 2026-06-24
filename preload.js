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
  rename: (data) => ipcRenderer.invoke('library:rename', data),
  remove: (data) => ipcRenderer.invoke('library:delete', data),
  openFolder: (folderPath) => ipcRenderer.invoke('library:open-folder', folderPath),
  getCollections: (rootPath) => ipcRenderer.invoke('collections:get', rootPath),
  createCollection: (data) => ipcRenderer.invoke('collections:create', data),
  toggleFavorite: (data) => ipcRenderer.invoke('collections:toggle-favorite', data),
  toggleCollection: (data) => ipcRenderer.invoke('collections:toggle-wallpaper', data),
  deleteCollection: (data) => ipcRenderer.invoke('collections:delete', data),
  getCustomization: () => ipcRenderer.invoke('app:get-customization'),
  saveCustomization: (data) => ipcRenderer.invoke('app:save-customization', data),
  chooseMedia: (type) => ipcRenderer.invoke('app:choose-media', type),
  toFileUrl: toLocalFileUrl
});
