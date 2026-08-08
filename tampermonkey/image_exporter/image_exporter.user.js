// ==UserScript==
// @name         页面图片导出器
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.4.0
// @description  拼多多商品页按轮播图/详情图/预览图分类导出，其它站点通用扫描
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

  /** @type {{ id: string, url: string, selected: boolean, moduleKey: string, moduleLabel: string, order: number }[]} */
  let images = [];
  let suppressCardClick = false;
  /** @type {HTMLInputElement | null} */
  let panelFolderInput = null;
  /** @type {(() => void) | null} */
  let panelSyncPresets = null;

  function isPddPresetCategory(moduleKey) {
    return PDD_CATEGORY_ORDER.includes(moduleKey);
  }

  function pddCategoryFolder(label) {
    return sanitizePathPart(label, label);
  }

  function setFolderPreset(name) {
    if (!panelFolderInput) return;
    panelFolderInput.value = name;
    if (panelSyncPresets) panelSyncPresets();
  }

  function sanitizePathPart(name, fallback) {
    const cleaned = String(name || '')
      .replace(INVALID_PATH_CHARS, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || fallback;
  }

  const PREVIEW_CHUNK_SIZE = 12;
  const FOLDER_PRESETS = ['轮播图', '详情图', '预览图'];
  const PDD_CATEGORY_ORDER = ['category:carousel', 'category:detail', 'category:preview'];
  const PDD_CATEGORIES = [
    { key: 'category:carousel', label: '轮播图' },
    { key: 'category:detail', label: '详情图' },
    { key: 'category:preview', label: '预览图' },
  ];

  function isPddMmsPage() {
    return /mms\.pinduoduo\.com/i.test(location.hostname);
  }

  function firstBackgroundUrl(el) {
    const inline = parseBackgroundUrls(el.style && el.style.backgroundImage);
    if (inline.length > 0) return inline[0];
    return parseBackgroundUrls(getComputedStyle(el).backgroundImage)[0] || null;
  }

  function dedupeUrlsOrdered(urls) {
    const seen = new Set();
    const result = [];
    urls.forEach((raw) => {
      const abs = toAbsoluteUrl(raw);
      if (!abs || seen.has(abs)) return;
      seen.add(abs);
      result.push(abs);
    });
    return result;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const PDD_SKU_ROW_SELECTOR = '#sku tbody tr[class*="TB_tr"], #sku [data-testid="beast-core-table-body-tr"]';
  const PDD_SKU_ROW_IN_TABLE = 'tbody tr[class*="TB_tr"], tbody [data-testid="beast-core-table-body-tr"]';

  /**
   * 定位内层滚动容器（不是 TB_innerMiddle）：
   * TB_body > div[max-height/height/overflow-y] > padding > table
   */
  function getPddSkuScrollViewport() {
    const skuRoot = document.querySelector('#sku, #goods-spec-sku');
    if (!skuRoot || skuRoot.closest(`#${ROOT_ID}`)) return null;

    const body = skuRoot.querySelector(
      '[data-testid="beast-core-table-middle-body"], [class*="TB_body"]',
    );
    if (!body || body.closest(`#${ROOT_ID}`)) return null;

    for (const child of Array.from(body.children)) {
      if (!child.querySelector('table[class*="TB_tableWrapper"]')) continue;
      const style = child.getAttribute('style') || '';
      const cs = getComputedStyle(child);
      const looksLikeScroll = /max-height|overflow-y|height\s*:/i.test(style)
        || cs.overflowY === 'scroll'
        || cs.overflowY === 'auto'
        || (cs.maxHeight && cs.maxHeight !== 'none');
      if (looksLikeScroll) return child;
    }

    return Array.from(body.children).find(
      (child) => child.querySelector('table[class*="TB_tableWrapper"]'),
    ) || null;
  }

  function getPddSkuSpacer(viewport) {
    if (!viewport) return null;
    const direct = viewport.querySelector(':scope > div');
    if (direct && direct.querySelector('table[class*="TB_tableWrapper"]')) return direct;
    const table = viewport.querySelector('table[class*="TB_tableWrapper"]');
    return table ? table.parentElement : null;
  }

  function measurePddVirtualContentHeight(viewport) {
    const spacer = getPddSkuSpacer(viewport);
    const table = viewport.querySelector('table[class*="TB_tableWrapper"]') || viewport;
    const rows = table.querySelectorAll(PDD_SKU_ROW_IN_TABLE);
    let rowsH = 0;
    rows.forEach((row) => { rowsH += row.getBoundingClientRect().height || 0; });
    if (rowsH < 1 && rows.length > 0) rowsH = rows.length * 69;
    const pt = spacer ? (parseFloat(spacer.style.paddingTop) || 0) : 0;
    const pb = spacer ? (parseFloat(spacer.style.paddingBottom) || 0) : 0;
    return Math.max(pt + rowsH + pb, viewport.scrollHeight, table.scrollHeight || 0, rowsH);
  }

  /** 导出前：对齐手动改法，把滚动层 max-height/height 设为虚拟总高 */
  async function expandPddSkuTable() {
    const viewport = getPddSkuScrollViewport();
    if (!viewport) return;

    viewport.style.maxHeight = '820px';
    viewport.style.height = '820px';
    viewport.style.overflowY = 'scroll';

    let maxH = 0;
    let lastScrollH = 0;
    let stable = 0;
    for (let i = 0; i < 120; i += 1) {
      viewport.scrollTop = viewport.scrollHeight;
      await sleep(40);
      maxH = Math.max(maxH, measurePddVirtualContentHeight(viewport));
      const scrollH = viewport.scrollHeight;
      if (viewport.scrollTop + viewport.clientHeight >= scrollH - 4 && scrollH === lastScrollH) {
        stable += 1;
        if (stable >= 5) break;
      } else {
        stable = 0;
      }
      lastScrollH = scrollH;
      if (i % 10 === 9) viewport.scrollTop = 0;
    }

    const finalH = Math.ceil(Math.max(maxH, 820) + 40);
    viewport.style.maxHeight = `${finalH}px`;
    viewport.style.height = `${finalH}px`;
    viewport.style.overflowY = 'scroll';

    const spacer = getPddSkuSpacer(viewport);
    if (spacer) {
      spacer.style.paddingTop = '0px';
      spacer.style.paddingBottom = '0px';
    }

    viewport.scrollTop = 0;
    await sleep(120);
    viewport.scrollTop = viewport.scrollHeight;
    await sleep(80);
    maxH = Math.max(maxH, measurePddVirtualContentHeight(viewport));
    if (maxH + 40 > finalH) {
      const bigger = Math.ceil(maxH + 40);
      viewport.style.maxHeight = `${bigger}px`;
      viewport.style.height = `${bigger}px`;
    }
    if (spacer) {
      spacer.style.paddingTop = '0px';
      spacer.style.paddingBottom = '0px';
    }
    viewport.scrollTop = 0;
  }

  /** #goods-spec-sku / #sku 规格预览图：按行顺序采集，不去重 */
  function collectSkuPreviewImages() {
    const urls = [];
    document.querySelectorAll('#goods-spec-sku .sku-preview-cell, #sku .sku-preview-cell').forEach((cell) => {
      if (cell.closest(`#${ROOT_ID}`)) return;
      const preview = cell.querySelector(
        '[data-tracking-click-viewid="el_specification_batch_modification_preview_picture"]',
      );
      if (preview) {
        const abs = firstBackgroundUrl(preview);
        if (abs) {
          urls.push(abs);
          return;
        }
      }
      const img = cell.querySelector('img');
      if (!img) return;
      const candidate = collectImgCandidates(img).map((raw) => toAbsoluteUrl(raw)).find(Boolean);
      if (candidate) urls.push(candidate);
    });
    return urls;
  }

  /** #detail_pic 商详快捷编辑详情图 */
  function collectDetailImages() {
    const root = document.querySelector('#detail_pic');
    if (!root || root.closest(`#${ROOT_ID}`)) return [];

    const urls = [];
    root.querySelectorAll('img[data-tracking-click-viewid="el_preview_business_details"]').forEach((img) => {
      const candidate = collectImgCandidates(img).map((raw) => toAbsoluteUrl(raw)).find(Boolean);
      if (candidate) urls.push(candidate);
    });
    return dedupeUrlsOrdered(urls);
  }

  /** #picture / #basic.carousel_gallery 主轮播图（不含 #materialPic 白底图） */
  function findCarouselRoot() {
    const inGallery = document.querySelector(
      '#basic\\.carousel_gallery [class*="MaterialModalButton_v2_materialContainer"], ' +
      '#picture [class*="MaterialModalButton_v2_materialContainer"]',
    );
    if (inGallery && !inGallery.closest(`#${ROOT_ID}, #materialPic`)) return inGallery;

    const upload = document.querySelector(
      '#picture [data-tracking-click-viewid="carousel_img_localfile_upload"], ' +
      '[data-tracking-click-viewid="carousel_img_localfile_upload"]',
    );
    if (upload) {
      const near = upload.closest('[class*="MaterialModalButton_v2_materialContainer"]')
        || upload.closest('#picture');
      if (near && !near.closest(`#${ROOT_ID}, #materialPic`)) return near;
    }

    return null;
  }

  function collectCarouselImages() {
    const urls = [];
    const root = findCarouselRoot();
    if (!root) return urls;

    root.querySelectorAll('[class*="MaterialModalButton_v2_imageBox"]').forEach((el) => {
      if (el.closest(`#${ROOT_ID}`)) return;
      const abs = firstBackgroundUrl(el);
      if (abs) urls.push(abs);
    });
    return dedupeUrlsOrdered(urls);
  }

  function discoverImagesPdd() {
    const collectors = {
      'category:carousel': collectCarouselImages,
      'category:detail': collectDetailImages,
      'category:preview': collectSkuPreviewImages,
    };
    let order = 0;
    const entries = [];
    PDD_CATEGORIES.forEach(({ key, label }) => {
      const collect = collectors[key];
      if (!collect) return;
      collect().forEach((url) => {
        entries.push({
          id: `pie-${order}`,
          url,
          selected: false,
          moduleKey: key,
          moduleLabel: label,
          order: order++,
        });
      });
    });
    return entries;
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

  /** 其它站点或兜底：按 DOM 模块扫描，模块内 URL 去重 */
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

  function discoverImagesGeneric() {
    const entries = [];
    const moduleSeen = new Map();
    let order = 0;

    const addEntry = (url, el) => {
      const abs = toAbsoluteUrl(url);
      if (!abs) return;
      const moduleEl = findModule(el);
      const moduleKey = moduleKeyOf(moduleEl);

      if (!moduleSeen.has(moduleKey)) moduleSeen.set(moduleKey, new Set());
      const seen = moduleSeen.get(moduleKey);
      if (seen.has(abs)) return;
      seen.add(abs);

      entries.push({
        id: `pie-${order}`,
        url: abs,
        selected: false,
        moduleKey,
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
        const localSeen = new Set();
        collectImgCandidates(el).forEach((raw) => {
          const abs = toAbsoluteUrl(raw);
          if (!abs || localSeen.has(abs)) return;
          localSeen.add(abs);
          addEntry(abs, el);
        });
        return;
      }

      parseBackgroundUrls(el.style && el.style.backgroundImage).forEach((u) => addEntry(u, el));
      const computed = getComputedStyle(el).backgroundImage;
      parseBackgroundUrls(computed).forEach((u) => addEntry(u, el));
    });

    return entries;
  }

  function discoverImages() {
    if (isPddMmsPage()) {
      const pdd = discoverImagesPdd();
      if (pdd.length > 0) return pdd;
    }
    return discoverImagesGeneric();
  }

  function groupImagesByModule(list) {
    const map = new Map();
    list.forEach((item) => {
      if (!map.has(item.moduleKey)) {
        map.set(item.moduleKey, { label: item.moduleLabel, items: [] });
      }
      map.get(item.moduleKey).items.push(item);
    });

    const groups = [];
    PDD_CATEGORY_ORDER.forEach((key) => {
      if (map.has(key)) groups.push(map.get(key));
    });
    map.forEach((group, key) => {
      if (!PDD_CATEGORY_ORDER.includes(key)) groups.push(group);
    });
    return groups;
  }

  function getPreviewItems() {
    return images.filter((item) => item.moduleKey === 'category:preview');
  }

  /** 预览图在类目内的 1-based 序号（与 DOM 采集顺序一致） */
  function getPreviewGlobalIndex(item) {
    const previewItems = getPreviewItems();
    const idx = previewItems.findIndex((i) => i.id === item.id);
    return idx >= 0 ? idx + 1 : 1;
  }

  function previewChunkFolderName(globalIndex, totalPreview) {
    const chunkStart = Math.floor((globalIndex - 1) / PREVIEW_CHUNK_SIZE) * PREVIEW_CHUNK_SIZE + 1;
    const chunkEnd = Math.min(chunkStart + PREVIEW_CHUNK_SIZE - 1, totalPreview);
    return `${chunkStart}-${chunkEnd}`;
  }

  function buildPreviewDownloadTasks(items, baseFolder) {
    const totalPreview = getPreviewItems().length;
    const sorted = [...items].sort(
      (a, b) => getPreviewGlobalIndex(a) - getPreviewGlobalIndex(b),
    );
    return sorted.map((item) => {
      const globalIndex = getPreviewGlobalIndex(item);
      const filename = `${globalIndex}${guessExtension(item.url)}`;
      if (totalPreview <= PREVIEW_CHUNK_SIZE) {
        return { url: item.url, name: `${baseFolder}/${filename}` };
      }
      const subFolder = previewChunkFolderName(globalIndex, totalPreview);
      return { url: item.url, name: `${baseFolder}/${subFolder}/${filename}` };
    });
  }

  function buildDownloadTasksFromBatches(batches) {
    const tasks = [];
    batches.forEach(({ folder, items }) => {
      if (!folder || !items.length) return;
      const isPreview = items.every((item) => item.moduleKey === 'category:preview');
      if (isPreview) {
        tasks.push(...buildPreviewDownloadTasks(items, folder));
        return;
      }
      buildOrderedFilenames(items).forEach((file) => {
        tasks.push({ url: file.url, name: `${folder}/${file.filename}` });
      });
    });
    return tasks;
  }

  function downloadItems(items, folder, triggerBtn) {
    downloadItemsMulti([{ folder, items }], triggerBtn);
  }

  function buildDownloadBatches(selected, defaultFolder) {
    const batches = [];
    const pddSelected = selected.filter((item) => isPddPresetCategory(item.moduleKey));
    const otherSelected = selected.filter((item) => !isPddPresetCategory(item.moduleKey));

    groupImagesByModule(pddSelected).forEach((group) => {
      batches.push({ folder: pddCategoryFolder(group.label), items: group.items });
    });

    if (otherSelected.length > 0) {
      batches.push({ folder: defaultFolder, items: otherSelected });
    }
    return batches;
  }

  function downloadItemsMulti(batches, triggerBtn) {
    const tasks = buildDownloadTasksFromBatches(batches);

    if (!tasks.length) {
      showToast('没有可下载的图片');
      return;
    }

    let success = 0;
    let fail = 0;
    let pending = tasks.length;

    if (triggerBtn) triggerBtn.disabled = true;
    showToast(`正在下载 0/${tasks.length}...`);

    const finishOne = () => {
      pending -= 1;
      if (pending === 0) {
        if (triggerBtn) triggerBtn.disabled = false;
        const folderPaths = [...new Set(tasks.map((t) => {
          const slash = t.name.lastIndexOf('/');
          return slash > 0 ? t.name.slice(0, slash) : t.name;
        }))];
        const folderHint = folderPaths.length <= 3
          ? folderPaths.join('、')
          : `${folderPaths.slice(0, 2).join('、')} 等 ${folderPaths.length} 个目录`;
        showToast(`下载完成：成功 ${success} 张，失败 ${fail} 张 → ${folderHint}`);
      }
    };

    tasks.forEach((task) => {
      GM_download({
        url: task.url,
        name: task.name,
        onload: () => {
          success += 1;
          showToast(`正在下载 ${success + fail}/${tasks.length}...`);
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
  }

  function getSelectionOrderMap() {
    const selected = images.filter((item) => item.selected);
    const map = new Map();
    selected.forEach((item, index) => {
      map.set(item, index + 1);
    });
    return map;
  }

  function findItemById(id) {
    return images.find((item) => item.id === id) || null;
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
      const id = card.getAttribute('data-pie-id');
      if (!id) return;
      const item = findItemById(id);
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

  function toggleCardAtPoint(clientX, clientY, visitedIds, sectionGrid, grid) {
    const el = document.elementFromPoint(clientX, clientY);
    const card = el && el.closest ? el.closest('.pie-item') : null;
    if (!card || !sectionGrid.contains(card)) return;
    const id = card.getAttribute('data-pie-id');
    if (!id || visitedIds.has(id)) return;
    visitedIds.add(id);
    const item = findItemById(id);
    if (!item) return;
    item.selected = !item.selected;
    syncCardSelectionState(card, item);
    updateSelectionBadges(grid);
  }

  function makePaintSelection(grid) {
    let startX = 0;
    let startY = 0;
    let painting = false;
    let visitedIds = new Set();
    let active = false;
    let startSectionGrid = null;

    const cleanup = () => {
      active = false;
      painting = false;
      visitedIds = new Set();
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
        toggleCardAtPoint(e.clientX, e.clientY, visitedIds, startSectionGrid, grid);
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
      visitedIds = new Set();
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
        padding: 16px 20px; min-height: 56px; box-sizing: border-box;
        border-bottom: 1px solid #e5e7eb;
        display: flex; flex-wrap: nowrap; gap: 10px; align-items: center;
        overflow-x: auto; overflow-y: hidden;
      }
      #${ROOT_ID} .pie-header h2 {
        margin: 0; font-size: 16px; font-weight: 600; flex: 0 0 auto; white-space: nowrap;
      }
      #${ROOT_ID} .pie-folder-input {
        width: 124px; flex: 0 0 124px; padding: 8px 12px; font-size: 13px;
        border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box;
        background: #fff; color: #111827; line-height: 1.3;
      }
      #${ROOT_ID} .pie-folder-presets {
        display: inline-flex !important; gap: 8px; flex: 0 0 auto; flex-wrap: nowrap;
        align-items: center; visibility: visible !important; opacity: 1 !important;
      }
      #${ROOT_ID} .pie-folder-preset-btn {
        box-sizing: border-box; display: inline-flex !important; align-items: center;
        padding: 8px 14px; border: 1px solid #d1d5db; border-radius: 6px;
        background: #fff; color: #374151; font-size: 13px; line-height: 1.3;
        cursor: pointer; user-select: none; white-space: nowrap;
        visibility: visible !important; opacity: 1 !important;
      }
      #${ROOT_ID} .pie-folder-preset-btn:hover { background: #f9fafb; }
      #${ROOT_ID} .pie-folder-preset-btn.active {
        background: #eff6ff; border-color: #2563eb; color: #1d4ed8;
      }
      #${ROOT_ID} .pie-actions {
        display: flex; gap: 8px; flex: 0 0 auto; flex-wrap: nowrap;
        align-items: center; margin-left: auto;
      }
      #${ROOT_ID} .pie-header button:not(.pie-folder-preset-btn) {
        padding: 8px 16px; font-size: 13px; line-height: 1.3; white-space: nowrap;
        border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb; cursor: pointer;
      }
      #${ROOT_ID} .pie-header button.pie-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
      #${ROOT_ID} .pie-status { padding: 10px 20px 12px; color: #6b7280; font-size: 13px; }
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
      #${ROOT_ID} .pie-section-actions button.pie-section-primary {
        background: #2563eb; color: #fff; border-color: #2563eb;
      }
      #${ROOT_ID} .pie-section-actions button.pie-section-primary:hover { background: #1d4ed8; }
      #${ROOT_ID} .pie-section-actions button.pie-section-primary:disabled { opacity: .6; cursor: not-allowed; }
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
    card.setAttribute('data-pie-id', item.id);
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
      renderGrid(document.querySelector(`#${ROOT_ID} .pie-grid`), panelFolderInput);
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

  function renderGrid(container, folderInput) {
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
        renderGrid(container, folderInput);
      });

      const sectionDeselectAllBtn = document.createElement('button');
      sectionDeselectAllBtn.type = 'button';
      sectionDeselectAllBtn.textContent = '取消全选';
      sectionDeselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        group.items.forEach((item) => { item.selected = false; });
        renderGrid(container, folderInput);
      });

      const sectionDownloadAllBtn = document.createElement('button');
      sectionDownloadAllBtn.type = 'button';
      sectionDownloadAllBtn.className = 'pie-section-primary';
      sectionDownloadAllBtn.textContent = '下载全部';
      sectionDownloadAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isPddCategory = group.items.length > 0 && isPddPresetCategory(group.items[0].moduleKey);
        const folder = isPddCategory
          ? pddCategoryFolder(group.label)
          : sanitizePathPart((folderInput && folderInput.value.trim()) || group.label, group.label);
        if (!folder) {
          showToast('请先填写文件夹名');
          if (folderInput) folderInput.focus();
          return;
        }
        if (isPddCategory) setFolderPreset(folder);
        downloadItems(group.items, folder, sectionDownloadAllBtn);
      });

      actions.appendChild(sectionSelectAllBtn);
      actions.appendChild(sectionDeselectAllBtn);
      actions.appendChild(sectionDownloadAllBtn);
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

  async function openPanel() {
    const root = ensureRoot();
    root.innerHTML = '';

    if (isPddMmsPage()) {
      root.innerHTML = [
        `<div class="pie-overlay"><div class="pie-panel">`,
        `<div class="pie-status" style="padding:24px">正在加载 SKU 表格…</div>`,
        `</div></div>`,
      ].join('');
      await expandPddSkuTable();
      root.innerHTML = '';
    }

    images = discoverImages();

    const overlay = document.createElement('div');
    overlay.className = 'pie-overlay';

    const panel = document.createElement('div');
    panel.className = 'pie-panel';

    const header = document.createElement('div');
    header.className = 'pie-header';

    const title = document.createElement('h2');
    title.textContent = `发现 ${images.length} 张图片`;

    const actions = document.createElement('div');
    actions.className = 'pie-actions';

    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.className = 'pie-folder-input';
    folderInput.placeholder = '文件夹名';
    folderInput.value = defaultFolderName();

    const presets = document.createElement('div');
    presets.className = 'pie-folder-presets';
    presets.setAttribute('role', 'group');
    presets.setAttribute('aria-label', '文件夹快捷选择');

    const presetButtons = [];

    const syncPresetButtons = () => {
      const val = folderInput.value.trim();
      presetButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.preset === val);
      });
    };

    FOLDER_PRESETS.forEach((name) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pie-folder-preset-btn';
      btn.dataset.preset = name;
      btn.textContent = name;
      btn.addEventListener('click', () => {
        folderInput.value = name;
        syncPresetButtons();
        folderInput.focus();
      });
      presetButtons.push(btn);
      presets.appendChild(btn);
    });

    folderInput.addEventListener('input', syncPresetButtons);
    syncPresetButtons();
    panelFolderInput = folderInput;
    panelSyncPresets = syncPresetButtons;

    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = '全选';
    selectAllBtn.addEventListener('click', () => {
      images.forEach((item) => { item.selected = true; });
      renderGrid(grid, folderInput);
    });

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.textContent = '取消全选';
    deselectAllBtn.addEventListener('click', () => {
      images.forEach((item) => { item.selected = false; });
      renderGrid(grid, folderInput);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'pie-primary';
    downloadBtn.textContent = '下载选中';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.addEventListener('click', () => {
      root.innerHTML = '';
      panelFolderInput = null;
      panelSyncPresets = null;
      createFab();
    });

    const status = document.createElement('div');
    status.className = 'pie-status';

    const grid = document.createElement('div');
    grid.className = 'pie-grid';
    renderGrid(grid, folderInput);
    makePaintSelection(grid);

    downloadBtn.addEventListener('click', () => {
      const selected = images.filter((item) => item.selected);
      if (selected.length === 0) {
        showToast('请先选择要下载的图片');
        return;
      }

      const defaultFolder = sanitizePathPart(folderInput.value.trim(), '');
      const batches = buildDownloadBatches(selected, defaultFolder);
      const needsDefaultFolder = selected.some((item) => !isPddPresetCategory(item.moduleKey));

      if (needsDefaultFolder && !defaultFolder) {
        showToast('请先填写文件夹名');
        folderInput.focus();
        return;
      }

      const pddBatches = batches.filter((b) => FOLDER_PRESETS.includes(b.folder));
      if (pddBatches.length === 1 && batches.length === 1) {
        setFolderPreset(pddBatches[0].folder);
      }

      downloadItemsMulti(batches, downloadBtn);
    });

    header.appendChild(title);
    header.appendChild(folderInput);
    header.appendChild(presets);
    header.appendChild(actions);
    actions.appendChild(selectAllBtn);
    actions.appendChild(deselectAllBtn);
    actions.appendChild(downloadBtn);
    actions.appendChild(closeBtn);

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
