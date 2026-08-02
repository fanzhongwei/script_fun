// ==UserScript==
// @name         页面图片导出器
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.2.1
// @description  发现页面 img 与 CSS 背景图，按模块分类展示，复选后批量下载到指定子文件夹，支持鼠标划选
// @author       script_fun
// @match        *://*/*
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROOT_ID = 'pie-root';
  const FAB_POS_KEY = 'pie_fab_pos';
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-lazyload'];
  const MODULE_SELECTORS = 'section, article, main, header, footer, nav, aside, figure, form, [role="region"]';
  const INVALID_PATH_CHARS = /[\\/:*?"<>|]/g;
  const URL_IN_CSS = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  const GRADIENT_PREFIX = /^(linear|radial|conic|repeating-linear|repeating-radial)-gradient/i;
  const PAINT_THRESHOLD = 4;

  /** @type {{ url: string, selected: boolean, moduleKey: string, moduleLabel: string, order: number }[]} */
  let images = [];
  let suppressCardClick = false;

  function sanitizePathPart(name, fallback) {
    const cleaned = String(name || '')
      .replace(INVALID_PATH_CHARS, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || fallback;
  }

  function defaultFolderName() {
    return sanitizePathPart(document.title, 'page_images');
  }

  function toAbsoluteUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || value === 'none' || value.startsWith('about:')) return null;
    if (GRADIENT_PREFIX.test(value)) return null;
    try {
      if (value.startsWith('data:')) return value;
      return new URL(value, document.baseURI || location.href).href;
    } catch {
      return null;
    }
  }

  function parseBackgroundUrls(backgroundImage) {
    const urls = [];
    if (!backgroundImage || backgroundImage === 'none') return urls;
    let match;
    URL_IN_CSS.lastIndex = 0;
    while ((match = URL_IN_CSS.exec(backgroundImage)) !== null) {
      const abs = toAbsoluteUrl(match[2]);
      if (abs) urls.push(abs);
    }
    return urls;
  }

  function findModule(el) {
    const matched = el.closest(MODULE_SELECTORS);
    if (matched && !matched.closest(`#${ROOT_ID}`)) return matched;

    let cur = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.id || (typeof cur.className === 'string' && cur.className.trim())) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return document.body;
  }

  function moduleKeyOf(moduleEl) {
    if (moduleEl === document.body) return 'module:body';
    if (moduleEl.id) return `module:id:${moduleEl.id}`;
    const tag = moduleEl.tagName.toLowerCase();
    const cls = typeof moduleEl.className === 'string'
      ? moduleEl.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
    return `module:${tag}:${cls}`;
  }

  function moduleLabelOf(moduleEl) {
    if (moduleEl === document.body) return '页面主体';
    const aria = moduleEl.getAttribute('aria-label');
    if (aria) return sanitizePathPart(aria, '模块');

    const tag = moduleEl.tagName.toLowerCase();
    const idPart = moduleEl.id ? `#${moduleEl.id}` : '';
    const cls = typeof moduleEl.className === 'string'
      ? moduleEl.className.trim().split(/\s+/).filter(Boolean)[0]
      : '';
    const clsPart = cls ? `.${cls}` : '';
    const heading = moduleEl.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading && heading.textContent.trim()) {
      const text = heading.textContent.trim().slice(0, 30);
      return sanitizePathPart(`${tag} · ${text}`, `${tag}${idPart}`);
    }
    return `${tag}${idPart}${clsPart}`.slice(0, 40) || tag;
  }

  function collectImgCandidates(img) {
    const candidates = [];
    if (img.currentSrc) candidates.push(img.currentSrc);
    if (img.src) candidates.push(img.src);
    LAZY_ATTRS.forEach((attr) => {
      const val = img.getAttribute(attr);
      if (val) candidates.push(val);
    });
    if (img.srcset) {
      img.srcset.split(',').forEach((part) => {
        const url = part.trim().split(/\s+/)[0];
        if (url) candidates.push(url);
      });
    }
    return candidates;
  }

  function discoverImages() {
    const seen = new Set();
    const entries = [];
    let order = 0;

    const addEntry = (url, el) => {
      const abs = toAbsoluteUrl(url);
      if (!abs || seen.has(abs)) return;
      seen.add(abs);
      const moduleEl = findModule(el);
      entries.push({
        url: abs,
        selected: false,
        moduleKey: moduleKeyOf(moduleEl),
        moduleLabel: moduleLabelOf(moduleEl),
        order: order++,
      });
    };

    const elements = document.querySelectorAll('body *');
    elements.forEach((el) => {
      if (el.closest(`#${ROOT_ID}`)) return;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;

      if (tag === 'IMG') {
        collectImgCandidates(el).forEach((raw) => addEntry(raw, el));
        return;
      }

      parseBackgroundUrls(el.style && el.style.backgroundImage).forEach((u) => addEntry(u, el));
      const computed = getComputedStyle(el).backgroundImage;
      parseBackgroundUrls(computed).forEach((u) => addEntry(u, el));
    });

    return entries;
  }

  function groupImagesByModule(list) {
    const groups = [];
    const map = new Map();
    list.forEach((item) => {
      if (!map.has(item.moduleKey)) {
        const group = { label: item.moduleLabel, items: [] };
        map.set(item.moduleKey, group);
        groups.push(group);
      }
      map.get(item.moduleKey).items.push(item);
    });
    return groups;
  }

  function getSelectionOrderMap() {
    const selected = images.filter((item) => item.selected);
    const map = new Map();
    selected.forEach((item, index) => {
      map.set(item, index + 1);
    });
    return map;
  }

  function findItemByUrl(url) {
    return images.find((item) => item.url === url) || null;
  }

  function syncCardSelectionState(card, item) {
    card.classList.toggle('selected', item.selected);
    const checkbox = card.querySelector('input[type=checkbox]');
    if (checkbox) checkbox.checked = item.selected;
  }

  function updateSelectionBadges(container) {
    if (!container) return;
    const orderMap = getSelectionOrderMap();
    container.querySelectorAll('.pie-item').forEach((card) => {
      const url = card.getAttribute('data-pie-url');
      if (!url) return;
      const item = findItemByUrl(url);
      if (!item) return;
      let badge = card.querySelector('.pie-order-badge');
      const order = orderMap.get(item);
      if (item.selected && order) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'pie-order-badge';
          card.appendChild(badge);
        }
        badge.textContent = String(order);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function toggleCardAtPoint(clientX, clientY, visitedUrls, sectionGrid, grid) {
    const el = document.elementFromPoint(clientX, clientY);
    const card = el && el.closest ? el.closest('.pie-item') : null;
    if (!card || !sectionGrid.contains(card)) return;
    const url = card.getAttribute('data-pie-url');
    if (!url || visitedUrls.has(url)) return;
    visitedUrls.add(url);
    const item = findItemByUrl(url);
    if (!item) return;
    item.selected = !item.selected;
    syncCardSelectionState(card, item);
    updateSelectionBadges(grid);
  }

  function makePaintSelection(grid) {
    let startX = 0;
    let startY = 0;
    let painting = false;
    let visitedUrls = new Set();
    let active = false;
    let startSectionGrid = null;

    const cleanup = () => {
      active = false;
      painting = false;
      visitedUrls = new Set();
      if (startSectionGrid) {
        startSectionGrid.classList.remove('painting');
        startSectionGrid = null;
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('selectstart', onSelectStart);
    };

    const onSelectStart = (e) => {
      if (painting) e.preventDefault();
    };

    const onMove = (e) => {
      if (!active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!painting && (Math.abs(dx) > PAINT_THRESHOLD || Math.abs(dy) > PAINT_THRESHOLD)) {
        painting = true;
        if (startSectionGrid) startSectionGrid.classList.add('painting');
      }
      if (painting) {
        e.preventDefault();
        toggleCardAtPoint(e.clientX, e.clientY, visitedUrls, startSectionGrid, grid);
      }
    };

    const onEnd = () => {
      if (painting) suppressCardClick = true;
      cleanup();
    };

    grid.addEventListener('dragstart', (e) => {
      e.preventDefault();
    }, true);

    grid.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON') return;
      const card = e.target.closest('.pie-item');
      if (!card) return;
      const sectionGrid = card.closest('.pie-section-grid');
      if (!sectionGrid) return;
      e.preventDefault();
      active = true;
      painting = false;
      visitedUrls = new Set();
      startSectionGrid = sectionGrid;
      startX = e.clientX;
      startY = e.clientY;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('selectstart', onSelectStart);
    });
  }

  function guessExtension(url) {
    if (url.startsWith('data:')) {
      const m = url.match(/^data:image\/([a-zA-Z0-9+.-]+)/);
      return m ? `.${m[1].replace('jpeg', 'jpg')}` : '.jpg';
    }
    try {
      const pathname = new URL(url).pathname;
      const base = pathname.split('/').pop() || '';
      const dot = base.lastIndexOf('.');
      if (dot > 0 && dot < base.length - 1) {
        const ext = base.slice(dot).split('?')[0];
        if (/^\.[a-zA-Z0-9]{1,8}$/.test(ext)) return ext;
      }
    } catch {
      /* ignore */
    }
    return '.jpg';
  }

  function buildOrderedFilenames(selected) {
    return selected.map((item, index) => ({
      url: item.url,
      filename: `${index + 1}${guessExtension(item.url)}`,
    }));
  }

  function injectStyles() {
    let style = document.getElementById('pie-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pie-styles';
      document.documentElement.appendChild(style);
    }
    style.textContent = `
      #${ROOT_ID} * { box-sizing: border-box; }
      #${ROOT_ID} .pie-fab {
        position: fixed; right: 16px; bottom: 16px; left: auto; top: auto;
        z-index: 2147483646; padding: 10px 14px; border: none; border-radius: 8px;
        background: #2563eb; color: #fff; font-size: 14px; cursor: grab;
        box-shadow: 0 4px 12px rgba(0,0,0,.2); user-select: none; touch-action: none;
      }
      #${ROOT_ID} .pie-fab:hover { background: #1d4ed8; }
      #${ROOT_ID} .pie-fab.dragging { cursor: grabbing; opacity: .92; }
      #${ROOT_ID} .pie-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center;
      }
      #${ROOT_ID} .pie-panel {
        width: min(960px, 92vw); max-height: 88vh; background: #fff; border-radius: 12px;
        display: flex; flex-direction: column; overflow: hidden;
        box-shadow: 0 12px 40px rgba(0,0,0,.25);
      }
      #${ROOT_ID} .pie-header {
        padding: 14px 16px; border-bottom: 1px solid #e5e7eb;
        display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      }
      #${ROOT_ID} .pie-header h2 { margin: 0; font-size: 16px; flex: 1 1 auto; }
      #${ROOT_ID} .pie-header input[type=text] {
        flex: 1 1 220px; min-width: 180px; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px;
      }
      #${ROOT_ID} .pie-header button {
        padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb; cursor: pointer;
      }
      #${ROOT_ID} .pie-header button.pie-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
      #${ROOT_ID} .pie-status { padding: 0 16px 8px; color: #6b7280; font-size: 13px; }
      #${ROOT_ID} .pie-grid {
        padding: 12px 16px 16px; overflow: auto;
      }
      #${ROOT_ID} .pie-section-grid.painting { user-select: none; }
      #${ROOT_ID} .pie-section-grid.painting .pie-item { cursor: crosshair; }
      #${ROOT_ID} .pie-section { margin-bottom: 16px; }
      #${ROOT_ID} .pie-section-header {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        margin: 0 0 10px; padding: 6px 10px; background: #f3f4f6; border-radius: 6px;
        border-left: 3px solid #2563eb;
      }
      #${ROOT_ID} .pie-section-title {
        margin: 0; font-size: 14px; font-weight: 600; color: #374151; flex: 1 1 auto;
      }
      #${ROOT_ID} .pie-section-actions { display: flex; gap: 6px; flex-shrink: 0; }
      #${ROOT_ID} .pie-section-actions button {
        padding: 4px 10px; border: 1px solid #d1d5db; border-radius: 6px;
        background: #fff; cursor: pointer; font-size: 12px;
      }
      #${ROOT_ID} .pie-section-actions button:hover { background: #f9fafb; }
      #${ROOT_ID} .pie-section-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;
      }
      #${ROOT_ID} .pie-item {
        border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden; cursor: pointer;
        position: relative; height: 200px; background: #f3f4f6;
      }
      #${ROOT_ID} .pie-item.selected { border-color: #2563eb; }
      #${ROOT_ID} .pie-item img {
        width: 100%; height: 100%; object-fit: contain; display: block; background: #f3f4f6;
        -webkit-user-drag: none; user-drag: none; pointer-events: none;
      }
      #${ROOT_ID} .pie-item input[type=checkbox] {
        position: absolute; top: 8px; left: 8px; width: 18px; height: 18px; cursor: pointer; z-index: 1;
      }
      #${ROOT_ID} .pie-order-badge {
        position: absolute; top: 8px; right: 8px; min-width: 22px; height: 22px; padding: 0 6px;
        border-radius: 11px; background: #2563eb; color: #fff; font-size: 12px; font-weight: 600;
        display: flex; align-items: center; justify-content: center; z-index: 1;
      }
      #${ROOT_ID} .pie-empty { padding: 24px; text-align: center; color: #6b7280; }
    `;
  }

  function ensureRoot() {
    injectStyles();
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function showToast(message) {
    const status = document.querySelector(`#${ROOT_ID} .pie-status`);
    if (status) status.textContent = message;
  }

  function createImageCard(item, selectionOrder) {
    const card = document.createElement('div');
    card.className = `pie-item${item.selected ? ' selected' : ''}`;
    card.setAttribute('data-pie-url', item.url);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.selected;
    checkbox.addEventListener('click', (e) => e.stopPropagation());

    card.appendChild(checkbox);

    if (item.selected && selectionOrder) {
      const badge = document.createElement('span');
      badge.className = 'pie-order-badge';
      badge.textContent = String(selectionOrder);
      card.appendChild(badge);
    }

    const img = document.createElement('img');
    img.alt = 'preview';
    img.loading = 'lazy';
    img.draggable = false;
    img.src = item.url;
    img.addEventListener('dragstart', (e) => e.preventDefault());
    img.addEventListener('error', () => {
      img.style.opacity = '0.35';
    });

    card.appendChild(img);

    const refresh = () => {
      renderGrid(document.querySelector(`#${ROOT_ID} .pie-grid`));
    };

    checkbox.addEventListener('change', () => {
      item.selected = checkbox.checked;
      refresh();
    });

    card.addEventListener('click', (e) => {
      if (e.target === checkbox) return;
      if (suppressCardClick) {
        suppressCardClick = false;
        e.preventDefault();
        return;
      }
      item.selected = !item.selected;
      refresh();
    });

    return card;
  }

  function renderGrid(container) {
    if (!container) return;
    container.innerHTML = '';
    if (images.length === 0) {
      container.innerHTML = '<div class="pie-empty">未发现可导出的图片</div>';
      return;
    }

    const orderMap = getSelectionOrderMap();
    const groups = groupImagesByModule(images);

    groups.forEach((group) => {
      const section = document.createElement('div');
      section.className = 'pie-section';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'pie-section-header';

      const title = document.createElement('h3');
      title.className = 'pie-section-title';
      title.textContent = `${group.label}（${group.items.length}）`;

      const actions = document.createElement('div');
      actions.className = 'pie-section-actions';

      const sectionSelectAllBtn = document.createElement('button');
      sectionSelectAllBtn.type = 'button';
      sectionSelectAllBtn.textContent = '全选';
      sectionSelectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        group.items.forEach((item) => { item.selected = true; });
        renderGrid(container);
      });

      const sectionDeselectAllBtn = document.createElement('button');
      sectionDeselectAllBtn.type = 'button';
      sectionDeselectAllBtn.textContent = '取消全选';
      sectionDeselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        group.items.forEach((item) => { item.selected = false; });
        renderGrid(container);
      });

      actions.appendChild(sectionSelectAllBtn);
      actions.appendChild(sectionDeselectAllBtn);
      sectionHeader.appendChild(title);
      sectionHeader.appendChild(actions);

      const sectionGrid = document.createElement('div');
      sectionGrid.className = 'pie-section-grid';

      group.items.forEach((item) => {
        sectionGrid.appendChild(createImageCard(item, orderMap.get(item)));
      });

      section.appendChild(sectionHeader);
      section.appendChild(sectionGrid);
      container.appendChild(section);
    });
  }

  function openPanel() {
    const root = ensureRoot();
    root.innerHTML = '';

    images = discoverImages();

    const overlay = document.createElement('div');
    overlay.className = 'pie-overlay';

    const panel = document.createElement('div');
    panel.className = 'pie-panel';

    const header = document.createElement('div');
    header.className = 'pie-header';

    const title = document.createElement('h2');
    title.textContent = `发现 ${images.length} 张图片`;

    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.placeholder = '输入下载文件夹名';
    folderInput.value = defaultFolderName();

    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = '全选';
    selectAllBtn.addEventListener('click', () => {
      images.forEach((item) => { item.selected = true; });
      renderGrid(grid);
    });

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.textContent = '取消全选';
    deselectAllBtn.addEventListener('click', () => {
      images.forEach((item) => { item.selected = false; });
      renderGrid(grid);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'pie-primary';
    downloadBtn.textContent = '下载选中';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.addEventListener('click', () => {
      root.innerHTML = '';
      createFab();
    });

    const status = document.createElement('div');
    status.className = 'pie-status';

    const grid = document.createElement('div');
    grid.className = 'pie-grid';
    renderGrid(grid);
    makePaintSelection(grid);

    downloadBtn.addEventListener('click', () => {
      const folder = sanitizePathPart(folderInput.value.trim(), '');
      if (!folder) {
        showToast('请先填写文件夹名');
        folderInput.focus();
        return;
      }

      const selected = images.filter((item) => item.selected);
      if (selected.length === 0) {
        showToast('请先选择要下载的图片');
        return;
      }

      const files = buildOrderedFilenames(selected);
      let success = 0;
      let fail = 0;
      let pending = files.length;

      showToast(`正在下载 0/${files.length}...`);
      downloadBtn.disabled = true;

      const finishOne = () => {
        pending -= 1;
        if (pending === 0) {
          downloadBtn.disabled = false;
          showToast(`下载完成：成功 ${success} 张，失败 ${fail} 张（文件名：1~${files.length}）`);
        }
      };

      files.forEach((file) => {
        GM_download({
          url: file.url,
          name: `${folder}/${file.filename}`,
          onload: () => {
            success += 1;
            showToast(`正在下载 ${success + fail}/${files.length}...`);
            finishOne();
          },
          onerror: () => {
            fail += 1;
            finishOne();
          },
          ontimeout: () => {
            fail += 1;
            finishOne();
          },
        });
      });
    });

    header.appendChild(title);
    header.appendChild(folderInput);
    header.appendChild(selectAllBtn);
    header.appendChild(deselectAllBtn);
    header.appendChild(downloadBtn);
    header.appendChild(closeBtn);

    panel.appendChild(header);
    panel.appendChild(status);
    panel.appendChild(grid);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  function applyFabPosition(fab) {
    const saved = GM_getValue(FAB_POS_KEY, null);
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      fab.style.left = `${saved.left}px`;
      fab.style.top = `${saved.top}px`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    }
  }

  function saveFabPosition(fab) {
    GM_setValue(FAB_POS_KEY, {
      left: fab.offsetLeft,
      top: fab.offsetTop,
    });
  }

  function makeFabDraggable(fab, onClick) {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragged = false;
    let suppressClick = false;

    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged = true;

      const maxLeft = window.innerWidth - fab.offsetWidth - 4;
      const maxTop = window.innerHeight - fab.offsetHeight - 4;
      const nextLeft = Math.min(Math.max(4, originLeft + dx), maxLeft);
      const nextTop = Math.min(Math.max(4, originTop + dy), maxTop);

      fab.style.left = `${nextLeft}px`;
      fab.style.top = `${nextTop}px`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    };

    const onEnd = () => {
      fab.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      if (dragged) {
        suppressClick = true;
        saveFabPosition(fab);
      }
      dragged = false;
    };

    const onStart = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      dragged = false;
      fab.classList.add('dragging');

      const rect = fab.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      fab.style.left = `${originLeft}px`;
      fab.style.top = `${originTop}px`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';

      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startY = e.touches ? e.touches[0].clientY : e.clientY;

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
      e.preventDefault();
    };

    fab.addEventListener('mousedown', onStart);
    fab.addEventListener('touchstart', onStart, { passive: false });
    fab.addEventListener('click', (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        return;
      }
      onClick();
    });
  }

  function createFab() {
    const root = ensureRoot();
    if (root.querySelector('.pie-fab')) return;

    const fab = document.createElement('button');
    fab.className = 'pie-fab';
    fab.type = 'button';
    fab.textContent = '导出图片';
    fab.title = '导出图片（可拖动）';
    applyFabPosition(fab);
    makeFabDraggable(fab, openPanel);
    root.appendChild(fab);
  }

  createFab();
})();
