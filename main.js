const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const PREVIEW_NAMES = new Set(['preview.jpg', 'preview.jpeg', 'preview.png', 'preview.gif']);

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function getSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function saveSettings(settings) {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function getLibraryData(settings, rootPath) {
  return {
    favorites: settings.favoritesByRoot?.[rootPath] || {},
    collections: settings.collectionsByRoot?.[rootPath] || []
  };
}

async function updateLibraryData(rootPath, updater) {
  const settings = await getSettings();
  const data = getLibraryData(settings, rootPath);
  updater(data);
  settings.favoritesByRoot = { ...(settings.favoritesByRoot || {}), [rootPath]: data.favorites };
  settings.collectionsByRoot = { ...(settings.collectionsByRoot || {}), [rootPath]: data.collections };
  await saveSettings(settings);
  return data;
}

async function getFolderSize(folderPath) {
  let total = 0;
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isFile()) {
      total += (await fs.stat(entryPath)).size;
    } else if (entry.isDirectory()) {
      total += await getFolderSize(entryPath);
    }
  }
  return total;
}

async function scanLibrary(rootPath) {
  const settings = await getSettings();
  const displayNames = settings.displayNamesByRoot?.[rootPath] || {};
  const { favorites, collections } = getLibraryData(settings, rootPath);
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());
  const wallpapers = await Promise.all(folders.map(async (folder) => {
    const folderPath = path.join(rootPath, folder.name);
    let children;
    try {
      children = await fs.readdir(folderPath, { withFileTypes: true });
    } catch {
      return null;
    }
    const preview = children.find((child) => child.isFile() && PREVIEW_NAMES.has(child.name.toLowerCase()));
    if (!preview) return null;
    const previewPath = path.join(folderPath, preview.name);
    const stat = await fs.stat(folderPath);
    return {
      id: folder.name,
      name: displayNames[folder.name] || folder.name,
      originalName: folder.name,
      favorite: Boolean(favorites[folder.name]),
      collectionIds: collections.filter((collection) => collection.wallpaperIds.includes(folder.name)).map((collection) => collection.id),
      folderPath,
      previewPath,
      previewType: path.extname(preview.name).toLowerCase(),
      modifiedAt: stat.mtimeMs,
      size: await getFolderSize(folderPath)
    };
  }));
  return wallpapers.filter(Boolean);
}

function isInsideRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createWindow() {
  const window = new BrowserWindow({
    title: '壁纸盒',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    width: 1240,
    height: 820,
    minWidth: 850,
    minHeight: 600,
    backgroundColor: '#101114',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  window.loadFile('renderer/index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('library:get-root', async () => (await getSettings()).libraryRoot || null);

  ipcMain.handle('library:choose-root', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Wallpaper 保存目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const libraryRoot = result.filePaths[0];
    await saveSettings({ ...(await getSettings()), libraryRoot });
    return libraryRoot;
  });

  ipcMain.handle('library:scan', async (_event, rootPath) => {
    if (!rootPath) return [];
    return scanLibrary(rootPath);
  });

  ipcMain.handle('library:rename', async (_event, { rootPath, folderPath, newName }) => {
    const cleanName = String(newName || '').trim();
    if (!cleanName || cleanName.length > 100) {
      throw new Error('请输入 1 到 100 个字符的显示名称。');
    }
    if (!isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
      throw new Error('只能修改当前壁纸目录中一级文件夹的显示名称。');
    }
    const settings = await getSettings();
    const originalName = path.basename(folderPath);
    const allDisplayNames = settings.displayNamesByRoot || {};
    const displayNames = allDisplayNames[rootPath] || {};
    if (cleanName === originalName) delete displayNames[originalName];
    else displayNames[originalName] = cleanName;
    allDisplayNames[rootPath] = displayNames;
    await saveSettings({ ...settings, displayNamesByRoot: allDisplayNames });
    return cleanName;
  });

  ipcMain.handle('library:delete', async (_event, { rootPath, folderPath }) => {
    if (!isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
      throw new Error('只能删除当前壁纸目录中的一级文件夹。');
    }
    await fs.rm(folderPath, { recursive: true, force: true, maxRetries: 2 });
    const settings = await getSettings();
    const displayNames = settings.displayNamesByRoot?.[rootPath];
    if (displayNames) {
      delete displayNames[path.basename(folderPath)];
      await saveSettings(settings);
    }
    await updateLibraryData(rootPath, (data) => {
      const originalName = path.basename(folderPath);
      delete data.favorites[originalName];
      data.collections.forEach((collection) => {
        collection.wallpaperIds = collection.wallpaperIds.filter((id) => id !== originalName);
      });
    });
  });

  ipcMain.handle('collections:get', async (_event, rootPath) => getLibraryData(await getSettings(), rootPath));

  ipcMain.handle('collections:create', async (_event, { rootPath, name, blurPreviews }) => {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 50) throw new Error('收藏夹名称需要为 1 到 50 个字符。');
    const data = await updateLibraryData(rootPath, (library) => {
      if (library.collections.some((collection) => collection.name === cleanName)) throw new Error('已有同名收藏夹。');
      library.collections.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: cleanName, wallpaperIds: [], blurPreviews: Boolean(blurPreviews) });
    });
    return data.collections.at(-1);
  });

  ipcMain.handle('collections:delete', async (_event, { rootPath, collectionId }) => updateLibraryData(rootPath, (library) => {
    library.collections = library.collections.filter((collection) => collection.id !== collectionId);
  }));

  ipcMain.handle('app:get-customization', async () => (await getSettings()).customization || {});
  ipcMain.handle('app:save-customization', async (_event, customization) => {
    const settings = await getSettings();
    settings.customization = customization || {};
    await saveSettings(settings);
  });
  ipcMain.handle('app:choose-media', async (_event, type) => {
    const filters = type === 'font'
      ? [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
      : type === 'image'
        ? [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
        : [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }];
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('app:get-user-guide', async () => fs.readFile(path.join(__dirname, 'USER_GUIDE.md'), 'utf8'));

  ipcMain.handle('collections:toggle-favorite', async (_event, { rootPath, folderPath }) => {
    if (!isInsideRoot(rootPath, folderPath)) throw new Error('壁纸不属于当前目录。');
    const originalName = path.basename(folderPath);
    const data = await updateLibraryData(rootPath, (library) => {
      if (library.favorites[originalName]) delete library.favorites[originalName];
      else library.favorites[originalName] = true;
    });
    return Boolean(data.favorites[originalName]);
  });

  ipcMain.handle('collections:toggle-wallpaper', async (_event, { rootPath, folderPath, collectionId }) => {
    if (!isInsideRoot(rootPath, folderPath)) throw new Error('壁纸不属于当前目录。');
    const originalName = path.basename(folderPath);
    return updateLibraryData(rootPath, (library) => {
      const collection = library.collections.find((item) => item.id === collectionId);
      if (!collection) throw new Error('找不到该收藏夹。');
      if (collection.wallpaperIds.includes(originalName)) {
        collection.wallpaperIds = collection.wallpaperIds.filter((id) => id !== originalName);
      } else collection.wallpaperIds.push(originalName);
    });
  });

  ipcMain.handle('library:open-folder', async (_event, folderPath) => shell.openPath(folderPath));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
