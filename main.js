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
const FALLBACK_UPDATE_URL = 'https://gitee.com/SNP-LDN/wallpaper_box/raw/master/latest.json';
const STEAM_WORKSHOP_URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=';
const STEAM_CHECK_DELAY_MS = 10000;
const STEAM_CHECK_MIN_DELAY_MS = 10000;
const STEAM_CHECK_MAX_DELAY_MS = 120000;
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
    collections: getGlobalCollections(settings)
  };
}

function normalizeLibraryRoots(settings) {
  const roots = Array.isArray(settings.libraryRoots) ? settings.libraryRoots : [];
  if (settings.libraryRoot) roots.unshift(settings.libraryRoot);
  return [...new Set(roots.filter(Boolean))];
}

function wallpaperKey(rootPath, folderName) {
  return `${rootPath}::${folderName}`;
}

function steamStatusKey(rootPath, folderName) {
  return wallpaperKey(rootPath, folderName);
}

function normalizeSteamStatusCache(settings) {
  return settings.steamStatusByWallpaper || {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWorkshopIdFromFolder(folderPath) {
  const folderName = path.basename(folderPath || '');
  return /^\d+$/.test(folderName) ? folderName : null;
}

function classifySteamWorkshopPage(html) {
  const content = String(html || '').toLowerCase();
  if (content.includes('you must be logged in to view this item')) {
    return 'login-required';
  }
  if (content.includes('too many requests') || content.includes('you\'ve made too many requests recently')) {
    return 'rate-limited';
  }
  if (
    content.includes('there was a problem accessing the item') ||
    content.includes('an error was encountered while processing your request') ||
    content.includes('this item is either marked as hidden') ||
    content.includes('the item is either marked as hidden')
  ) {
    return 'unavailable';
  }
  if (
    content.includes('subscribeitembtn') ||
    content.includes('workshopitemtitle') ||
    content.includes('workshop item')
  ) {
    return 'available';
  }
  return 'unknown';
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractWorkshopTitle(html) {
  const match = String(html || '').match(/<div[^>]*class=["'][^"']*\bworkshopItemTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!match) return null;
  const title = decodeHtmlEntities(match[1].replace(/<[^>]*>/g, '')).trim();
  return title || null;
}

async function checkSteamWorkshopItem(itemId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const url = `${STEAM_WORKSHOP_URL}${itemId}&l=english`;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': `WallpaperBox/${app.getVersion()} (+local availability check)`
      }
    });
    const html = await response.text();
    const pageStatus = classifySteamWorkshopPage(html);
    const officialTitle = extractWorkshopTitle(html);
    const base = { itemId, url, officialTitle };
    if (response.status === 429 || pageStatus === 'rate-limited') {
      return { ...base, status: 'rate-limited', message: 'Working...' };
    }
    if (!response.ok && pageStatus !== 'unavailable') {
      return { ...base, status: 'error', message: `Steam returned HTTP ${response.status}` };
    }
    if (pageStatus === 'available') {
      return { ...base, status: 'available', message: 'Working...' };
    }
    if (pageStatus === 'unavailable') {
      return { ...base, status: 'unavailable', message: 'Working...' };
    }
    if (pageStatus === 'login-required') {
      return { ...base, status: 'login-required', message: 'Working...' };
    }
    return { ...base, status: 'unknown', message: 'Working...' };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return { itemId, url, status: 'error', message: aborted ? 'Request timed out.' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function getGlobalCollections(settings) {
  if (Array.isArray(settings.collections)) return settings.collections;
  const legacyCollectionsByRoot = settings.collectionsByRoot || {};
  const merged = [];
  Object.entries(legacyCollectionsByRoot).forEach(([rootPath, collections]) => {
    (collections || []).forEach((collection) => {
      const existing = merged.find((item) => item.name === collection.name);
      const wallpaperIds = (collection.wallpaperIds || []).map((id) => id.includes('::') ? id : wallpaperKey(rootPath, id));
      if (existing) {
        existing.wallpaperIds = [...new Set([...(existing.wallpaperIds || []), ...wallpaperIds])];
        existing.blurPreviews = existing.blurPreviews || Boolean(collection.blurPreviews);
      } else {
        merged.push({
          id: collection.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: collection.name,
          wallpaperIds,
          blurPreviews: Boolean(collection.blurPreviews)
        });
      }
    });
  });
  return merged;
}

async function updateLibraryData(rootPath, updater) {
  const settings = await getSettings();
  const data = getLibraryData(settings, rootPath);
  updater(data);
  settings.favoritesByRoot = { ...(settings.favoritesByRoot || {}), [rootPath]: data.favorites };
  await saveSettings(settings);
  return data;
}

async function updateCollections(updater) {
  const settings = await getSettings();
  const collections = getGlobalCollections(settings);
  updater(collections);
  settings.collections = collections;
  await saveSettings(settings);
  return { collections };
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
      id: wallpaperKey(rootPath, folder.name),
      name: displayNames[folder.name] || folder.name,
      originalName: folder.name,
      rootPath,
      rootName: path.basename(rootPath) || rootPath,
      favorite: Boolean(favorites[folder.name]),
      collectionIds: collections.filter((collection) => collection.wallpaperIds.includes(wallpaperKey(rootPath, folder.name))).map((collection) => collection.id),
      folderPath,
      previewPath,
      previewType: path.extname(preview.name).toLowerCase(),
      modifiedAt: stat.mtimeMs,
      size: await getFolderSize(folderPath)
    };
  }));
  return wallpapers.filter(Boolean);
}

