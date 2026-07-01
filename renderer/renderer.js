const api = window.wallpaperLibrary;
const elements = {
  path: document.querySelector('#library-path'), count: document.querySelector('#wallpaper-count'),
  grid: document.querySelector('#wallpaper-grid'), empty: document.querySelector('#empty-state'),
  sourceFilters: document.querySelector('#source-filters'),
  choose: document.querySelector('#choose-folder'), refresh: document.querySelector('#refresh'),
  emptyChoose: document.querySelector('#empty-choose'), dialog: document.querySelector('#rename-dialog'),
  form: document.querySelector('#rename-form'), input: document.querySelector('#rename-input'),
  sortBy: document.querySelector('#sort-by'), collectionFilter: document.querySelector('#collection-filter'),
  newCollection: document.querySelector('#new-collection'), collectionDialog: document.querySelector('#collection-dialog'),
  collectionList: document.querySelector('#collection-list'), collectionWallpaperName: document.querySelector('#collection-wallpaper-name'),
  newCollectionInput: document.querySelector('#new-collection-input'), createFromDialog: document.querySelector('#create-from-dialog'),
  layoutColumns: document.querySelector('#layout-columns'), sideNav: document.querySelector('#side-nav'), sidebarCollections: document.querySelector('#sidebar-collections'),
  manageDialog: document.querySelector('#manage-collections-dialog'), manageList: document.querySelector('#manage-collection-list'), manageInput: document.querySelector('#manage-collection-input'), manageCreate: document.querySelector('#manage-create-collection'), checkSteamStatus: document.querySelector('#check-steam-status')
  , manageBlur: document.querySelector('#manage-collection-blur'), applyBlur: document.querySelector('#apply-blur'), search: document.querySelector('#search-wallpapers'), openSettings: document.querySelector('#open-settings'), settingsDialog: document.querySelector('#settings-dialog'), background: document.querySelector('#setting-background'), theme: document.querySelector('#setting-theme'), opacity: document.querySelector('#setting-opacity'), fontSize: document.querySelector('#setting-font-size'), chooseBackground: document.querySelector('#choose-background'), backgroundLabel: document.querySelector('#background-label'), chooseBgm: document.querySelector('#choose-bgm'), chooseFont: document.querySelector('#choose-font'), bgmLabel: document.querySelector('#bgm-label'), fontLabel: document.querySelector('#font-label'), stopBgm: document.querySelector('#stop-bgm'), resetSettings: document.querySelector('#reset-settings'), openUserGuide: document.querySelector('#open-user-guide'), userGuideDialog: document.querySelector('#user-guide-dialog'), guideContent: document.querySelector('#guide-content'), checkUpdate: document.querySelector('#check-update'), installUpdate: document.querySelector('#install-update'), updateStatus: document.querySelector('#update-status')
};
let rootPaths = [];
let rootPath = null;
let pendingWallpaper = null;
let wallpapers = [];
let collections = [];
let collectionWallpaper = null;
let customization = {};
let bgm = new Audio();
let userGuideLoaded = false;
const selectedWallpaperIds = new Set();
const selectedSourceRoots = new Set();
const steamStatusByFolder = new Map();
const steamStatusCache = {};
let visibleWallpaperIds = [];
let steamCheckDelaySeconds = 10;
const steamCheckStatuses = [
  ['unchecked', '未检测'],
  ['available', '已检测：没下架'],
  ['unavailable', '已检测：疑似下架'],
  ['login-required', '需要登录'],
  ['rate-limited', '请求过快'],
  ['error', '检测失败'],
  ['skipped', '已跳过'],
  ['unknown', '状态未知']
];
const defaultSteamCheckStatuses = new Set(['unchecked', 'unavailable', 'login-required', 'rate-limited', 'error', 'unknown']);

function createBulkBar() {
  const statusRow = document.querySelector('.status-row');
  const bar = document.createElement('section');
  bar.className = 'bulk-actions';
  bar.hidden = true;
  bar.innerHTML = `
    <div><strong id="bulk-count">已选择 0 个</strong><span>选择多个壁纸后，可以一次添加到收藏夹，或移动到其他文件夹。</span></div>
    <select id="bulk-collection" aria-label="收藏夹"></select>
    <button class="button secondary" type="button" id="select-visible">全选</button>
    <button class="button secondary" type="button" id="clear-selection">取消选择</button>
    <button class="button primary" type="button" id="bulk-add-collection">添加到收藏夹</button>
    <button class="button secondary" type="button" id="bulk-move">移动到文件夹</button>
  `;
  statusRow.after(bar);
  elements.bulkBar = bar;
  elements.bulkCount = bar.querySelector('#bulk-count');
  elements.bulkCollection = bar.querySelector('#bulk-collection');
  elements.selectVisible = bar.querySelector('#select-visible');
  elements.clearSelection = bar.querySelector('#clear-selection');
  elements.bulkAddCollection = bar.querySelector('#bulk-add-collection');
  elements.bulkMove = bar.querySelector('#bulk-move');
}

function createSteamCheckDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'steam-check-dialog';
  dialog.innerHTML = `
    <form method="dialog" id="steam-check-form">
      <h2>选择检测范围</h2>
      <p>只检测你选中的范围。每个 Steam 页面之间会休息 10 秒，减少被限流的概率。</p>
      <div class="steam-check-grid">
        <fieldset>
          <legend>检测哪些壁纸</legend>
          <label><input type="radio" name="steam-scope" value="visible" checked /> 当前列表</label>
          <label><input type="radio" name="steam-scope" value="selected" /> 已选壁纸</label>
          <label><input type="radio" name="steam-scope" value="all" /> 全部本地壁纸</label>
        </fieldset>
        <fieldset>
          <legend>检测哪些文件夹</legend>
          <div id="steam-check-roots" class="steam-check-options"></div>
        </fieldset>
        <fieldset>
          <legend>检测哪些状态</legend>
          <div id="steam-check-statuses" class="steam-check-options"></div>
        </fieldset>
      </div>
      <label class="steam-delay-control">检测间隔
        <input type="number" id="steam-check-delay" min="10" max="120" step="5" value="10" />
        <span>秒 / 个页面</span>
      </label>
      <label class="steam-title-control">
        <input type="checkbox" id="steam-check-rename" />
        <span>检测到没下架时，使用 Steam 官方标题作为软件内显示名</span>
      </label>
      <p class="steam-check-summary" id="steam-check-summary"></p>
      <div class="dialog-actions">
        <button class="button secondary" value="cancel">取消</button>
        <button class="button primary" value="confirm" id="steam-check-start">开始检测</button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  elements.steamCheckDialog = dialog;
  elements.steamCheckForm = dialog.querySelector('#steam-check-form');
  elements.steamCheckRoots = dialog.querySelector('#steam-check-roots');
  elements.steamCheckStatuses = dialog.querySelector('#steam-check-statuses');
  elements.steamCheckDelay = dialog.querySelector('#steam-check-delay');
  elements.steamCheckRename = dialog.querySelector('#steam-check-rename');
  elements.steamCheckSummary = dialog.querySelector('#steam-check-summary');
  elements.steamCheckStart = dialog.querySelector('#steam-check-start');
}

function createSteamProgressDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'steam-progress-dialog';
  dialog.innerHTML = `
    <form method="dialog">
      <h2>正在检测 Steam 状态</h2>
      <p id="steam-progress-text">准备开始...</p>
      <progress id="steam-progress-bar" value="0" max="1"></progress>
      <p class="steam-progress-note">检测过程中会按你选择的间隔休息，请保持软件打开。</p>
    </form>
  `;
  document.body.append(dialog);
  elements.steamProgressDialog = dialog;
  elements.steamProgressText = dialog.querySelector('#steam-progress-text');
  elements.steamProgressBar = dialog.querySelector('#steam-progress-bar');
}

function showMessage(message) { elements.count.textContent = message; }

function folderLabel(folderPath) {
  return String(folderPath || '').split(/[\\/]/).filter(Boolean).at(-1) || folderPath;
}

function persistedSteamStatusKey(wallpaper) {
  return `${wallpaper.rootPath}::${wallpaper.originalName}`;
}

function normalizeDelaySeconds(value) {
  return Math.max(10, Math.min(Number(value) || 10, 120));
}

function rememberSteamStatus(wallpaper, result) {
  if (!wallpaper || !result) return;
  const saved = {
    ...result,
    rootPath: wallpaper.rootPath,
    folderName: wallpaper.originalName,
    checkedAt: Date.now()
  };
  steamStatusByFolder.set(wallpaper.folderPath, saved);
  steamStatusCache[persistedSteamStatusKey(wallpaper)] = saved;
}

async function saveSteamStatusCache() {
  await api.saveSteamStatusCache?.(steamStatusCache);
}

function loadSteamStatusesForWallpapers() {
  steamStatusByFolder.clear();
  wallpapers.forEach((wallpaper) => {
    const status = steamStatusCache[persistedSteamStatusKey(wallpaper)];
    if (status) steamStatusByFolder.set(wallpaper.folderPath, status);
  });
}

function updateSteamProgress(checked, total) {
  if (!elements.steamProgressDialog) return;
  elements.steamProgressBar.max = Math.max(total, 1);
  elements.steamProgressBar.value = Math.min(checked, total);
  elements.steamProgressText.textContent = `正在检测：${checked} / ${total}`;
}

async function applyOfficialTitles(results, byFolder) {
  let renamed = 0;
  for (const result of results) {
    if (result.status !== 'available' || !result.officialTitle || !result.folderPath) continue;
    const wallpaper = byFolder.get(result.folderPath);
    if (!wallpaper || wallpaper.name === result.officialTitle) continue;
    await api.rename({ rootPath: wallpaper.rootPath, folderPath: wallpaper.folderPath, newName: result.officialTitle });
    renamed += 1;
  }
  return renamed;
}

async function loadCollectionsForRoots() {
  const data = await api.getCollections(rootPath);
  return data.collections || [];
}

function normalizeWallpaperCollections(items) {
  return items;
}

function setRootPaths(paths) {
  rootPaths = [...new Set((Array.isArray(paths) ? paths : [paths]).filter(Boolean))];
  rootPath = rootPaths[0] || null;
  [...selectedSourceRoots].forEach((path) => { if (!rootPaths.includes(path)) selectedSourceRoots.delete(path); });
  updatePathLabel();
  renderSourceFilters();
}

function updatePathLabel() {
  if (!rootPaths.length) {
    elements.path.textContent = '尚未选择文件夹';
  } else if (rootPaths.length === 1) {
    elements.path.textContent = rootPaths[0];
  } else {
    elements.path.textContent = `已添加 ${rootPaths.length} 个文件夹：${rootPaths.map(folderLabel).join('、')}`;
  }
}

function renderSourceFilters() {
  if (!elements.sourceFilters) return;
  elements.sourceFilters.hidden = rootPaths.length <= 1;
  elements.sourceFilters.replaceChildren();
  if (rootPaths.length <= 1) return;
  const all = document.createElement('button');
  all.type = 'button';
  all.textContent = '全部文件夹';
  all.classList.toggle('active', selectedSourceRoots.size === 0);
  all.onclick = () => {
    selectedSourceRoots.clear();
    renderSourceFilters();
    renderWallpapers();
  };
  elements.sourceFilters.append(all, ...rootPaths.map((sourcePath) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = folderLabel(sourcePath);
    button.title = sourcePath;
    button.classList.toggle('active', selectedSourceRoots.has(sourcePath));
    button.onclick = () => {
      if (selectedSourceRoots.has(sourcePath)) selectedSourceRoots.delete(sourcePath);
      else selectedSourceRoots.add(sourcePath);
      renderSourceFilters();
      renderWallpapers();
    };
    return button;
  }));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index - 1]}`;
}

