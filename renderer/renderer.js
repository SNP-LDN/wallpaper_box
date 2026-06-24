const api = window.wallpaperLibrary;
const elements = {
  path: document.querySelector('#library-path'), count: document.querySelector('#wallpaper-count'),
  grid: document.querySelector('#wallpaper-grid'), empty: document.querySelector('#empty-state'),
  choose: document.querySelector('#choose-folder'), refresh: document.querySelector('#refresh'),
  emptyChoose: document.querySelector('#empty-choose'), dialog: document.querySelector('#rename-dialog'),
  form: document.querySelector('#rename-form'), input: document.querySelector('#rename-input'),
  sortBy: document.querySelector('#sort-by'), collectionFilter: document.querySelector('#collection-filter'),
  newCollection: document.querySelector('#new-collection'), collectionDialog: document.querySelector('#collection-dialog'),
  collectionList: document.querySelector('#collection-list'), collectionWallpaperName: document.querySelector('#collection-wallpaper-name'),
  newCollectionInput: document.querySelector('#new-collection-input'), createFromDialog: document.querySelector('#create-from-dialog'),
  layoutColumns: document.querySelector('#layout-columns'), sideNav: document.querySelector('#side-nav'), sidebarCollections: document.querySelector('#sidebar-collections'),
  manageDialog: document.querySelector('#manage-collections-dialog'), manageList: document.querySelector('#manage-collection-list'), manageInput: document.querySelector('#manage-collection-input'), manageCreate: document.querySelector('#manage-create-collection')
  , manageBlur: document.querySelector('#manage-collection-blur'), applyBlur: document.querySelector('#apply-blur'), search: document.querySelector('#search-wallpapers'), openSettings: document.querySelector('#open-settings'), settingsDialog: document.querySelector('#settings-dialog'), background: document.querySelector('#setting-background'), theme: document.querySelector('#setting-theme'), opacity: document.querySelector('#setting-opacity'), fontSize: document.querySelector('#setting-font-size'), chooseBackground: document.querySelector('#choose-background'), backgroundLabel: document.querySelector('#background-label'), chooseBgm: document.querySelector('#choose-bgm'), chooseFont: document.querySelector('#choose-font'), bgmLabel: document.querySelector('#bgm-label'), fontLabel: document.querySelector('#font-label'), stopBgm: document.querySelector('#stop-bgm'), resetSettings: document.querySelector('#reset-settings'), openUserGuide: document.querySelector('#open-user-guide'), userGuideDialog: document.querySelector('#user-guide-dialog'), guideContent: document.querySelector('#guide-content')
};
let rootPath = null;
let pendingWallpaper = null;
let wallpapers = [];
let collections = [];
let collectionWallpaper = null;
let customization = {};
let bgm = new Audio();
let userGuideLoaded = false;