async function scanLibraries(rootPaths) {
  const roots = Array.isArray(rootPaths) ? rootPaths.filter(Boolean) : [rootPaths].filter(Boolean);
  const groups = await Promise.all(roots.map(async (rootPath) => {
    try {
      return await scanLibrary(rootPath);
    } catch {
      return [];
    }
  }));
  return groups.flat();
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
    title: 'Choose folder',
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

function compareVersions(a, b) {
  const left = String(a || '').replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
  const right = String(b || '').replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

async function showDownloadLinksDialog({ title, message, detail, type = 'info' }) {
  const result = await dialog.showMessageBox(mainWindow, {
    type,
    title,
    message,
    detail,
    buttons: ['GitHub', 'Baidu', 'Quark', 'Close'],
    defaultId: 0,
    cancelId: 3
  });
  if (result.response === 0) shell.openExternal(DOWNLOAD_LINKS.github);
  else if (result.response === 1) shell.openExternal(DOWNLOAD_LINKS.baidu);
  else if (result.response === 2) shell.openExternal(DOWNLOAD_LINKS.quark);
}

async function checkFallbackUpdate({ silent = false, notifyAvailable = false } = {}) {
  try {
    const response = await fetch(`${FALLBACK_UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const update = await response.json();
    const latestVersion = update.version;
    if (latestVersion && compareVersions(latestVersion, app.getVersion()) > 0) {
      const status = { state: 'available', version: latestVersion, message: `New version v${latestVersion} is available.` };
      sendUpdateStatus(status);
      if (!silent || notifyAvailable) {
        await showDownloadLinksDialog({ title: 'Update available', message: status.message, detail: update.notes || 'Choose a download source.' });
      }
      return status;
    }
    const status = { state: 'not-available', message: 'Working...' };
    sendUpdateStatus(status);
    if (!silent) dialog.showMessageBox(mainWindow, { type: 'info', title: 'Choose folder', message: status.message });
    return status;
  } catch (error) {
    const status = { state: 'error', message: 'Working...' };
    sendUpdateStatus(status);
    if (!silent) await showDownloadLinksDialog({ type: 'error', title: 'Choose folder', message: status.message, detail: error.message });
    return status;
  }
}

function setupAutoUpdater() {
  if (isPortableBuild()) {
    sendUpdateStatus({ state: 'portable', message: 'Working...' });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ state: 'checking', message: 'Working...' });
  });

  autoUpdater.on('update-available', async (info) => {
    sendUpdateStatus({ state: 'available', version: info.version, message: `New version v${info.version} is available.` });
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Choose folder',
      message: `New version v${info.version} is available.`,
      detail: 'You can download it in app or use a manual download link.',
      buttons: ['Download', 'GitHub', 'Baidu', 'Quark', 'Later'],
      defaultId: 0,
      cancelId: 4
    });
    if (result.response === 0) {
      sendUpdateStatus({ state: 'downloading', version: info.version, message: 'Working...' });
      autoUpdater.downloadUpdate();
    } else if (result.response === 1) shell.openExternal(DOWNLOAD_LINKS.github);
    else if (result.response === 2) shell.openExternal(DOWNLOAD_LINKS.baidu);
    else if (result.response === 3) shell.openExternal(DOWNLOAD_LINKS.quark);
  });

  autoUpdater.on('update-not-available', () => {
    const status = { state: 'not-available', message: 'Working...' };
    sendUpdateStatus(status);
    if (manualUpdateCheck) dialog.showMessageBox(mainWindow, { type: 'info', title: 'Choose folder', message: status.message });
    manualUpdateCheck = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({ state: 'downloading', percent: progress.percent, message: `Downloading update... ${Math.round(progress.percent)}%` });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    updateReadyToInstall = true;
    sendUpdateStatus({ state: 'downloaded', version: info.version, message: 'Working...' });
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Choose folder',
      message: `v${info.version} has been downloaded.`,
      detail: 'Restart now and install the update?',
      buttons: ['Restart and install', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on('error', async (error) => {
    manualUpdateCheck = false;
    sendUpdateStatus({ state: 'error', message: `Update check failed: ${error.message}` });
    await showDownloadLinksDialog({ type: 'error', title: 'Choose folder', message: 'Working...', detail: error.message });
  });
}

function scheduleStartupUpdateCheck() {
  setTimeout(() => {
    if (!app.isPackaged) {
      sendUpdateStatus({ state: 'dev', message: 'Update checks are disabled in development mode.' });
      return;
    }
    if (isPortableBuild()) {
      checkFallbackUpdate({ silent: true, notifyAvailable: true });
      return;
    }
    autoUpdater.checkForUpdates().catch(() => checkFallbackUpdate({ silent: true, notifyAvailable: true }));
  }, 3000);
}

app.whenReady().then(() => {
  ipcMain.handle('library:get-root', async () => normalizeLibraryRoots(await getSettings()));

  ipcMain.handle('library:choose-root', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose folder',
      properties: ['openDirectory', 'createDirectory', 'multiSelections']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const settings = await getSettings();
    const libraryRoots = [...new Set([...normalizeLibraryRoots(settings), ...result.filePaths])];
    await saveSettings({ ...settings, libraryRoot: libraryRoots[0] || null, libraryRoots });
    return libraryRoots;
  });

  ipcMain.handle('library:scan', async (_event, rootPath) => {
    if (!rootPath) return [];
    return Array.isArray(rootPath) ? scanLibraries(rootPath) : scanLibrary(rootPath);
  });

  ipcMain.handle('library:get-steam-status-cache', async () => normalizeSteamStatusCache(await getSettings()));

  ipcMain.handle('library:save-steam-status-cache', async (_event, statusCache) => {
    const settings = await getSettings();
    settings.steamStatusByWallpaper = statusCache && typeof statusCache === 'object' ? statusCache : {};
    await saveSettings(settings);
    return settings.steamStatusByWallpaper;
  });

  ipcMain.handle('library:check-steam-status', async (event, { items, delayMs } = {}) => {
    const targets = Array.isArray(items) ? items : [];
    const crawlDelay = Math.max(STEAM_CHECK_MIN_DELAY_MS, Math.min(Number(delayMs) || STEAM_CHECK_DELAY_MS, STEAM_CHECK_MAX_DELAY_MS));
    const results = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index] || {};
      const { rootPath, folderPath } = target;
      let result;
      if (!rootPath || !folderPath || !isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
        result = { folderPath, status: 'error', message: 'Working...' };
      } else {
        const itemId = getWorkshopIdFromFolder(folderPath);
        if (!itemId) {
          result = { folderPath, status: 'skipped', message: 'Working...' };
        } else {
          result = { folderPath, ...(await checkSteamWorkshopItem(itemId)) };
        }
      }
      results.push(result);
      event.sender.send('library:steam-check-progress', {
        checked: index + 1,
        total: targets.length,
        result
      });
      if (index < targets.length - 1) await sleep(crawlDelay);
    }
    const settings = await getSettings();
    const statusCache = normalizeSteamStatusCache(settings);
    results.forEach((result) => {
      const matched = targets.find((target) => target.folderPath === result.folderPath);
      if (!matched?.rootPath || !result.folderPath) return;
      statusCache[steamStatusKey(matched.rootPath, path.basename(result.folderPath))] = {
        ...result,
        rootPath: matched.rootPath,
        folderName: path.basename(result.folderPath),
        checkedAt: Date.now()
      };
    });
    settings.steamStatusByWallpaper = statusCache;
    await saveSettings(settings);
    return results;
  });

  ipcMain.handle('library:rename', async (_event, { rootPath, folderPath, newName }) => {
    const cleanName = String(newName || '').trim();
    if (!cleanName || cleanName.length > 100) {
      throw new Error('Invalid operation.');
    }
    if (!isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
      throw new Error('Invalid operation.');
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
      throw new Error('Invalid operation.');
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
    });
    await updateCollections((collections) => {
      const removedId = wallpaperKey(rootPath, path.basename(folderPath));
      collections.forEach((collection) => {
        collection.wallpaperIds = collection.wallpaperIds.filter((id) => id !== removedId);
      });
    });
  });

  ipcMain.handle('library:move-many', async (_event, { rootPath, folderPaths }) => {
    const pathsToMove = Array.isArray(folderPaths) ? [...new Set(folderPaths)] : [];
    if (!rootPath || !pathsToMove.length) return { moved: 0 };
    for (const folderPath of pathsToMove) {
      if (!isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
        throw new Error('Invalid operation.');
      }
    }
    const result = await dialog.showOpenDialog({
      title: 'Choose folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { moved: 0, canceled: true };
    const destinationRoot = result.filePaths[0];
    if (path.resolve(destinationRoot) === path.resolve(rootPath)) {
      throw new Error('Invalid operation.');
    }
    if (pathsToMove.some((folderPath) => isSameOrInside(folderPath, destinationRoot))) {
      throw new Error('Invalid operation.');
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
      movedNames.forEach((name) => {
        delete data.favorites[name];
      });
    });
    await updateCollections((collections) => {
      const movedIdSet = new Set(movedNames.map((name) => wallpaperKey(rootPath, name)));
      collections.forEach((collection) => {
        collection.wallpaperIds = collection.wallpaperIds.filter((id) => !movedIdSet.has(id));
      });
    });
    return { moved };
  });

  ipcMain.handle('collections:get', async () => ({ collections: getGlobalCollections(await getSettings()) }));

  ipcMain.handle('collections:create', async (_event, { rootPath, name, blurPreviews }) => {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 50) throw new Error('Invalid operation.');
    const data = await updateCollections((collections) => {
      if (collections.some((collection) => collection.name === cleanName)) throw new Error('Invalid operation.');
      collections.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: cleanName, wallpaperIds: [], blurPreviews: Boolean(blurPreviews) });
    });
    return data.collections.at(-1);
  });

  ipcMain.handle('collections:delete', async (_event, { collectionId }) => updateCollections((collections) => {
    const index = collections.findIndex((collection) => collection.id === collectionId);
    if (index >= 0) collections.splice(index, 1);
  }));

  ipcMain.handle('app:get-customization', async () => (await getSettings()).customization || {});
  ipcMain.handle('app:save-customization', async (_event, customization) => {
    const settings = await getSettings();
    settings.customization = customization || {};
    await saveSettings(settings);
  });
  ipcMain.handle('app:choose-media', async (_event, type) => {
    const filters = type === 'font'
      ? [{ name: 'Files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
      : type === 'image'
        ? [{ name: 'Files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
        : [{ name: 'Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }];
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('app:get-user-guide', async () => fs.readFile(path.join(__dirname, 'USER_GUIDE.md'), 'utf8'));

  ipcMain.handle('app:check-update', async (_event, manual = true) => {
    manualUpdateCheck = Boolean(manual);
    if (isPortableBuild()) {
      const status = { state: 'checking', message: 'Working...' };
      sendUpdateStatus(status);
      if (manualUpdateCheck) {
        await checkFallbackUpdate({ silent: false });
      }
      manualUpdateCheck = false;
      return status;
    }
    if (!app.isPackaged) {
      const status = { state: 'dev', message: 'Update checks are disabled in development mode.' };
      sendUpdateStatus(status);
      return status;
    }
    await autoUpdater.checkForUpdates();
    return { state: 'checking', message: 'Working...' };
  });

  ipcMain.handle('app:install-update', async () => {
    if (!updateReadyToInstall) return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

  ipcMain.handle('collections:toggle-favorite', async (_event, { rootPath, folderPath }) => {
    if (!isInsideRoot(rootPath, folderPath)) throw new Error('Invalid operation.');
    const originalName = path.basename(folderPath);
    const data = await updateLibraryData(rootPath, (library) => {
      if (library.favorites[originalName]) delete library.favorites[originalName];
      else library.favorites[originalName] = true;
    });
    return Boolean(data.favorites[originalName]);
  });

  ipcMain.handle('collections:toggle-wallpaper', async (_event, { rootPath, folderPath, collectionId }) => {
    if (!isInsideRoot(rootPath, folderPath)) throw new Error('Invalid operation.');
    const wallpaperId = wallpaperKey(rootPath, path.basename(folderPath));
    return updateCollections((collections) => {
      const collection = collections.find((item) => item.id === collectionId);
      if (!collection) throw new Error('Invalid operation.');
      if (collection.wallpaperIds.includes(wallpaperId)) {
        collection.wallpaperIds = collection.wallpaperIds.filter((id) => id !== wallpaperId);
      } else collection.wallpaperIds.push(wallpaperId);
    });
  });

  ipcMain.handle('collections:add-many', async (_event, { rootPath, folderPaths, collectionId }) => {
    const pathsToAdd = Array.isArray(folderPaths) ? [...new Set(folderPaths)] : [];
    if (!rootPath || !pathsToAdd.length) return getLibraryData(await getSettings(), rootPath);
    const wallpaperIds = pathsToAdd.map((folderPath) => {
      if (!isInsideRoot(rootPath, folderPath) || path.dirname(folderPath) !== rootPath) {
        throw new Error('Invalid operation.');
      }
      return wallpaperKey(rootPath, path.basename(folderPath));
    });
    return updateCollections((collections) => {
      const collection = collections.find((item) => item.id === collectionId);
      if (!collection) throw new Error('Invalid operation.');
      const existing = new Set(collection.wallpaperIds);
      wallpaperIds.forEach((id) => existing.add(id));
      collection.wallpaperIds = [...existing];
    });
  });

  ipcMain.handle('library:open-folder', async (_event, folderPath) => shell.openPath(folderPath));
  createWindow();
  setupAutoUpdater();
  scheduleStartupUpdateCheck();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