function steamStatusText(status) {
  if (!status) return '';
  if (status.status === 'available') return 'Steam 可访问';
  if (status.status === 'unavailable') return '疑似下架';
  if (status.status === 'login-required') return '需要登录';
  if (status.status === 'rate-limited') return '请求过快';
  if (status.status === 'skipped') return '未检测';
  if (status.status === 'error') return '检测失败';
  return '状态未知';
}

function steamStatusTitle(status) {
  if (!status) return '';
  return [status.message, status.url].filter(Boolean).join('\n');
}

function renderWallpapers() {
  const sortBy = elements.sortBy.value;
  const filter = elements.collectionFilter.value;
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visible = wallpapers.filter((wallpaper) => {
    if (selectedSourceRoots.size && !selectedSourceRoots.has(wallpaper.rootPath)) return false;
    if (query && !wallpaper.name.toLocaleLowerCase().includes(query)) return false;
    if (filter === 'favorite') return wallpaper.favorite;
    if (filter.startsWith('collection:')) return wallpaper.collectionIds.includes(filter.slice('collection:'.length));
    return true;
  });
  const sorted = [...visible].sort((a, b) => {
    if (sortBy === 'size') return b.size - a.size;
    if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    return b.modifiedAt - a.modifiedAt;
  });
  visibleWallpaperIds = sorted.map((wallpaper) => wallpaper.id);
  elements.grid.replaceChildren(...sorted.map((wallpaper) => {
    const hasBlurCollection = collections.some((collection) => collection.blurPreviews && wallpaper.collectionIds.includes(collection.id));
    return createCard(wallpaper, elements.applyBlur.checked && hasBlurCollection);
  }));
  elements.grid.style.gridTemplateColumns = elements.layoutColumns.value === 'auto' ? '' : `repeat(${elements.layoutColumns.value}, minmax(0, 1fr))`;
  elements.empty.hidden = sorted.length > 0;
  elements.grid.hidden = sorted.length === 0;
  updateBulkBar();
}

function selectFilter(filter) { elements.collectionFilter.value = filter; renderWallpapers(); renderSidebar(); }
function renderSidebar() {
  const current = elements.collectionFilter.value;
  elements.sideNav.querySelectorAll('[data-filter]').forEach((button) => { button.classList.toggle('active', button.dataset.filter === current); });
  elements.sidebarCollections.replaceChildren(...collections.map((collection) => {
    const button = document.createElement('button'); button.dataset.filter = `collection:${collection.id}`; button.textContent = `${collection.name} (${collection.wallpaperIds.length})`; button.classList.toggle('active', button.dataset.filter === current); button.onclick = () => selectFilter(button.dataset.filter); return button;
  }));
}

function renderCollectionFilter() {
  const previous = elements.collectionFilter.value;
  elements.collectionFilter.replaceChildren(
    new Option('全部壁纸', 'all'),
    new Option('♥ 喜欢', 'favorite'),
    ...collections.map((collection) => new Option(`收藏夹 · ${collection.name}`, `collection:${collection.id}`))
  );
  elements.collectionFilter.value = [...elements.collectionFilter.options].some((option) => option.value === previous) ? previous : 'all';
  if (elements.bulkCollection) {
    elements.bulkCollection.replaceChildren(...collections.map((collection) => new Option(collection.name, collection.id)));
    elements.bulkAddCollection.disabled = selectedWallpaperIds.size === 0 || !collections.length;
  }
  renderSidebar();
}

