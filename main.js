const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const path = require('node:path');

const PREVIEW_NAMES = new Set(['preview.jpg', 'preview.jpeg', 'preview.png', 'preview.gif']);
const DOWNLOAD_LINKS = {
  github: 'https://github.com/SNP-LDN/wallpaper_box/releases',
  baidu: 'https://pan.baidu.com/s/5_e1z8bEEHWcTm48az00-PA',
  quark: 'https://pan.quark.cn/s/1c8894a8bc1a'
};
let mainWindow = null;
let manualUpdateCheck = false;
let updateReadyToInstall = false;

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getUniqueDestination(destinationRoot, folderName) {
  const parsed = path.parse(folderName);
  let destinationPath = path.join(destinationRoot, folderName);
  let index = 2;
  while (await pathExists(destinationPath)) {
    destinationPath = path.join(destinationRoot, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return destinationPath;
}

function isSameOrInside(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function moveFolder(sourcePath, destinationPath) {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true });
    await fs.rm(sourcePath, { recursive: true, force: true, maxRetries: 2 });
  }
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
  mainWindow = window;
  return window;
}

function sendUpdateStatus(status) {
  mainWindow?.webContents.send('update:status', status);
}

function isMissingUpdateMetadataError(error) {
  const message = String(error?.message || error || '');
  return message.includes('latest.yml') && message.includes('404');
}

async function showDownloadLinksDialog({ title, message, detail, type = 'info' }) {
  const result = await dialog.showMessageBox(mainWindow, {
    type,
    title,
    message,
    detail,
    buttons: ['GitHub', '百度网盘', '夸克云', '关闭'],
    defaultId: 0,
    cancelId: 3
  });
  if (result.response === 0) shell.openExternal(DOWNLOAD_LINKS.github);
  else if (result.response === 1) shell.openExternal(DOWNLOAD_LINKS.baidu);
  else if (result.response === 2) shell.openExternal(DOWNLOAD_LINKS.quark);
}