function showMessage(message) { elements.count.textContent = message; }

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index - 1]}`;
}

function renderWallpapers() {
  const sortBy = elements.sortBy.value;
  const filter = elements.collectionFilter.value;
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visible = wallpapers.filter((wallpaper) => {
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
  elements.grid.replaceChildren(...sorted.map((wallpaper) => {
    const hasBlurCollection = collections.some((collection) => collection.blurPreviews && wallpaper.collectionIds.includes(collection.id));
    return createCard(wallpaper, elements.applyBlur.checked && hasBlurCollection);
  }));
  elements.grid.style.gridTemplateColumns = elements.layoutColumns.value === 'auto' ? '' : `repeat(${elements.layoutColumns.value}, minmax(0, 1fr))`;
  elements.empty.hidden = sorted.length > 0;
  elements.grid.hidden = sorted.length === 0;
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
  renderSidebar();
}

function createCard(wallpaper, blurPreviews = false) {
  const card = document.createElement('article');
  card.className = `wallpaper-card ${blurPreviews ? 'preview-blurred' : ''}`;
  const preview = document.createElement('img');
  preview.src = api.toFileUrl(wallpaper.previewPath);
  preview.alt = wallpaper.name;
  preview.loading = 'lazy';
  preview.addEventListener('error', () => { preview.alt = '预览图无法读取'; });
  card.innerHTML = `<button type="button" class="bookmark ${wallpaper.collectionIds.length ? 'is-collected' : ''}" title="收藏夹" aria-label="收藏夹"></button><div class="preview-wrap"><button type="button" class="favorite ${wallpaper.favorite ? 'is-favorite' : ''}" title="喜欢" aria-label="喜欢"><img src="../assets/heart-outline.png" alt="" /></button></div><div class="card-info"><div class="card-name-row"><p class="card-name" title="${escapeHtml(wallpaper.name)}">${escapeHtml(wallpaper.name)}</p><button type="button" class="rename icon-button" title="修改显示名称"><img src="../assets/pencil.png" alt="修改" /></button></div><p class="card-meta">${formatSize(wallpaper.size)}</p><div class="card-actions"><button type="button" class="open">打开</button><button type="button" class="delete">删除</button></div></div>`;
  card.querySelector('.preview-wrap').prepend(preview);
  card.querySelector('.open').onclick = () => api.openFolder(wallpaper.folderPath);
  card.querySelector('.rename').onclick = () => openRename(wallpaper);
  card.querySelector('.delete').onclick = () => removeWallpaper(wallpaper);
  card.querySelector('.favorite').onclick = (event) => toggleFavorite(wallpaper, event.currentTarget);
  card.querySelector('.bookmark').onclick = () => openCollectionDialog(wallpaper);
  return card;
}
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }

async function refresh() {
  if (!rootPath) return chooseFolder();
  const scrollTop = window.scrollY;
  elements.refresh.disabled = true;
  showMessage('正在读取本地壁纸…');
  try {
    [wallpapers, { collections }] = await Promise.all([api.scan(rootPath), api.getCollections(rootPath)]);
    renderCollectionFilter();
    renderWallpapers();
    showMessage(`共找到 ${wallpapers.length} 个本地壁纸`);
  } catch (error) {
    elements.grid.replaceChildren(); elements.grid.hidden = true; elements.empty.hidden = false;
    showMessage(`无法读取该目录：${error.message}`);
  } finally { elements.refresh.disabled = false; }
  requestAnimationFrame(() => window.scrollTo({ top: scrollTop }));
}

async function toggleFavorite(wallpaper, button) {
  const nextFavorite = !wallpaper.favorite;
  button.classList.toggle('is-favorite', nextFavorite);
  button.classList.remove('heart-burst');
  void button.offsetWidth;
  button.classList.add('heart-burst');
  try { await api.toggleFavorite({ rootPath, folderPath: wallpaper.folderPath }); setTimeout(refresh, 320); }
  catch (error) { alert(`无法更新喜欢状态：${error.message}`); }
}

function renderCollectionDialog() {
  elements.collectionWallpaperName.textContent = `将“${collectionWallpaper.name}”加入一个或多个收藏夹。`;
  elements.collectionList.replaceChildren(...collections.map((collection) => {
    const label = document.createElement('label'); label.className = 'collection-option';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = collectionWallpaper.collectionIds.includes(collection.id);
    checkbox.onchange = async () => {
      try { await api.toggleCollection({ rootPath, folderPath: collectionWallpaper.folderPath, collectionId: collection.id }); await refresh(); collectionWallpaper = wallpapers.find((item) => item.folderPath === collectionWallpaper.folderPath); }
      catch (error) { checkbox.checked = !checkbox.checked; alert(`无法更新收藏夹：${error.message}`); }
    };
    label.append(checkbox, document.createTextNode(collection.name)); return label;
  }));
  if (!collections.length) elements.collectionList.textContent = '还没有收藏夹，请在下方新建一个。';
}

function renderManageCollections() {
  elements.manageList.replaceChildren(...collections.map((collection) => {
    const item = document.createElement('div'); item.className = 'collection-option'; item.innerHTML = `<span>${escapeHtml(collection.name)} · ${collection.wallpaperIds.length} 张壁纸${collection.blurPreviews ? ' · 模糊预览' : ''}</span><button type="button" class="delete-collection">删除</button>`; item.querySelector('button').onclick = async () => { if (confirm(`删除收藏夹“${collection.name}”？壁纸文件不会被删除。`)) { await api.deleteCollection({ rootPath, collectionId: collection.id }); await refresh(); renderManageCollections(); } }; return item;
  }));
  if (!collections.length) elements.manageList.textContent = '还没有收藏夹。';
}

function openCollectionDialog(wallpaper) { collectionWallpaper = wallpaper; elements.newCollectionInput.value = ''; renderCollectionDialog(); elements.collectionDialog.showModal(); }
async function createCollection() {
  const name = elements.newCollectionInput.value.trim(); if (!name) return;
  try {
    const collection = await api.createCollection({ rootPath, name });
    collections.push(collection); renderCollectionFilter(); elements.newCollectionInput.value = '';
    if (collectionWallpaper) { await api.toggleCollection({ rootPath, folderPath: collectionWallpaper.folderPath, collectionId: collection.id }); await refresh(); collectionWallpaper = wallpapers.find((item) => item.folderPath === collectionWallpaper.folderPath); renderCollectionDialog(); }
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
  rootPath = selected; elements.path.textContent = selected;
  await refresh();
}
function openRename(wallpaper) { pendingWallpaper = wallpaper; elements.input.value = wallpaper.name; elements.dialog.showModal(); elements.input.select(); }
async function removeWallpaper(wallpaper) {
  if (!confirm(`确定删除“${wallpaper.name}”吗？\n这会永久删除整个本地壁纸文件夹及其中所有文件。`)) return;
  try { await api.remove({ rootPath, folderPath: wallpaper.folderPath }); await refresh(); }
  catch (error) { alert(`删除失败：${error.message}`); }
}
elements.form.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'confirm') return;
  event.preventDefault();
  try { await api.rename({ rootPath, folderPath: pendingWallpaper.folderPath, newName: elements.input.value }); elements.dialog.close(); await refresh(); }
  catch (error) { alert(`保存显示名称失败：${error.message}`); }
});
elements.choose.onclick = chooseFolder; elements.emptyChoose.onclick = chooseFolder; elements.refresh.onclick = refresh;
elements.sortBy.onchange = renderWallpapers;
elements.collectionFilter.onchange = () => { renderWallpapers(); renderSidebar(); };
elements.layoutColumns.onchange = renderWallpapers;
elements.sideNav.onclick = (event) => { const button = event.target.closest('[data-filter]'); if (button) selectFilter(button.dataset.filter); };
elements.newCollection.onclick = () => { renderManageCollections(); elements.manageInput.value = ''; elements.manageDialog.showModal(); };
elements.createFromDialog.onclick = createCollection;
elements.manageCreate.onclick = createManagedCollection;
elements.applyBlur.onchange = renderWallpapers; elements.search.oninput = renderWallpapers;
function applyCustomization() { const c = customization; document.documentElement.style.setProperty('--accent', c.theme || '#b6a8ff'); document.documentElement.style.setProperty('--app-opacity', `${(c.opacity ?? 80) / 100}`); document.documentElement.style.setProperty('--app-font-size', `${c.fontSize || 16}px`); document.documentElement.style.setProperty('--app-background', c.background || '#101114'); document.body.style.backgroundImage = c.backgroundImagePath ? `linear-gradient(rgb(10 10 14 / .42), rgb(10 10 14 / .72)), url("${api.toFileUrl(c.backgroundImagePath)}")` : ''; document.body.style.backgroundSize = 'cover'; document.body.style.backgroundAttachment = 'fixed'; if (c.fontPath) { const style = document.querySelector('#custom-font-style') || Object.assign(document.createElement('style'), { id: 'custom-font-style' }); style.textContent = `@font-face{font-family:UserFont;src:url('${api.toFileUrl(c.fontPath)}')} body{font-family:UserFont,"Microsoft YaHei UI",sans-serif}`; document.head.append(style); } }
async function saveCustomization() { await api.saveCustomization(customization); applyCustomization(); }
elements.openSettings.onclick = async () => { customization = await api.getCustomization(); elements.background.value = customization.background || '#101114'; elements.theme.value = customization.theme || '#b6a8ff'; elements.opacity.value = customization.opacity ?? 80; elements.fontSize.value = customization.fontSize || 16; elements.backgroundLabel.textContent = customization.backgroundImagePath ? '已选择背景图片' : '未选择'; elements.bgmLabel.textContent = customization.bgmPath ? '已选择本地音频' : '未选择'; elements.fontLabel.textContent = customization.fontPath ? '已导入字体' : '未选择'; elements.settingsDialog.showModal(); };
[[elements.background, 'background'], [elements.theme, 'theme'], [elements.opacity, 'opacity'], [elements.fontSize, 'fontSize']].forEach(([input, key]) => input.oninput = () => { customization[key] = key === 'opacity' || key === 'fontSize' ? Number(input.value) : input.value; saveCustomization(); });
elements.chooseBgm.onclick = async () => { const file = await api.chooseMedia('audio'); if (file) { customization.bgmPath = file; bgm.src = api.toFileUrl(file); bgm.loop = true; await bgm.play().catch(() => {}); elements.bgmLabel.textContent = '已选择本地音频'; saveCustomization(); } };
elements.chooseBackground.onclick = async () => { const file = await api.chooseMedia('image'); if (file) { customization.backgroundImagePath = file; elements.backgroundLabel.textContent = '已选择背景图片'; saveCustomization(); } };
elements.chooseFont.onclick = async () => { const file = await api.chooseMedia('font'); if (file) { customization.fontPath = file; elements.fontLabel.textContent = '已导入字体'; saveCustomization(); } };
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
[elements.dialog, elements.collectionDialog, elements.manageDialog, elements.settingsDialog, elements.userGuideDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
});
(async () => { customization = await api.getCustomization(); applyCustomization(); if (customization.bgmPath) { bgm.src = api.toFileUrl(customization.bgmPath); bgm.loop = true; } rootPath = await api.getRoot(); if (rootPath) { elements.path.textContent = rootPath; await refresh(); } else { elements.empty.hidden = false; } await openUserGuide(); })();