function createCard(wallpaper, blurPreviews = false) {
  const card = document.createElement('article');
  card.className = `wallpaper-card ${blurPreviews ? 'preview-blurred' : ''}`;
  card.classList.toggle('is-selected', selectedWallpaperIds.has(wallpaper.id));
  const steamStatus = steamStatusByFolder.get(wallpaper.folderPath);
  if (steamStatus?.status) card.classList.add(`steam-${steamStatus.status}`);
  const preview = document.createElement('img');
  preview.src = api.toFileUrl(wallpaper.previewPath);
  preview.alt = wallpaper.name;
  preview.loading = 'lazy';
  preview.addEventListener('error', () => { preview.alt = '预览图无法读取'; });
  card.innerHTML = `<button type="button" class="bookmark ${wallpaper.collectionIds.length ? 'is-collected' : ''}" title="收藏夹" aria-label="收藏夹"></button><div class="preview-wrap"><button type="button" class="favorite ${wallpaper.favorite ? 'is-favorite' : ''}" title="喜欢" aria-label="喜欢"><img src="../assets/heart-outline.png" alt="" /></button></div><div class="card-info"><div class="card-name-row"><p class="card-name" title="${escapeHtml(wallpaper.name)}">${escapeHtml(wallpaper.name)}</p><button type="button" class="rename icon-button" title="修改显示名称"><img src="../assets/pencil.png" alt="修改" /></button></div><p class="card-meta">${formatSize(wallpaper.size)}</p><div class="card-actions"><button type="button" class="open">打开</button><button type="button" class="delete">删除</button></div></div>`;
  const selector = document.createElement('label');
  selector.className = 'select-card';
  selector.title = '选择';
  selector.innerHTML = `<input type="checkbox" ${selectedWallpaperIds.has(wallpaper.id) ? 'checked' : ''} /><span>选择</span>`;
  selector.querySelector('input').onchange = (event) => {
    toggleSelected(wallpaper.id, event.currentTarget.checked);
    card.classList.toggle('is-selected', event.currentTarget.checked);
  };
  card.prepend(selector);
  card.querySelector('.preview-wrap').prepend(preview);
  if (steamStatus) {
    const badge = document.createElement('a');
    badge.className = `steam-status-badge ${steamStatus.status || 'unknown'}`;
    badge.href = steamStatus.url || `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(wallpaper.originalName)}`;
    badge.target = '_blank';
    badge.rel = 'noreferrer';
    badge.textContent = steamStatusText(steamStatus);
    badge.title = steamStatusTitle(steamStatus);
    card.querySelector('.preview-wrap').append(badge);
  }
  card.querySelector('.open').onclick = () => api.openFolder(wallpaper.folderPath);
  card.querySelector('.rename').onclick = () => openRename(wallpaper);
  card.querySelector('.delete').onclick = () => removeWallpaper(wallpaper);
  card.querySelector('.favorite').onclick = (event) => toggleFavorite(wallpaper, event.currentTarget);
  card.querySelector('.bookmark').onclick = () => openCollectionDialog(wallpaper);
  return card;
}
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }

function toggleSelected(wallpaperId, selected) {
  if (selected) selectedWallpaperIds.add(wallpaperId);
  else selectedWallpaperIds.delete(wallpaperId);
  updateBulkBar();
}

function getSelectedWallpapers() {
  const byId = new Map(wallpapers.map((wallpaper) => [wallpaper.id, wallpaper]));
  return [...selectedWallpaperIds].map((id) => byId.get(id)).filter(Boolean);
}

function getVisibleWallpapers() {
  const byId = new Map(wallpapers.map((wallpaper) => [wallpaper.id, wallpaper]));
  return visibleWallpaperIds.map((id) => byId.get(id)).filter(Boolean);
}

function steamStatusKey(wallpaper) {
  return steamStatusByFolder.get(wallpaper.folderPath)?.status || 'unchecked';
}

function getSteamDialogTargets() {
  const scope = elements.steamCheckForm.querySelector('[name="steam-scope"]:checked')?.value || 'visible';
  const rootFilters = new Set([...elements.steamCheckRoots.querySelectorAll('input:checked')].map((input) => input.value));
  const statusFilters = new Set([...elements.steamCheckStatuses.querySelectorAll('input:checked')].map((input) => input.value));
  const base = scope === 'selected' ? getSelectedWallpapers() : scope === 'all' ? wallpapers : getVisibleWallpapers();
  return base.filter((wallpaper) => {
    if (rootFilters.size && !rootFilters.has(wallpaper.rootPath)) return false;
    return statusFilters.has(steamStatusKey(wallpaper));
  });
}

function updateSteamCheckSummary() {
  const targets = getSteamDialogTargets();
  const delaySeconds = normalizeDelaySeconds(elements.steamCheckDelay?.value);
  const seconds = Math.max(0, (targets.length - 1) * delaySeconds);
  elements.steamCheckSummary.textContent = targets.length
    ? `将检测 ${targets.length} 个壁纸，预计至少 ${Math.ceil(seconds)} 秒。`
    : '当前条件下没有需要检测的壁纸。';
  elements.steamCheckStart.disabled = targets.length === 0;
}

function renderSteamCheckDialog() {
  const selectedCount = getSelectedWallpapers().length;
  const selectedScope = elements.steamCheckForm.querySelector('[value="selected"]');
  selectedScope.disabled = selectedCount === 0;
  selectedScope.parentElement.title = selectedCount ? '' : '当前没有已选壁纸';
  elements.steamCheckRoots.replaceChildren(...rootPaths.map((sourcePath) => {
    const label = document.createElement('label');
    const checked = selectedSourceRoots.size === 0 || selectedSourceRoots.has(sourcePath);
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(sourcePath)}" ${checked ? 'checked' : ''} /> <span>${escapeHtml(folderLabel(sourcePath))}</span>`;
    label.title = sourcePath;
    return label;
  }));
  elements.steamCheckStatuses.replaceChildren(...steamCheckStatuses.map(([value, labelText]) => {
    const label = document.createElement('label');
    const count = wallpapers.filter((wallpaper) => steamStatusKey(wallpaper) === value).length;
    label.innerHTML = `<input type="checkbox" value="${value}" ${defaultSteamCheckStatuses.has(value) ? 'checked' : ''} /> <span>${labelText} (${count})</span>`;
    return label;
  }));
  elements.steamCheckDelay.value = steamCheckDelaySeconds;
  updateSteamCheckSummary();
}