function setupAutoUpdater() {
  if (isPortableBuild()) {
    sendUpdateStatus({ state: 'portable', message: '便携版不支持应用内更新，请下载新版便携版或安装版。' });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ state: 'checking', message: '正在检查更新...' });
  });

  autoUpdater.on('update-available', async (info) => {
    sendUpdateStatus({ state: 'available', version: info.version, message: `发现新版本 v${info.version}` });
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${info.version}`,
      detail: '安装版可以在应用内下载并安装更新。也可以选择网盘链接手动下载。',
      buttons: ['应用内下载', 'GitHub', '百度网盘', '夸克云', '稍后'],
      defaultId: 0,
      cancelId: 4
    });
    if (result.response === 0) {
      sendUpdateStatus({ state: 'downloading', version: info.version, message: '正在下载更新...' });
      autoUpdater.downloadUpdate();
    } else if (result.response === 1) {
      shell.openExternal(DOWNLOAD_LINKS.github);
    } else if (result.response === 2) {
      shell.openExternal(DOWNLOAD_LINKS.baidu);
    } else if (result.response === 3) {
      shell.openExternal(DOWNLOAD_LINKS.quark);
    }
  });

  autoUpdater.on('update-not-available', () => {
    const status = { state: 'not-available', message: '当前已经是最新版本。' };
    sendUpdateStatus(status);
    if (manualUpdateCheck) dialog.showMessageBox(mainWindow, { type: 'info', title: '检查更新', message: status.message });
    manualUpdateCheck = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      state: 'downloading',
      percent: progress.percent,
      message: `正在下载更新... ${Math.round(progress.percent)}%`
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    updateReadyToInstall = true;
    sendUpdateStatus({ state: 'downloaded', version: info.version, message: '更新已下载，重启后即可安装。' });
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已准备好',
      message: `v${info.version} 已下载完成`,
      detail: '是否现在重启应用并安装更新？',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on('error', async (error) => {
    manualUpdateCheck = false;
    if (isMissingUpdateMetadataError(error)) {
      const status = { state: 'error', message: '自动更新文件未上传，请通过下载链接获取新版。' };
      sendUpdateStatus(status);
      await showDownloadLinksDialog({
        title: '无法自动更新',
        message: '没有找到自动更新文件 latest.yml',
        detail: '当前 GitHub Release 缺少安装版自动更新所需的 latest.yml 文件，应用内自动更新暂时不可用。你可以通过下面的链接手动下载新版。'
      });
      return;
    }
    sendUpdateStatus({ state: 'error', message: `检查更新失败：${error.message}` });
    await showDownloadLinksDialog({
      type: 'error',
      title: '检查更新失败',
      message: '检查更新时遇到问题',
      detail: `${error.message}\n\n你也可以通过下面的链接手动下载新版。`
    });
  });
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

  ipcMain.handle('library:move-many', async (_event, { rootPath, folderPaths }) => {
    const pathsToMove = Array.isArray(folderPaths) ? [...new Set(folderPaths)] : [];
    if (!rootPath || !pathsToMove.length) return { moved: 0 };
    for (const folderPath of pathsToMove) {
      if (!isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
        throw new Error('只能移动当前壁纸目录中的一级壁纸文件夹。');
      }
    }
    const result = await dialog.showOpenDialog({
      title: '选择要移动到的文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { moved: 0, canceled: true };
    const destinationRoot = result.filePaths[0];
    if (path.resolve(destinationRoot) === path.resolve(rootPath)) {
      throw new Error('请选择不同的目标文件夹。');
    }
    if (pathsToMove.some((folderPath) => isSameOrInside(folderPath, destinationRoot))) {
      throw new Error('目标文件夹不能在已选择的壁纸文件夹里面。');
    }
    let moved = 0;
    const movedNames = [];
    for (const folderPath of pathsToMove) {
      const originalName = path.basename(folderPath);
      const destinationPath = await getUniqueDestination(destinationRoot, originalName);
      await moveFolder(folderPath, destinationPath);
      moved += 1;
      movedNames.push(originalName);
    }
    const settings = await getSettings();
    const displayNames = settings.displayNamesByRoot?.[rootPath];
    if (displayNames) {
      movedNames.forEach((name) => delete displayNames[name]);
      await saveSettings(settings);
    }
    await updateLibraryData(rootPath, (data) => {
      const movedNameSet = new Set(movedNames);
      movedNames.forEach((name) => {
        delete data.favorites[name];
      });
      data.collections.forEach((collection) => {
        collection.wallpaperIds = collection.wallpaperIds.filter((id) => !movedNameSet.has(id));
      });
    });
    return { moved };
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

  ipcMain.handle('app:check-update', async (_event, manual = true) => {
    manualUpdateCheck = Boolean(manual);
    if (isPortableBuild()) {
      const status = { state: 'portable', message: '便携版不支持应用内更新，请下载新版便携版或安装版。' };
      sendUpdateStatus(status);
      if (manualUpdateCheck) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '检查更新',
          message: status.message,
          detail: '便携版需要手动下载新版程序。',
          buttons: ['GitHub', '百度网盘', '夸克云', '关闭'],
          defaultId: 0,
          cancelId: 3
        });
        if (result.response === 0) shell.openExternal(DOWNLOAD_LINKS.github);
        else if (result.response === 1) shell.openExternal(DOWNLOAD_LINKS.baidu);
        else if (result.response === 2) shell.openExternal(DOWNLOAD_LINKS.quark);
      }
      manualUpdateCheck = false;
      return status;
    }
    if (!app.isPackaged) {
      const status = { state: 'dev', message: '开发模式下不会检查线上更新。' };
      sendUpdateStatus(status);
      return status;
    }
    await autoUpdater.checkForUpdates();
    return { state: 'checking', message: '正在检查更新...' };
  });

  ipcMain.handle('app:install-update', async () => {
    if (!updateReadyToInstall) return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

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

  ipcMain.handle('collections:add-many', async (_event, { rootPath, folderPaths, collectionId }) => {
    const pathsToAdd = Array.isArray(folderPaths) ? [...new Set(folderPaths)] : [];
    if (!rootPath || !pathsToAdd.length) return getLibraryData(await getSettings(), rootPath);
    const wallpaperIds = pathsToAdd.map((folderPath) => {
      if (!isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
        throw new Error('只能添加当前壁纸目录中的壁纸。');
      }
      return path.basename(folderPath);
    });
    return updateLibraryData(rootPath, (library) => {
      const collection = library.collections.find((item) => item.id === collectionId);
      if (!collection) throw new Error('找不到该收藏夹。');
      const existing = new Set(collection.wallpaperIds);
      wallpaperIds.forEach((id) => existing.add(id));
      collection.wallpaperIds = [...existing];
    });
  });

  ipcMain.handle('library:open-folder', async (_event, folderPath) => shell.openPath(folderPath));
  createWindow();
  setupAutoUpdater();
  if (app.isPackaged && !isPortableBuild()) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