function updateBulkBar() {
  if (!elements.bulkBar) return;
  const validIds = new Set(wallpapers.map((wallpaper) => wallpaper.id));
  [...selectedWallpaperIds].forEach((id) => { if (!validIds.has(id)) selectedWallpaperIds.delete(id); });
  const count = selectedWallpaperIds.size;
  const allVisibleSelected = visibleWallpaperIds.length > 0 && visibleWallpaperIds.every((id) => selectedWallpaperIds.has(id));
  elements.bulkBar.hidden = count === 0 && visibleWallpaperIds.length === 0;
  elements.bulkCount.textContent = `已选择 ${count} 个`;
  elements.selectVisible.textContent = allVisibleSelected ? '全不选' : '全选';
  elements.selectVisible.disabled = visibleWallpaperIds.length === 0;
  elements.bulkMove.disabled = count === 0;
  elements.bulkAddCollection.disabled = count === 0 || !collections.length;
}

async function addSelectedToCollection() {
  const selected = getSelectedWallpapers();
  const collectionId = elements.bulkCollection.value;
  if (!selected.length || !collectionId) return;
  try {
    const grouped = Object.entries(selected.reduce((acc, wallpaper) => {
      (acc[wallpaper.rootPath] ||= []).push(wallpaper);
      return acc;
    }, {}));
    for (const [sourcePath, items] of grouped) {
      await api.addManyToCollection({ rootPath: sourcePath, collectionId, folderPaths: items.map((wallpaper) => wallpaper.folderPath) });
    }
    selectedWallpaperIds.clear();
    await refresh();
  } catch (error) {
    alert(`无法添加所选壁纸：${error.message}`);
  }
}

async function moveSelectedWallpapers() {
  const selected = getSelectedWallpapers();
  if (!selected.length) return;
  const grouped = Object.entries(selected.reduce((acc, wallpaper) => {
    (acc[wallpaper.rootPath] ||= []).push(wallpaper);
    return acc;
  }, {}));
  const moveSummary = grouped.length === 1
    ? `确定要移动“${folderLabel(grouped[0][0])}”内的 ${grouped[0][1].length} 个壁纸文件夹吗？`
    : `将移动以下来源的壁纸文件夹：\n\n${grouped.map(([sourcePath, items]) => `- ${folderLabel(sourcePath)}：${items.length} 个`).join('\n')}\n\n确定继续吗？`;
  if (!confirm(moveSummary)) return;
  try {
    let canceled = false;
    for (const [sourcePath, items] of grouped) {
      const result = await api.moveMany({ rootPath: sourcePath, folderPaths: items.map((wallpaper) => wallpaper.folderPath) });
      if (result?.canceled) canceled = true;
    }
    if (!canceled) selectedWallpaperIds.clear();
    await refresh();
  } catch (error) {
    alert(`无法移动所选壁纸：${error.message}`);
  }
}

async function refresh() {
  if (!rootPaths.length) return chooseFolder();
  const scrollTop = window.scrollY;
  elements.refresh.disabled = true;
  showMessage('正在读取本地壁纸…');
  try {
    [wallpapers, collections] = await Promise.all([api.scan(rootPaths), loadCollectionsForRoots()]);
    wallpapers = normalizeWallpaperCollections(wallpapers);
    loadSteamStatusesForWallpapers();
    renderCollectionFilter();
    renderSourceFilters();
    renderWallpapers();
    showMessage(`共找到 ${wallpapers.length} 个本地壁纸`);
  } catch (error) {
    elements.grid.replaceChildren(); elements.grid.hidden = true; elements.empty.hidden = false;
    showMessage(`无法读取该目录：${error.message}`);
  } finally { elements.refresh.disabled = false; }
  requestAnimationFrame(() => window.scrollTo({ top: scrollTop }));
}

async function checkSteamStatuses() {
  const byId = new Map(wallpapers.map((wallpaper) => [wallpaper.id, wallpaper]));
  const selected = getSelectedWallpapers();
  const targets = selected.length
    ? selected
    : visibleWallpaperIds.map((id) => byId.get(id)).filter(Boolean);
  if (!targets.length) return;
  const delaySeconds = 10;
  const scopeText = selected.length ? '已选壁纸' : '当前列表';
  const expectedSeconds = Math.max(0, (targets.length - 1) * delaySeconds);
  if (!confirm(`将检测 ${scopeText}中的 ${targets.length} 个 Steam 页面。\n\n每次请求之间会休息 ${delaySeconds} 秒，预计至少 ${Math.ceil(expectedSeconds)} 秒。是否开始？`)) return;
  const previousLabel = elements.checkSteamStatus.textContent;
  elements.checkSteamStatus.disabled = true;
  elements.refresh.disabled = true;
  const stopProgress = api.onSteamCheckProgress?.((progress) => {
    if (!progress) return;
    if (progress.result?.folderPath) steamStatusByFolder.set(progress.result.folderPath, progress.result);
    showMessage(`正在检测 Steam 状态：${progress.checked} / ${progress.total}`);
    renderWallpapers();
  });
  try {
    showMessage(`正在检测 Steam 状态：0 / ${targets.length}`);
    const results = await api.checkSteamStatus({
      delayMs: delaySeconds * 1000,
      items: targets.map((wallpaper) => ({ rootPath: wallpaper.rootPath, folderPath: wallpaper.folderPath }))
    });
    results.forEach((result) => {
      if (result.folderPath) steamStatusByFolder.set(result.folderPath, result);
    });
    renderWallpapers();
    const unavailable = results.filter((result) => result.status === 'unavailable').length;
    const available = results.filter((result) => result.status === 'available').length;
    const loginRequired = results.filter((result) => result.status === 'login-required').length;
    const rateLimited = results.filter((result) => result.status === 'rate-limited').length;
    const failed = results.filter((result) => result.status === 'error').length;
    showMessage(`Steam 检测完成：可访问 ${available} 个，疑似下架 ${unavailable} 个，需要登录 ${loginRequired} 个，请求过快 ${rateLimited} 个，失败 ${failed} 个`);
  } catch (error) {
    showMessage(`Steam 检测失败：${error.message}`);
  } finally {
    if (stopProgress) stopProgress();
    elements.checkSteamStatus.disabled = false;
    elements.refresh.disabled = false;
    elements.checkSteamStatus.textContent = previousLabel;
  }
}

function openSteamCheckDialog() {
  if (!wallpapers.length) {
    showMessage('没有可检测的壁纸。');
    return;
  }
  renderSteamCheckDialog();
  elements.steamCheckDialog.showModal();
}

async function runSteamCheck(targets, delaySeconds = 10, useOfficialTitles = false) {
  if (!targets.length) return;
  const crawlDelaySeconds = normalizeDelaySeconds(delaySeconds);
  const byFolder = new Map(targets.map((wallpaper) => [wallpaper.folderPath, wallpaper]));
  const previousLabel = elements.checkSteamStatus.textContent;
  elements.checkSteamStatus.disabled = true;
  elements.refresh.disabled = true;
  updateSteamProgress(0, targets.length);
  elements.steamProgressDialog.showModal();
  const stopProgress = api.onSteamCheckProgress?.((progress) => {
    if (!progress) return;
    if (progress.result?.folderPath) {
      rememberSteamStatus(byFolder.get(progress.result.folderPath), progress.result);
      saveSteamStatusCache().catch(() => {});
    }
    showMessage(`正在检测 Steam 状态：${progress.checked} / ${progress.total}`);
    updateSteamProgress(progress.checked, progress.total);
    renderWallpapers();
  });
  try {
    showMessage(`正在检测 Steam 状态：0 / ${targets.length}`);
    const results = await api.checkSteamStatus({
      delayMs: crawlDelaySeconds * 1000,
      items: targets.map((wallpaper) => ({ rootPath: wallpaper.rootPath, folderPath: wallpaper.folderPath }))
    });
    results.forEach((result) => {
      if (result.folderPath) rememberSteamStatus(byFolder.get(result.folderPath), result);
    });
    await saveSteamStatusCache();
    const renamed = useOfficialTitles ? await applyOfficialTitles(results, byFolder) : 0;
    if (renamed) {
      await refresh();
    }
    renderWallpapers();
    const unavailable = results.filter((result) => result.status === 'unavailable').length;
    const available = results.filter((result) => result.status === 'available').length;
    const loginRequired = results.filter((result) => result.status === 'login-required').length;
    const rateLimited = results.filter((result) => result.status === 'rate-limited').length;
    const failed = results.filter((result) => result.status === 'error').length;
    const summary = `Steam 检测完成：可访问 ${available} 个，疑似下架 ${unavailable} 个，需要登录 ${loginRequired} 个，请求过快 ${rateLimited} 个，失败 ${failed} 个，已更新标题 ${renamed} 个`;
    showMessage(summary);
    alert(summary);
  } catch (error) {
    showMessage(`Steam 检测失败：${error.message}`);
    alert(`Steam 检测失败：${error.message}`);
  } finally {
    if (stopProgress) stopProgress();
    elements.steamProgressDialog.close();
    elements.checkSteamStatus.disabled = false;
    elements.refresh.disabled = false;
    elements.checkSteamStatus.textContent = previousLabel;
  }
}

async function toggleFavorite(wallpaper, button) {
  const nextFavorite = !wallpaper.favorite;
  button.classList.toggle('is-favorite', nextFavorite);
  button.classList.remove('heart-burst');
  void button.offsetWidth;
  button.classList.add('heart-burst');
  try { await api.toggleFavorite({ rootPath: wallpaper.rootPath, folderPath: wallpaper.folderPath }); setTimeout(refresh, 320); }
  catch (error) { alert(`无法更新喜欢状态：${error.message}`); }
}

function renderCollectionDialog() {
  elements.collectionWallpaperName.textContent = `将“${collectionWallpaper.name}”加入一个或多个收藏夹。`;
  elements.collectionList.replaceChildren(...collections.map((collection) => {
    const label = document.createElement('label'); label.className = 'collection-option';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = collectionWallpaper.collectionIds.includes(collection.id);
    checkbox.onchange = async () => {
      try { await api.toggleCollection({ rootPath: collectionWallpaper.rootPath, folderPath: collectionWallpaper.folderPath, collectionId: collection.id }); await refresh(); collectionWallpaper = wallpapers.find((item) => item.folderPath === collectionWallpaper.folderPath); }
      catch (error) { checkbox.checked = !checkbox.checked; alert(`无法更新收藏夹：${error.message}`); }
    };
    label.append(checkbox, document.createTextNode(collection.name)); return label;
  }));
  if (!collections.length) elements.collectionList.textContent = '还没有收藏夹，请在下方新建一个。';
}

function renderManageCollections() {
  elements.manageList.replaceChildren(...collections.map((collection) => {
    const item = document.createElement('div'); item.className = 'collection-option'; item.innerHTML = `<span>${escapeHtml(collection.name)} · ${collection.wallpaperIds.length} 张壁纸${collection.blurPreviews ? ' · 模糊预览' : ''}</span><button type="button" class="delete-collection">删除</button>`; item.querySelector('button').onclick = async () => { if (confirm(`删除收藏夹“${collection.name}”？壁纸文件不会被删除。`)) { await api.deleteCollection({ collectionId: collection.id }); await refresh(); renderManageCollections(); } }; return item;
  }));
  if (!collections.length) elements.manageList.textContent = '还没有收藏夹。';
}

function openCollectionDialog(wallpaper) { collectionWallpaper = wallpaper; elements.newCollectionInput.value = ''; renderCollectionDialog(); elements.collectionDialog.showModal(); }
async function createCollection() {
  const name = elements.newCollectionInput.value.trim(); if (!name) return;
  try {
    const collection = await api.createCollection({ rootPath, name });
    collections.push(collection); renderCollectionFilter(); elements.newCollectionInput.value = '';
    if (collectionWallpaper) { await api.toggleCollection({ rootPath: collectionWallpaper.rootPath, folderPath: collectionWallpaper.folderPath, collectionId: collection.id }); await refresh(); collectionWallpaper = wallpapers.find((item) => item.folderPath === collectionWallpaper.folderPath); renderCollectionDialog(); }
  } catch (error) { alert(`无法新建收藏夹：${error.message}`); }
}
async function createManagedCollection() {
  const name = elements.manageInput.value.trim(); if (!name) return;
  try { await api.createCollection({ rootPath, name, blurPreviews: elements.manageBlur.checked }); elements.manageInput.value = ''; elements.manageBlur.checked = false; await refresh(); renderManageCollections(); }
  catch (error) { alert(`无法新建收藏夹：${error.message}`); }
}

async function chooseFolder() {
  const selected = await api.chooseRoot();
  if (!selected) return;
  setRootPaths(selected);
  await refresh();
}
function openRename(wallpaper) { pendingWallpaper = wallpaper; elements.input.value = wallpaper.name; elements.dialog.showModal(); elements.input.select(); }
async function removeWallpaper(wallpaper) {
  if (!confirm(`确定删除“${wallpaper.name}”吗？\n这会永久删除整个本地壁纸文件夹及其中所有文件。`)) return;
  try { await api.remove({ rootPath: wallpaper.rootPath, folderPath: wallpaper.folderPath }); await refresh(); }
  catch (error) { alert(`删除失败：${error.message}`); }
}
elements.form.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'confirm') return;
  event.preventDefault();
  try { await api.rename({ rootPath: pendingWallpaper.rootPath, folderPath: pendingWallpaper.folderPath, newName: elements.input.value }); elements.dialog.close(); await refresh(); }
  catch (error) { alert(`保存显示名称失败：${error.message}`); }
});
createBulkBar();
createSteamCheckDialog();
createSteamProgressDialog();
elements.choose.onclick = chooseFolder; elements.emptyChoose.onclick = chooseFolder; elements.refresh.onclick = refresh;
elements.checkSteamStatus.onclick = openSteamCheckDialog;
elements.steamCheckForm.onchange = updateSteamCheckSummary;
elements.steamCheckDelay.oninput = () => {
  steamCheckDelaySeconds = normalizeDelaySeconds(elements.steamCheckDelay.value);
  updateSteamCheckSummary();
};
elements.steamCheckDelay.onblur = () => { elements.steamCheckDelay.value = normalizeDelaySeconds(elements.steamCheckDelay.value); };
elements.steamCheckForm.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'confirm') return;
  event.preventDefault();
  const targets = getSteamDialogTargets();
  steamCheckDelaySeconds = normalizeDelaySeconds(elements.steamCheckDelay.value);
  const useOfficialTitles = elements.steamCheckRename.checked;
  elements.steamCheckDelay.value = steamCheckDelaySeconds;
  elements.steamCheckDialog.close();
  await runSteamCheck(targets, steamCheckDelaySeconds, useOfficialTitles);
});
elements.sortBy.onchange = renderWallpapers;
elements.collectionFilter.onchange = () => { renderWallpapers(); renderSidebar(); };
elements.layoutColumns.onchange = renderWallpapers;
elements.sideNav.onclick = (event) => { const button = event.target.closest('[data-filter]'); if (button) selectFilter(button.dataset.filter); };
elements.newCollection.onclick = () => { renderManageCollections(); elements.manageInput.value = ''; elements.manageDialog.showModal(); };
elements.createFromDialog.onclick = createCollection;
elements.manageCreate.onclick = createManagedCollection;
elements.applyBlur.onchange = renderWallpapers; elements.search.oninput = renderWallpapers;
elements.selectVisible.onclick = () => {
  const allVisibleSelected = visibleWallpaperIds.length > 0 && visibleWallpaperIds.every((id) => selectedWallpaperIds.has(id));
  visibleWallpaperIds.forEach((id) => {
    if (allVisibleSelected) selectedWallpaperIds.delete(id);
    else selectedWallpaperIds.add(id);
  });
  renderWallpapers();
};
elements.clearSelection.onclick = () => { selectedWallpaperIds.clear(); renderWallpapers(); };
elements.bulkAddCollection.onclick = addSelectedToCollection;
elements.bulkMove.onclick = moveSelectedWallpapers;
function applyCustomization() { const c = customization; document.documentElement.style.setProperty('--accent', c.theme || '#b6a8ff'); document.documentElement.style.setProperty('--app-opacity', `${(c.opacity ?? 80) / 100}`); document.documentElement.style.setProperty('--app-font-size', `${c.fontSize || 16}px`); document.documentElement.style.setProperty('--app-background', c.background || '#101114'); document.body.style.backgroundImage = c.backgroundImagePath ? `linear-gradient(rgb(10 10 14 / .42), rgb(10 10 14 / .72)), url("${api.toFileUrl(c.backgroundImagePath)}")` : ''; document.body.style.backgroundSize = 'cover'; document.body.style.backgroundAttachment = 'fixed'; if (c.fontPath) { const style = document.querySelector('#custom-font-style') || Object.assign(document.createElement('style'), { id: 'custom-font-style' }); style.textContent = `@font-face{font-family:UserFont;src:url('${api.toFileUrl(c.fontPath)}')} body{font-family:UserFont,"Microsoft YaHei UI",sans-serif}`; document.head.append(style); } }
async function saveCustomization() { await api.saveCustomization(customization); applyCustomization(); }
function handleUpdateStatus(status) {
  if (!status) return;
  elements.updateStatus.textContent = status.message || '更新状态已变化';
  elements.checkUpdate.disabled = status.state === 'checking' || status.state === 'downloading';
  elements.installUpdate.hidden = status.state !== 'downloaded';
}
elements.openSettings.onclick = async () => { customization = await api.getCustomization(); elements.background.value = customization.background || '#101114'; elements.theme.value = customization.theme || '#b6a8ff'; elements.opacity.value = customization.opacity ?? 80; elements.fontSize.value = customization.fontSize || 16; elements.backgroundLabel.textContent = customization.backgroundImagePath ? '已选择背景图片' : '未选择'; elements.bgmLabel.textContent = customization.bgmPath ? '已选择本地音频' : '未选择'; elements.fontLabel.textContent = customization.fontPath ? '已导入字体' : '未选择'; elements.settingsDialog.showModal(); };
[[elements.background, 'background'], [elements.theme, 'theme'], [elements.opacity, 'opacity'], [elements.fontSize, 'fontSize']].forEach(([input, key]) => input.oninput = () => { customization[key] = key === 'opacity' || key === 'fontSize' ? Number(input.value) : input.value; saveCustomization(); });
elements.chooseBgm.onclick = async () => { const file = await api.chooseMedia('audio'); if (file) { customization.bgmPath = file; bgm.src = api.toFileUrl(file); bgm.loop = true; await bgm.play().catch(() => {}); elements.bgmLabel.textContent = '已选择本地音频'; saveCustomization(); } };
elements.chooseBackground.onclick = async () => { const file = await api.chooseMedia('image'); if (file) { customization.backgroundImagePath = file; elements.backgroundLabel.textContent = '已选择背景图片'; saveCustomization(); } };
elements.chooseFont.onclick = async () => { const file = await api.chooseMedia('font'); if (file) { customization.fontPath = file; elements.fontLabel.textContent = '已导入字体'; saveCustomization(); } };
elements.checkUpdate.onclick = async () => {
  handleUpdateStatus({ state: 'checking', message: '正在检查更新...' });
  try { handleUpdateStatus(await api.checkUpdate()); }
  catch (error) { handleUpdateStatus({ state: 'error', message: `检查更新失败：${error.message}` }); }
};
elements.installUpdate.onclick = async () => api.installUpdate();
api.onUpdateStatus(handleUpdateStatus);
elements.stopBgm.onclick = () => bgm.pause();
elements.resetSettings.onclick = async () => { customization = {}; bgm.pause(); await saveCustomization(); elements.background.value = '#101114'; elements.theme.value = '#b6a8ff'; elements.opacity.value = 80; elements.fontSize.value = 16; elements.backgroundLabel.textContent = elements.bgmLabel.textContent = elements.fontLabel.textContent = '未选择'; };
function renderInlineMarkdown(text) {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n'); let html = ''; let list = null; let code = false; let codeLines = [];
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    if (line.startsWith('```')) { if (code) { html += `<pre><code>${renderInlineMarkdown(codeLines.join('\n'))}</code></pre>`; codeLines = []; } code = !code; continue; }
    if (code) { codeLines.push(line); continue; }
    if (/^<img\b/i.test(line)) continue;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/); const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) { closeList(); html += `<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`; }
    else if (bullet || numbered) { const tag = numbered ? 'ol' : 'ul'; if (list && list !== tag) closeList(); if (!list) { html += `<${tag}>`; list = tag; } html += `<li>${renderInlineMarkdown((bullet || numbered)[1])}</li>`; }
    else if (!line.trim()) closeList();
    else { closeList(); html += `<p>${renderInlineMarkdown(line)}</p>`; }
  }
  closeList(); return html;
}
async function openUserGuide() { if (!userGuideLoaded) { elements.guideContent.innerHTML = markdownToHtml(await api.getUserGuide()); userGuideLoaded = true; } elements.userGuideDialog.showModal(); }
elements.openUserGuide.onclick = openUserGuide;
[elements.dialog, elements.collectionDialog, elements.manageDialog, elements.settingsDialog, elements.userGuideDialog, elements.steamCheckDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
});
(async () => {
  customization = await api.getCustomization();
  Object.assign(steamStatusCache, await api.getSteamStatusCache?.() || {});
  applyCustomization();
  if (customization.bgmPath) { bgm.src = api.toFileUrl(customization.bgmPath); bgm.loop = true; }
  setRootPaths(await api.getRoot());
  if (rootPaths.length) { await refresh(); } else { elements.empty.hidden = false; }
  await openUserGuide();
})();
