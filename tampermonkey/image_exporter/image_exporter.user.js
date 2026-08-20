// ==UserScript==
// @name         页面图片导出器
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.6.6
// @description  拼多多商品页按轮播图/详情图/预览图分类导出，其它站点通用扫描
// @author       script_fun
// @match        *://*/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      *
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
  /** @type {FileSystemDirectoryHandle | null} 本次面板会话内用户选择的保存根目录 */
  let saveDirHandle = null;
  /** @type {Map<string, FileSystemDirectoryHandle>} 写入目录缓存，避免重复 resolve */
  let fsDirHandleCache = new Map();
  /** @type {string|null} 拼多多页：{商品标题}-{商品ID} 外层目录名 */
  let pddExportRoot = null;

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

  /** GM_download 子路径：统一正斜杠，Win/Linux/macOS 兼容 */
  function joinDownloadPath(...parts) {
    return parts
      .map((part) => sanitizePathPart(String(part), ''))
      .filter(Boolean)
      .join('/');
  }

  const CHUNK_SIZE = 12;
  /** 并发下载数（FS API 写入可并行；GM_download 回退时自动降低） */
  const DOWNLOAD_CONCURRENCY = 10;
  const GM_DOWNLOAD_CONCURRENCY = 2;
  const GM_DOWNLOAD_GAP_MS = 40;
  const EXCEL_HOOK_SOURCE = 'pie-excel-hook';
  const EXCEL_URL_RE = /excel|xlsx|export|sku|batch|glide|template|spec|edit|download|cost|mms/i;
  const FOLDER_PRESETS = ['轮播图', '详情图', '预览图'];
  const SAVE_DIR_PICK_HINT = '请选择保存目录（建议选择 Downloads/下载 文件夹）…';
  const PDD_CATEGORY_ORDER = ['category:carousel', 'category:detail', 'category:preview'];
  const PDD_CATEGORIES = [
    { key: 'category:carousel', label: '轮播图' },
    { key: 'category:detail', label: '详情图' },
    { key: 'category:preview', label: '预览图' },
  ];
  /** 与平台轮播「宽高均大于 480」对齐；用于过滤「文本暂无预览」等过小占位图 */
  const PDD_MIN_IMAGE_EDGE_PX = 480;
  const PDD_PLACEHOLDER_TEXT_RE = /文本暂无预览|暂无预览|无预览/;

  function isPddMmsPage() {
    return /mms\.pinduoduo\.com/i.test(location.hostname);
  }

  /** 拼多多商品编辑页：读取标题 + 商品ID，拼成外层文件夹名 */
  function getPddGoodsMeta() {
    let goodsId = '';
    const idWrap = document.querySelector('.goods-id-wrap');
    if (idWrap) {
      const m = (idWrap.textContent || '').match(/商品ID\s*[:：]\s*(\d+)/);
      if (m) goodsId = m[1];
    }

    if (!goodsId) {
      try {
        const url = new URL(location.href);
        for (const key of ['goods_id', 'id', 'goodsId']) {
          const v = url.searchParams.get(key);
          if (v) {
            goodsId = v;
            break;
          }
        }
      } catch {
        /* ignore */
      }
    }

    let goodsTitle = '';
    const titleInput = document.querySelector('#basic\\.goods_name input[type="text"]');
    if (titleInput?.value?.trim()) {
      goodsTitle = titleInput.value.trim();
    }
    if (!goodsTitle) {
      const titleWrap = document.querySelector('.edit-title-wrap');
      if (titleWrap) {
        goodsTitle = (titleWrap.textContent || '')
          .replace(/商品ID\s*[:：]\s*\d+/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    if (!goodsTitle) goodsTitle = '未命名商品';
    if (!goodsId) goodsId = 'unknown';

    return { goodsId, goodsTitle };
  }

  function resolvePddExportRoot() {
    const { goodsTitle, goodsId } = getPddGoodsMeta();
    return sanitizePathPart(`${goodsTitle}-${goodsId}`.slice(0, 120), '商品');
  }

  function getPddExportRootFolder() {
    if (!isPddMmsPage()) return null;
    if (!pddExportRoot) pddExportRoot = resolvePddExportRoot();
    return pddExportRoot;
  }

  /** 拼多多类目下载路径：{标题-ID}/轮播图/… */
  function withExportRoot(relativeFolder) {
    const root = getPddExportRootFolder();
    if (!root) return relativeFolder;
    return joinDownloadPath(root, relativeFolder);
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

  /** 导出前：对齐手动改法，把滚动层 max-height/height 设为虚拟总高，并等待 DOM 稳定后再返回 */
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

    let finalH = Math.ceil(Math.max(maxH, 820) + 40);
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
      finalH = Math.ceil(maxH + 40);
      viewport.style.maxHeight = `${finalH}px`;
      viewport.style.height = `${finalH}px`;
    }
    if (spacer) {
      spacer.style.paddingTop = '0px';
      spacer.style.paddingBottom = '0px';
    }
    viewport.scrollTop = 0;
    await settlePddSkuDomAfterExpand(viewport);
  }

  /** 高度改完后只等 DOM 行数稳定；不再按 scrollHeight 抬高（避免与容器高度正反馈产生底部空白） */
  async function settlePddSkuDomAfterExpand(viewport) {
    if (!viewport) return;
    let lastCount = -1;
    let stableHits = 0;
    for (let i = 0; i < 100; i += 1) {
      await sleep(50);
      const spacer = getPddSkuSpacer(viewport);
      if (spacer) {
        spacer.style.paddingTop = '0px';
        spacer.style.paddingBottom = '0px';
      }
      const table = viewport.querySelector('table[class*="TB_tableWrapper"]') || viewport;
      const count = table.querySelectorAll(PDD_SKU_ROW_IN_TABLE).length;
      if (count > 0 && count === lastCount) {
        stableHits += 1;
        if (stableHits >= 12) break;
      } else {
        stableHits = 0;
      }
      lastCount = count;
    }
    const spacer = getPddSkuSpacer(viewport);
    if (spacer) {
      spacer.style.paddingTop = '0px';
      spacer.style.paddingBottom = '0px';
    }
    viewport.scrollTop = 0;
    await sleep(150);
  }

  const MANIFEST_VERSION = '1';
  const PIE_STYLE_HEADER_NAMES = new Set([
    '款式', '颜色', '尺寸', '型号', '器型', '材质', '口味', '色号', '适用人群',
    '容量', '花型', '尺码', '地点', '包装方式', '香型', '货号', '组合', '成份',
    '版本', '度数', '运营商', '属性', '重量', '地区', '套餐', '类别', '适用年龄',
    '功效', '品类', '时间', '规格',
  ]);

  function pieNormText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function pieIsSpecInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.closest('table[class*="TB_tableWrapper"], [class*="TB_body"]')) return false;
    const ph = input.placeholder || '';
    if (ph === '请输入规格名称' || /^自定义/.test(ph)) return true;
    if (/规格名称|请输入规格|规格值/.test(ph)) return true;
    if (/库存|价格|编码|拼单价|单买价|全部颜色|全部尺寸|搜索/.test(ph)) return false;
    return !!input.closest('.custom-input-container, .package-item-container, .package-container, .property-values-container, #newSpec, #stand_spec');
  }

  function pieQuerySpecInputs(root) {
    if (!root) return [];
    return [...root.querySelectorAll('input')].filter(pieIsSpecInput);
  }

  function pieFindSpecGroupRoot(firstInput) {
    const scope = firstInput.closest('#goods-spec-sku, #sku, #newSpec, .goods-sku-box') || document.body;
    let el = firstInput;
    while (el && el !== scope) {
      const hasDelete = [...el.querySelectorAll('a, button, span')].some(
        (node) => /删除规格类型|删除/.test((node.textContent || '').replace(/\s+/g, '')),
      );
      if (hasDelete && pieQuerySpecInputs(el).length > 0) return el;
      el = el.parentElement;
    }
    return firstInput.closest('.package-container, .property-values-container, .custom-package') || firstInput.parentElement;
  }

  function pieGetAllSpecGroupRoots() {
    const roots = [];
    const seen = new Set();
    const scopes = document.querySelectorAll('#goods-spec-sku, #sku, #newSpec, .goods-sku-box');
    const inputs = [];
    scopes.forEach((scope) => {
      pieQuerySpecInputs(scope).forEach((input) => {
        if (!inputs.includes(input)) inputs.push(input);
      });
    });
    inputs.forEach((input) => {
      const group = pieQuerySpecInputs(pieFindSpecGroupRoot(input));
      if (!group.length || group[0] !== input) return;
      const root = pieFindSpecGroupRoot(input);
      if (seen.has(root)) return;
      seen.add(root);
      roots.push(root);
    });
    return roots;
  }

  function pieExtractTypeLabelFromSpecRow(specRow) {
    if (!specRow) return '';
    const specIdBlock = specRow.querySelector('[id*="parentSpecArr"][id*="spec_id"], [id*="spec_id"]');
    const scope = specIdBlock || specRow.querySelector('.goods-spec-row-left') || specRow;

    const input = scope.querySelector(
      '[class*="ST_selectValueSingle"] input, [class*="ST_inputWrapper"] input, [class*="IPT_inputWrapper"] input, input',
    );
    if (input) {
      const val = pieNormText(input.value || input.getAttribute('value') || '');
      if (val && val !== '规格' && !/请选择|删除|添加/.test(val)) return val;
    }

    const single = scope.querySelector('[class*="ST_selectValueSingle"], [class*="ST_inputWrapper"]');
    if (single) {
      const text = pieNormText(single.textContent);
      if (text && text.length <= 20 && text !== '规格' && !/请选择|删除|添加|请输入/.test(text)) {
        return text;
      }
    }
    return pieExtractTypeLabel(specRow);
  }

  function pieExtractTypeLabel(groupRoot) {
    const titleRow = groupRoot.querySelector('.goods-spec-row-title, [class*="spec-row-title"]');
    if (titleRow) {
      const selectEl = titleRow.querySelector(
        '[class*="Select"], [data-testid*="select"], input[readonly], [class*="select"]',
      );
      if (selectEl) {
        const selText = pieNormText(selectEl.textContent || selectEl.value);
        if (selText && selText.length <= 20 && !/删除|添加|请输入|规格值/.test(selText)) {
          return selText;
        }
      }
      const rowText = pieNormText(titleRow.textContent)
        .replace(/删除规格类型.*$/g, '')
        .replace(/添加.*$/g, '')
        .trim();
      if (rowText && rowText.length <= 20 && !/删除|添加|最多添加|请输入/.test(rowText)) {
        return rowText;
      }
    }

    const nodes = groupRoot.querySelectorAll(
      '[class*="Select"], [data-testid*="select"], [class*="title"], [class*="label"], span, div',
    );
    for (const node of nodes) {
      const text = pieNormText(node.textContent);
      if (!text || text.length > 20) continue;
      if (/删除|添加|请输入|规格值|规格名称|最多添加/.test(text)) continue;
      if (node.closest('.custom-input-container, .package-item-container')) continue;
      if (text === '规格') continue;
      if (PIE_STYLE_HEADER_NAMES.has(text) || /^自定义/.test(text)) return text;
    }
    const header = groupRoot.querySelector('[class*="header"], [class*="title"]');
    if (header) {
      const text = pieNormText(header.textContent);
      if (text && text !== '规格' && !/删除|添加/.test(text)) return text;
    }
    return '';
  }

  function collectSpecDimensionsForManifest() {
    const specRows = [...document.querySelectorAll(
      '#spec .goods-spec-row, .goods-sku-box.goods-spec .goods-spec-row',
    )].filter((row) => !row.closest(`#${ROOT_ID}`));

    if (specRows.length) {
      return specRows.map((row) => {
        const values = pieQuerySpecInputs(row).map((input) => input.value.trim()).filter(Boolean);
        return { typeLabel: pieExtractTypeLabelFromSpecRow(row), values };
      }).filter((dim) => dim.typeLabel || dim.values.length > 0);
    }

    return pieGetAllSpecGroupRoots().map((root) => {
      const inputs = pieQuerySpecInputs(root);
      const values = inputs.map((input) => input.value.trim()).filter(Boolean);
      return { typeLabel: pieExtractTypeLabel(root), values };
    }).filter((dim) => dim.typeLabel || dim.values.length > 0);
  }

  function collectSkuStyleLabelsForManifest() {
    const styles = [];
    document.querySelectorAll('#goods-spec-sku .sku-preview-cell, #sku .sku-preview-cell').forEach((cell) => {
      if (cell.closest(`#${ROOT_ID}`)) return;
      const row = cell.closest('tr');
      if (!row) {
        styles.push('');
        return;
      }
      const title = row.querySelector('.sku-row-title');
      if (title) {
        styles.push(pieNormText(title.textContent));
        return;
      }
      const parts = [];
      row.querySelectorAll('td').forEach((td) => {
        const t = pieNormText(td.textContent);
        if (t && !/预览|上传|本地上传/.test(t) && t.length < 40) parts.push(t);
      });
      styles.push(parts.slice(0, 3).join(' / '));
    });
    return styles;
  }

  function stripExportRootPath(fullPath, exportRoot) {
    const prefix = `${exportRoot}/`;
    if (fullPath.startsWith(prefix)) return fullPath.slice(prefix.length);
    const idx = fullPath.indexOf('/');
    return idx >= 0 ? fullPath.slice(idx + 1) : fullPath;
  }

  function seqFromRelativeImagePath(relPath) {
    const m = String(relPath || '').match(/(\d+)\.\w+$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function buildExportManifest(imageTasks, excelMissing) {
    const exportRoot = getPddExportRootFolder() || '商品';
    const strip = (name) => stripExportRootPath(name, exportRoot);
    const carousel = imageTasks
      .filter((t) => /\/轮播图\//.test(t.name))
      .sort((a, b) => seqFromRelativeImagePath(strip(a.name)) - seqFromRelativeImagePath(strip(b.name)))
      .map((t) => strip(t.name));
    const detail = imageTasks
      .filter((t) => /\/详情图\//.test(t.name))
      .sort((a, b) => seqFromRelativeImagePath(strip(a.name)) - seqFromRelativeImagePath(strip(b.name)))
      .map((t) => strip(t.name));
    const styles = collectSkuStyleLabelsForManifest();
    const preview = imageTasks
      .filter((t) => /\/预览图\//.test(t.name))
      .map((t) => {
        const file = strip(t.name);
        const index = seqFromRelativeImagePath(file);
        return { index, file, style: styles[index - 1] || '' };
      })
      .sort((a, b) => a.index - b.index);
    const meta = getPddGoodsMeta();
    return {
      version: MANIFEST_VERSION,
      source: {
        goodsId: meta.goodsId,
        goodsTitle: meta.goodsTitle,
        exportedAt: new Date().toISOString(),
      },
      specDimensions: collectSpecDimensionsForManifest(),
      images: { carousel, detail, preview },
      excel: excelMissing ? null : '成本表.xlsx',
      previewTotal: preview.length,
    };
  }

  async function writeExportManifest(rootDirHandle, manifest) {
    const exportRoot = getPddExportRootFolder() || '商品';
    const relPath = joinDownloadPath(exportRoot, 'manifest.json');
    const blob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' });
    if (rootDirHandle) {
      await writeBlobToDir(rootDirHandle, relPath, blob);
      return true;
    }
    return gmDownloadBlob(blob, relPath);
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
  function isDetailImagePlaceholder(img) {
    let node = img;
    for (let i = 0; i < 8 && node; i += 1, node = node.parentElement) {
      const text = (node.textContent || '').replace(/\s+/g, '');
      if (PDD_PLACEHOLDER_TEXT_RE.test(text)) return true;
    }
    return false;
  }

  function isHtmlImageTooSmall(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (!img.complete || img.naturalWidth <= 0) return false;
    return Math.min(img.naturalWidth, img.naturalHeight) < PDD_MIN_IMAGE_EDGE_PX;
  }

  function probeImageMinEdge(url, minEdge = PDD_MIN_IMAGE_EDGE_PX) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(false);
        return;
      }
      const img = new Image();
      const finish = (ok) => {
        img.onload = null;
        img.onerror = null;
        resolve(ok);
      };
      img.onload = () => finish(Math.min(img.naturalWidth, img.naturalHeight) >= minEdge);
      img.onerror = () => finish(false);
      try {
        img.src = url;
      } catch {
        finish(false);
      }
    });
  }

  async function filterUrlsByMinEdge(urls, minEdge = PDD_MIN_IMAGE_EDGE_PX) {
    const out = [];
    for (const url of urls) {
      if (await probeImageMinEdge(url, minEdge)) out.push(url);
    }
    return out;
  }

  function collectDetailImages() {
    const root = document.querySelector('#detail_pic');
    if (!root || root.closest(`#${ROOT_ID}`)) return [];

    const urls = [];
    root.querySelectorAll('img[data-tracking-click-viewid="el_preview_business_details"]').forEach((img) => {
      if (isDetailImagePlaceholder(img)) return;
      if (isHtmlImageTooSmall(img)) return;
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

    const nodes = root.querySelectorAll(
      '[class*="MaterialModalButton_v2_imageBox"], ' +
      '[class*="MaterialModalButton_v2_imgContainer"], ' +
      '[class*="MaterialModalButton_v2_imageWrapper"]',
    );
    nodes.forEach((el) => {
      if (el.closest(`#${ROOT_ID}`)) return;
      const abs = firstBackgroundUrl(el);
      if (abs) urls.push(abs);
    });
    return dedupeUrlsOrdered(urls);
  }

  async function discoverImagesPdd() {
    const collectors = {
      'category:carousel': collectCarouselImages,
      'category:detail': collectDetailImages,
      'category:preview': collectSkuPreviewImages,
    };
    let order = 0;
    const entries = [];
    for (const { key, label } of PDD_CATEGORIES) {
      const collect = collectors[key];
      if (!collect) continue;
      let urls = collect();
      if (key === 'category:carousel' || key === 'category:detail') {
        urls = await filterUrlsByMinEdge(urls);
      }
      urls.forEach((url) => {
        entries.push({
          id: `pie-${order}`,
          url,
          selected: false,
          moduleKey: key,
          moduleLabel: label,
          order: order++,
        });
      });
    }
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

  async function discoverImages() {
    if (isPddMmsPage()) {
      const pdd = await discoverImagesPdd();
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

  function findItemById(id) {
    return images.find((item) => item.id === id) || null;
  }

  function sortByDomOrder(items) {
    return [...items].sort((a, b) => a.order - b.order);
  }

  /**
   * 构建下载任务：按类目内 DOM 顺序全局连续编号 1,2,3…
   * 仅预览图且总数 >12 张时分桶：{folder}/1-12/1.jpg … {folder}/13-24/13.jpg …
   */
  function splitFolderPath(baseFolder) {
    return String(baseFolder || '')
      .split('/')
      .map((part) => sanitizePathPart(part, ''))
      .filter(Boolean);
  }

  function getCategoryTotal(moduleKey) {
    if (!moduleKey) return 0;
    return images.filter((item) => item.moduleKey === moduleKey).length;
  }

  /** 图片在所属类目完整列表中的 1-based 序号（部分选中时仍按完整列表位置） */
  function getCategoryPosition(item) {
    if (!item?.moduleKey) return 0;
    const allInCategory = images
      .filter((img) => img.moduleKey === item.moduleKey)
      .sort((a, b) => a.order - b.order);
    const idx = allInCategory.findIndex((img) => img.id === item.id);
    return idx >= 0 ? idx + 1 : 0;
  }

  /** 全局序号所在分桶目录名，如 1-12、13-24；末桶上限按实际总数截断（如 25-25） */
  function chunkRangeLabel(seq, total) {
    const start = Math.floor((seq - 1) / CHUNK_SIZE) * CHUNK_SIZE + 1;
    const end = Math.min(start + CHUNK_SIZE - 1, total);
    return `${start}-${end}`;
  }

  function buildCategoryDownloadTasks(items, baseFolder) {
    const sorted = sortByDomOrder(items);
    const folderParts = splitFolderPath(baseFolder);
    if (!folderParts.length) folderParts.push('images');
    const moduleKey = sorted[0]?.moduleKey;
    const categoryTotal = moduleKey ? getCategoryTotal(moduleKey) : sorted.length;
    const useChunks = moduleKey === 'category:preview' && categoryTotal > CHUNK_SIZE;

    return sorted.map((item, index) => {
      const seq = getCategoryPosition(item) || index + 1;
      const ext = guessExtension(item.url);
      if (!useChunks) {
        return { url: item.url, name: joinDownloadPath(...folderParts, `${seq}${ext}`) };
      }
      return {
        url: item.url,
        name: joinDownloadPath(...folderParts, chunkRangeLabel(seq, categoryTotal), `${seq}${ext}`),
      };
    });
  }

  function buildDownloadTasksFromBatches(batches) {
    const tasks = [];
    batches.forEach(({ folder, items }) => {
      if (!folder || !items.length) return;
      tasks.push(...buildCategoryDownloadTasks(items, folder));
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
      batches.push({
        folder: withExportRoot(pddCategoryFolder(group.label)),
        items: group.items,
      });
    });

    if (otherSelected.length > 0) {
      batches.push({ folder: defaultFolder, items: otherSelected });
    }
    return batches;
  }

  function isFullPddExport(categoryKeys) {
    return categoryKeys.length === PDD_CATEGORY_ORDER.length
      && PDD_CATEGORY_ORDER.every((key, index) => categoryKeys[index] === key);
  }

  function findReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
    );
    return key ? el[key] : null;
  }

  /** 定位「Excel批量编辑规格」入口 */
  function findSkuExcelExportElement() {
    const directLinks = document.querySelectorAll(
      '#sku a[class*="BTN_outerWrapperLink"], #goods-spec-sku a[class*="BTN_outerWrapperLink"], ' +
      '#sku a, #goods-spec-sku a',
    );
    for (const a of directLinks) {
      if (a.closest(`#${ROOT_ID}`)) continue;
      const text = (a.textContent || '').replace(/\s+/g, '');
      if (/Excel批量编辑规格|Excel批量编辑|批量编辑规格/.test(text)) return a;
    }

    const scopes = [
      document.querySelector('#sku .sku-top-right'),
      document.querySelector('[class*="sku-top-right"]'),
      document.querySelector('#sku'),
      document.querySelector('#goods-spec-sku'),
    ].filter((el) => el && !el.closest(`#${ROOT_ID}`));

    for (const scope of scopes) {
      const nodes = scope.querySelectorAll('a, button, span, [role="button"], [role="link"]');
      for (const node of nodes) {
        const text = (node.textContent || '').replace(/\s+/g, '');
        if (/Excel批量编辑规格|Excel批量编辑|批量编辑规格/.test(text)) {
          return node.closest('a, button, [role="button"]') || node;
        }
      }
    }
    return null;
  }

  function getUnsafeWindow() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function setExcelCaptureActive(active) {
    getUnsafeWindow().__pieExcelCaptureActive = !!active;
  }

  function isSkuExcelApiUrl(url) {
    const u = String(url || '').toLowerCase();
    return u.includes('downloadexcel') || u.includes('goodscommit/action');
  }

  function isSkuExcelFileUrl(url) {
    const u = String(url || '').toLowerCase();
    return (/pfs\.yangkeduo\.com/.test(u) || /excellence-private/.test(u)) && /\.xlsx(\?|$)/.test(u);
  }

  function scoreExcelUrl(url) {
    if (isSkuExcelApiUrl(url)) return -1;
    if (isSkuExcelFileUrl(url)) return 100;
    if (/\.xlsx(\?|$)/i.test(String(url || ''))) return 80;
    return 0;
  }

  async function validateExcelBlob(blob) {
    if (!blob || blob.size < 4) return false;
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (head[0] === 0x7B) return false;
    return head[0] === 0x50 && head[1] === 0x4B;
  }

  function installExcelCaptureHook() {
    if (document.documentElement.dataset.pieExcelHook) return;
    document.documentElement.dataset.pieExcelHook = '1';

    const script = document.createElement('script');
    script.textContent = `
      (function () {
        if (window.__pieExcelHook) return;
        window.__pieExcelHook = true;
        window.__pieExcelCaptureActive = false;
        var SOURCE = ${JSON.stringify(EXCEL_HOOK_SOURCE)};
        var URL_RE = ${EXCEL_URL_RE.toString()};
        var post = function (payload) {
          window.postMessage(Object.assign({ source: SOURCE }, payload), '*');
        };
        var isExcelLikeBlob = function (blob) {
          if (!blob || !blob.size || blob.size < 128) return false;
          if (blob.size > 20 * 1024 * 1024) return false;
          var t = (blob.type || '').toLowerCase();
          return /sheet|excel|spreadsheet|ms-excel|zip|octet-stream/.test(t);
        };
        var captureBlob = function (blob) {
          if (!window.__pieExcelCaptureActive) return;
          if (!isExcelLikeBlob(blob)) return;
          try {
            var reader = new FileReader();
            reader.onload = function () {
              post({
                excelBuffer: reader.result,
                blobType: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              });
            };
            reader.readAsArrayBuffer(blob);
          } catch (e) { /* ignore */ }
        };
        var maybeCaptureUrl = function (url, method) {
          if (!url) return;
          var u = String(url);
          if (isDownloadExcelApi(u)) return;
          if (!URL_RE.test(u)) return;
          try {
            post({ url: new URL(u, location.href).href, method: method || 'GET' });
          } catch (e) { /* ignore */ }
        };
        var isExcelContentType = function (ct) {
          return /sheet|excel|spreadsheet|ms-excel|zip|octet-stream/.test(String(ct || '').toLowerCase());
        };
        var isDownloadExcelApi = function (url) {
          return url && String(url).indexOf('downloadExcel') !== -1;
        };
        var captureDownloadExcelJson = function (resp, reqUrl, method) {
          if (!window.__pieExcelCaptureActive) return;
          var url = reqUrl || (resp && resp.url) || '';
          if (!isDownloadExcelApi(url)) return;
          resp.clone().json().then(function (data) {
            if (data && data.success && data.result && data.result.url) {
              post({ url: data.result.url, method: 'GET', excelApi: true });
            }
          }).catch(function () {});
        };
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
          var url = typeof input === 'string' ? input : (input && input.url);
          maybeCaptureUrl(url, init && init.method);
          return origFetch.apply(this, arguments).then(function (resp) {
            try {
              captureDownloadExcelJson(resp, url, init && init.method);
              var ct = resp.headers && resp.headers.get('content-type');
              if (window.__pieExcelCaptureActive && isExcelContentType(ct)) {
                post({ url: resp.url || url, method: (init && init.method) || 'GET' });
                resp.clone().blob().then(captureBlob).catch(function () {});
              }
            } catch (e) { /* ignore */ }
            return resp;
          });
        };
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__pieMethod = method;
          this.__pieUrl = url;
          maybeCaptureUrl(url, method);
          return origOpen.apply(this, arguments);
        };
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function () {
          this.addEventListener('load', function () {
            if (!window.__pieExcelCaptureActive) return;
            if (this.status < 200 || this.status >= 300) return;
            var reqUrl = this.__pieUrl || '';
            if (isDownloadExcelApi(reqUrl)) {
              try {
                var text = typeof this.responseText === 'string' ? this.responseText : '';
                var data = JSON.parse(text);
                if (data && data.success && data.result && data.result.url) {
                  post({ url: data.result.url, method: 'GET', excelApi: true });
                }
              } catch (e) { /* ignore */ }
              return;
            }
            var ct = this.getResponseHeader('content-type') || '';
            if (!isExcelContentType(ct)) return;
            if (this.response instanceof Blob) {
              captureBlob(this.response);
              return;
            }
            if (this.response instanceof ArrayBuffer) {
              post({ excelBuffer: this.response, blobType: ct });
            }
          });
          return origSend.apply(this, arguments);
        };
        var origCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = function (blob) {
          var url = origCreateObjectURL.apply(this, arguments);
          captureBlob(blob);
          return url;
        };
        var shouldBlockExcelNav = function (url) {
          if (!window.__pieExcelCaptureActive || !url) return false;
          return /\\.xlsx|pfs\\.yangkeduo\\.com|excellence-private/.test(String(url));
        };
        var origWinOpen = window.open;
        window.open = function (url) {
          if (shouldBlockExcelNav(url)) {
            post({ url: String(url), method: 'GET', excelApi: true });
            return null;
          }
          return origWinOpen.apply(this, arguments);
        };
        document.addEventListener('click', function (e) {
          if (!window.__pieExcelCaptureActive) return;
          var a = e.target && e.target.closest && e.target.closest('a[href]');
          if (!a || !shouldBlockExcelNav(a.href)) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          post({ url: a.href, method: 'GET', excelApi: true });
        }, true);
      })();
    `;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
  }

  function waitForExcelCaptureUrl(timeoutMs = 15000) {
    const uw = getUnsafeWindow();
    return new Promise((resolve) => {
      let timer = null;
      let best = null;
      let bestScore = -1;
      const isAcceptable = (item) => {
        if (!item) return false;
        if (item.blob) return true;
        if (item.fromExcelApi) return true;
        return isSkuExcelFileUrl(item.url);
      };
      const finish = () => {
        if (timer) clearTimeout(timer);
        uw.removeEventListener('message', onMessage);
        resolve(isAcceptable(best) ? best : null);
      };
      const onMessage = (event) => {
        if (event.source !== uw || !event.data || event.data.source !== EXCEL_HOOK_SOURCE) return;

        if (event.data.excelApi && event.data.url) {
          best = { url: event.data.url, method: 'GET', fromExcelApi: true };
          finish();
          return;
        }

        if (event.data.excelBuffer) {
          const blob = new Blob([event.data.excelBuffer], {
            type: event.data.blobType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
          validateExcelBlob(blob).then((ok) => {
            if (ok) {
              best = { blob, method: 'BLOB' };
              finish();
            }
          });
          return;
        }

        if (!event.data.url) return;
        const score = scoreExcelUrl(event.data.url);
        if (score < 0) return;
        if (score >= bestScore) {
          bestScore = score;
          best = { url: event.data.url, method: event.data.method || 'GET' };
          if (score >= 100) finish();
        }
      };
      uw.addEventListener('message', onMessage);
      timer = setTimeout(finish, timeoutMs);
    });
  }

  function tryInvokeReactOnClick(el) {
    let fiber = findReactFiber(el);
    for (let i = 0; i < 50 && fiber; i += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (!props?.onClick || typeof props.onClick !== 'function') continue;
      try {
        props.onClick({
          preventDefault() {},
          stopPropagation() {},
          nativeEvent: new MouseEvent('click'),
        });
        return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  function triggerSkuExcelExportClick(el) {
    const clickable = el.closest('a, button, [role="button"]') || el;
    try {
      scrollIntoViewIfNeeded(clickable);
    } catch {
      /* ignore */
    }
    const uw = getUnsafeWindow();
    if (tryInvokeReactOnClick(clickable)) return true;
    clickable.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: uw,
    }));
    if (typeof clickable.click === 'function') clickable.click();
    return true;
  }

  /** 弹窗内「导出当前规格数据」按钮 */
  function findSkuExcelModalExportButton() {
    const scopes = document.querySelectorAll(
      '[class*="Modal"], [role="dialog"], [class*="modal"], [class*="Drawer"]',
    );
    for (const scope of scopes) {
      if (scope.closest(`#${ROOT_ID}`)) continue;
      const scopeText = (scope.textContent || '').replace(/\s+/g, '');
      if (!/Excel批量编辑规格/.test(scopeText)) continue;
      const nodes = scope.querySelectorAll('button, a, [role="button"]');
      for (const node of nodes) {
        const text = (node.textContent || '').replace(/\s+/g, '');
        if (/导出当前规格数据/.test(text)) {
          return node.closest('button, a, [role="button"]') || node;
        }
      }
    }
    for (const node of document.querySelectorAll('button, a, [role="button"]')) {
      if (node.closest(`#${ROOT_ID}`)) continue;
      const text = (node.textContent || '').replace(/\s+/g, '');
      if (/导出当前规格数据/.test(text)) return node;
    }
    return null;
  }

  async function waitForSkuExcelModalExportButton(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const btn = findSkuExcelModalExportButton();
      if (btn) return btn;
      await sleep(200);
    }
    return null;
  }

  function closeSkuExcelModalIfOpen() {
    const scopes = document.querySelectorAll(
      '[class*="Modal"], [role="dialog"], [class*="modal"], [class*="Drawer"]',
    );
    for (const scope of scopes) {
      const scopeText = (scope.textContent || '').replace(/\s+/g, '');
      if (!/Excel批量编辑规格/.test(scopeText)) continue;
      const closeBtn = scope.querySelector(
        '[aria-label="关闭"], [aria-label="Close"], ' +
        'button[class*="close"], button[class*="Close"], [class*="modalClose"]',
      );
      if (closeBtn) {
        triggerSkuExcelExportClick(closeBtn);
        return;
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
  }

  async function captureSkuExcelViaModal() {
    installExcelCaptureHook();

    let exportBtn = findSkuExcelModalExportButton();
    if (!exportBtn) {
      const openEl = findSkuExcelExportElement();
      if (!openEl) return null;
      triggerSkuExcelExportClick(openEl);
      await sleep(600);
      exportBtn = await waitForSkuExcelModalExportButton(10000);
      if (!exportBtn) {
        closeSkuExcelModalIfOpen();
        return null;
      }
    }

    setExcelCaptureActive(true);
    let captured = null;
    try {
      const capturePromise = waitForExcelCaptureUrl(15000);
      await sleep(120);
      triggerSkuExcelExportClick(exportBtn);
      captured = await capturePromise;
    } finally {
      setExcelCaptureActive(false);
      await sleep(300);
      closeSkuExcelModalIfOpen();
    }

    if (captured?.blob) return captured;
    if (captured?.url) return captured;
    return null;
  }

  async function resolveSkuExcelDownloadUrl() {
    const modalResult = await captureSkuExcelViaModal();
    if (modalResult) return modalResult;
    return null;
  }

  async function buildSkuExcelDownloadTaskAsync() {
    const root = getPddExportRootFolder();
    if (!root) return null;
    const meta = await resolveSkuExcelDownloadUrl();
    if (!meta?.url && !meta?.blob) return null;

    if (meta.blob) {
      if (!(await validateExcelBlob(meta.blob))) return null;
    } else if (isSkuExcelApiUrl(meta.url) || !isSkuExcelFileUrl(meta.url)) {
      return null;
    }

    const task = {
      url: meta.url || '',
      method: meta.method || 'GET',
      name: joinDownloadPath(root, '成本表.xlsx'),
      isSkuExcel: true,
    };
    if (meta.blob) task.blob = meta.blob;
    return task;
  }

  function buildPddCategoryBatches(categoryKeys) {
    const batches = [];
    categoryKeys.forEach((key) => {
      const cat = PDD_CATEGORIES.find((c) => c.key === key);
      if (!cat) return;
      const items = images
        .filter((item) => item.moduleKey === key)
        .sort((a, b) => a.order - b.order);
      if (!items.length) return;
      batches.push({
        folder: withExportRoot(pddCategoryFolder(cat.label)),
        items,
      });
    });
    return batches;
  }

  async function exportPddCategories(categoryKeys, triggerBtn) {
    const needExcel = isFullPddExport(categoryKeys);
    const batches = buildPddCategoryBatches(categoryKeys);

    if (!batches.length && !needExcel) {
      showToast('暂无可导出内容');
      return;
    }

    if (categoryKeys.length === 1) {
      const cat = PDD_CATEGORIES.find((c) => c.key === categoryKeys[0]);
      if (cat) setFolderPreset(cat.label);
    }

    if (triggerBtn) triggerBtn.disabled = true;

    let rootDirHandle = null;
    if (canUseFileSystemAccess()) {
      try {
        showToast(SAVE_DIR_PICK_HINT);
        rootDirHandle = await ensureSaveDirectory(false);
      } catch {
        if (triggerBtn) triggerBtn.disabled = false;
        hideDownloadProgress();
        showToast('已取消：需选择保存目录才能按文件夹导出');
        return;
      }
    }

    let totalSuccess = 0;
    let totalFail = 0;
    const folderPaths = [];

    const imageTasks = buildDownloadTasksFromBatches(batches);
    const totalCount = imageTasks.length + (needExcel ? 1 : 0);
    const concurrency = rootDirHandle ? DOWNLOAD_CONCURRENCY : GM_DOWNLOAD_CONCURRENCY;

    updateDownloadProgress(0, totalCount);
    showToast(`正在下载 0/${totalCount}…`);

    if (imageTasks.length) {
      fsDirHandleCache.clear();
      const imgResult = await runDownloadTasksConcurrent(
        imageTasks,
        rootDirHandle,
        concurrency,
        (done) => {
          updateDownloadProgress(done, totalCount);
          showToast(`正在下载 ${done}/${totalCount}…`);
        },
      );
      totalSuccess += imgResult.success;
      totalFail += imgResult.fail;
      imageTasks.forEach((t) => {
        const slash = t.name.lastIndexOf('/');
        if (slash > 0) folderPaths.push(t.name.slice(0, slash));
      });
    }

    let excelMissing = false;
    if (needExcel) {
      updateDownloadProgress(imageTasks.length, totalCount);
      showToast(`正在下载 ${imageTasks.length}/${totalCount}…`);
      const excelTask = await buildSkuExcelDownloadTaskAsync();
      if (excelTask) {
        fsDirHandleCache.clear();
        const excelResult = await runDownloadTasksConcurrent(
          [excelTask],
          rootDirHandle,
          concurrency,
          () => {
            updateDownloadProgress(totalCount, totalCount);
            showToast(`正在下载 ${totalCount}/${totalCount}…`);
          },
        );
        totalSuccess += excelResult.success;
        totalFail += excelResult.fail;
        const slash = excelTask.name.lastIndexOf('/');
        if (slash > 0) folderPaths.push(excelTask.name.slice(0, slash));
      } else {
        excelMissing = true;
        totalFail += 1;
      }
    }

    let manifestWritten = false;
    if (needExcel && imageTasks.length) {
      try {
        const manifest = buildExportManifest(imageTasks, excelMissing);
        manifestWritten = await writeExportManifest(rootDirHandle, manifest);
      } catch {
        /* manifest 写入失败不阻断导出结果 */
      }
    }

    hideDownloadProgress();
    if (triggerBtn) triggerBtn.disabled = false;

    const uniqueFolders = [...new Set(folderPaths)];
    const folderHint = uniqueFolders.length <= 3
      ? uniqueFolders.join('、')
      : `${uniqueFolders.slice(0, 2).join('、')} 等 ${uniqueFolders.length} 个目录`;

    if (rootDirHandle) {
      let msg = `保存完成：成功 ${totalSuccess} 项，失败 ${totalFail} 项 → 已写入所选目录/${folderHint}`;
      if (manifestWritten) msg += '；已写入 manifest.json';
      if (excelMissing) msg += '（成本表获取失败，请手动导出）';
      showToast(msg);
      return;
    }

    let msg = `下载完成：成功 ${totalSuccess} 项，失败 ${totalFail} 项 → ${folderHint}`;
    if (manifestWritten) msg += '；已下载 manifest.json';
    if (totalFail > 0) {
      msg += '（若文件名仍为乱码，请重新下载并在弹窗中选择保存目录）';
    }
    if (excelMissing) msg += '（成本表获取失败，请手动导出）';
    showToast(msg);
  }

  function scrollIntoViewIfNeeded(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      return;
    } catch {
      /* Firefox 等不支持 instant */
    }
    try {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    } catch {
      el.scrollIntoView();
    }
  }

  function canUseFileSystemAccess() {
    return typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  }

  async function ensureSaveDirectory(forcePick) {
    if (saveDirHandle && !forcePick) return saveDirHandle;
    if (!canUseFileSystemAccess()) return null;
    saveDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    fsDirHandleCache.clear();
    return saveDirHandle;
  }

  async function resolveDirHandle(rootHandle, dirParts) {
    let dir = rootHandle;
    let key = '';
    for (const part of dirParts) {
      key = key ? `${key}/${part}` : part;
      const cached = fsDirHandleCache.get(key);
      if (cached) {
        dir = cached;
        continue;
      }
      dir = await dir.getDirectoryHandle(part, { create: true });
      fsDirHandleCache.set(key, dir);
    }
    return dir;
  }

  async function writeBlobToDir(rootHandle, relativePath, blob) {
    const parts = relativePath.split('/').filter(Boolean);
    if (!parts.length) throw new Error('empty path');
    const fileName = parts.pop();
    const dir = await resolveDirHandle(rootHandle, parts);
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  function gmDownloadBlob(blob, name) {
    return new Promise((resolve) => {
      if (typeof GM !== 'undefined' && typeof GM.download === 'function') {
        GM.download({
          url: blob,
          name,
          saveAs: false,
          conflictAction: 'overwrite',
        }).then(() => resolve(true)).catch(() => resolve(false));
        return;
      }
      GM_download({
        url: blob,
        name,
        saveAs: false,
        conflictAction: 'overwrite',
        onload: () => resolve(true),
        onerror: () => resolve(false),
        ontimeout: () => resolve(false),
      });
    });
  }

  async function downloadOneTask(task, rootDirHandle) {
    let blob = task.blob;
    if (!blob) {
      if (!task.url) return false;
      try {
        blob = await urlToBlob(task.url, task.method);
      } catch {
        return false;
      }
    }

    if (task.isSkuExcel && !(await validateExcelBlob(blob))) {
      return false;
    }

    if (rootDirHandle) {
      try {
        await writeBlobToDir(rootDirHandle, task.name, blob);
        return true;
      } catch {
        return false;
      }
    }

    const ok = await gmDownloadBlob(blob, task.name);
    if (GM_DOWNLOAD_GAP_MS > 0) await sleep(GM_DOWNLOAD_GAP_MS);
    return ok;
  }

  function urlToBlobViaXhr(url, method = 'GET') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method || 'GET',
        url,
        responseType: 'blob',
        onload(resp) {
          if (resp.status >= 200 && resp.status < 300 && resp.response) {
            resolve(resp.response);
            return;
          }
          reject(new Error(`HTTP ${resp.status}`));
        },
        onerror: () => reject(new Error('network')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  /** 优先 fetch（命中浏览器已加载缩略图缓存），失败再 GM_xhr */
  async function urlToBlob(url, method = 'GET') {
    if (url.startsWith('data:')) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('data fetch failed');
      return res.blob();
    }
    const m = (method || 'GET').toUpperCase();
    try {
      const res = await fetch(url, {
        method: m,
        credentials: 'include',
        cache: m === 'GET' ? 'force-cache' : 'no-cache',
      });
      if (res.ok) return res.blob();
    } catch {
      /* fallback xhr */
    }
    return urlToBlobViaXhr(url, m);
  }

  async function runDownloadTasksConcurrent(tasks, rootDirHandle, concurrency, onProgress) {
    let cursor = 0;
    let done = 0;
    let success = 0;
    let fail = 0;

    const worker = async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        const ok = await downloadOneTask(tasks[index], rootDirHandle);
        if (ok) success += 1;
        else fail += 1;
        done += 1;
        onProgress(done, tasks.length);
      }
    };

    const poolSize = Math.max(1, Math.min(concurrency, tasks.length));
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    return { success, fail };
  }

  async function downloadItemsMulti(batches, triggerBtn, extraTasks = []) {
    const tasks = [
      ...buildDownloadTasksFromBatches(batches),
      ...(extraTasks || []).filter(Boolean),
    ];

    if (!tasks.length) {
      showToast('没有可下载的内容');
      return;
    }

    let rootDirHandle = null;
    let usedFsApi = false;
    fsDirHandleCache.clear();

    if (triggerBtn) triggerBtn.disabled = true;

    if (canUseFileSystemAccess()) {
      try {
        showToast(SAVE_DIR_PICK_HINT);
        rootDirHandle = await ensureSaveDirectory(false);
        usedFsApi = true;
      } catch {
        if (triggerBtn) triggerBtn.disabled = false;
        hideDownloadProgress();
        showToast('已取消：需选择保存目录才能按文件夹导出');
        return;
      }
    }

    updateDownloadProgress(0, tasks.length);
    showToast(`正在下载 0/${tasks.length}…`);

    const concurrency = rootDirHandle ? DOWNLOAD_CONCURRENCY : GM_DOWNLOAD_CONCURRENCY;
    const { success, fail } = await runDownloadTasksConcurrent(
      tasks,
      rootDirHandle,
      concurrency,
      (done, total) => {
        updateDownloadProgress(done, total);
        showToast(`正在下载 ${done}/${total}…`);
      },
    );

    hideDownloadProgress();

    if (triggerBtn) triggerBtn.disabled = false;
    const folderPaths = [...new Set(tasks.map((t) => {
      const slash = t.name.lastIndexOf('/');
      return slash > 0 ? t.name.slice(0, slash) : t.name;
    }))];
    const folderHint = folderPaths.length <= 3
      ? folderPaths.join('、')
      : `${folderPaths.slice(0, 2).join('、')} 等 ${folderPaths.length} 个目录`;

    if (usedFsApi && rootDirHandle) {
      showToast(`保存完成：成功 ${success} 项，失败 ${fail} 项 → 已写入所选目录/${folderHint}`);
      return;
    }

    let msg = `下载完成：成功 ${success} 项，失败 ${fail} 项 → ${folderHint}`;
    if (fail > 0 || !usedFsApi) {
      msg += '（若文件名仍为乱码，请重新下载并在弹窗中选择保存目录）';
    }
    showToast(msg);
  }

  /** 各类目内：已选图片按 DOM 顺序编号 1,2,3…（与下载文件名一致） */
  function getSelectionOrderMap() {
    const map = new Map();
    groupImagesByModule(images).forEach((group) => {
      let seq = 0;
      group.items.forEach((item) => {
        if (!item.selected) return;
        seq += 1;
        map.set(item, seq);
      });
    });
    return map;
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
        position: relative;
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
      #${ROOT_ID} .pie-quick-export-btn {
        box-sizing: border-box; display: inline-flex !important; align-items: center;
        padding: 8px 14px; border: 1px solid #2563eb; border-radius: 6px;
        font-size: 13px; line-height: 1.3; cursor: pointer; user-select: none; white-space: nowrap;
        flex: 0 0 auto;
      }
      #${ROOT_ID} .pie-quick-export-all {
        background: #fff; color: #111827; border-color: #2563eb;
      }
      #${ROOT_ID} .pie-quick-export-all:hover { background: #eff6ff; color: #111827; }
      #${ROOT_ID} .pie-quick-export-all:disabled { opacity: .6; cursor: not-allowed; }
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
      #${ROOT_ID} .pie-download-progress {
        position: absolute; inset: 0; z-index: 20;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255, 255, 255, 0.88);
        opacity: 0; visibility: hidden;
        transition: opacity .22s ease, visibility .22s ease;
        pointer-events: none;
      }
      #${ROOT_ID} .pie-download-progress.visible {
        opacity: 1; visibility: visible; pointer-events: auto;
      }
      #${ROOT_ID} .pie-progress-ring {
        position: relative; width: 108px; height: 108px;
      }
      #${ROOT_ID} .pie-progress-ring svg {
        width: 100%; height: 100%; transform: rotate(-90deg);
      }
      #${ROOT_ID} .pie-progress-track {
        fill: none; stroke: #e5e7eb; stroke-width: 7;
      }
      #${ROOT_ID} .pie-progress-bar {
        fill: none; stroke: #2563eb; stroke-width: 7;
        stroke-linecap: round;
        transition: stroke-dashoffset .28s ease;
      }
      #${ROOT_ID} .pie-progress-text {
        position: absolute; inset: 0;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        pointer-events: none;
      }
      #${ROOT_ID} .pie-progress-count {
        font-size: 20px; font-weight: 700; color: #111827; line-height: 1.15;
        font-variant-numeric: tabular-nums;
      }
      #${ROOT_ID} .pie-progress-label {
        font-size: 12px; color: #6b7280; margin-top: 4px;
      }
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

  const PROGRESS_RING_R = 34;
  const PROGRESS_RING_C = 2 * Math.PI * PROGRESS_RING_R;

  function ensureDownloadProgressLayer() {
    const panel = document.querySelector(`#${ROOT_ID} .pie-panel`);
    if (!panel) return null;

    let layer = panel.querySelector('.pie-download-progress');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.className = 'pie-download-progress';
    layer.innerHTML = [
      '<div class="pie-progress-ring">',
      '<svg viewBox="0 0 80 80" aria-hidden="true">',
      `<circle class="pie-progress-track" cx="40" cy="40" r="${PROGRESS_RING_R}" />`,
      `<circle class="pie-progress-bar" cx="40" cy="40" r="${PROGRESS_RING_R}"`,
      ` stroke-dasharray="${PROGRESS_RING_C}" stroke-dashoffset="${PROGRESS_RING_C}" />`,
      '</svg>',
      '<div class="pie-progress-text">',
      '<span class="pie-progress-count">0/0</span>',
      '<span class="pie-progress-label">下载中</span>',
      '</div>',
      '</div>',
    ].join('');
    panel.appendChild(layer);
    return layer;
  }

  function updateDownloadProgress(done, total) {
    const layer = ensureDownloadProgressLayer();
    if (!layer) return;

    const safeTotal = Math.max(0, total);
    const safeDone = Math.min(Math.max(0, done), safeTotal);
    const pct = safeTotal > 0 ? safeDone / safeTotal : 0;

    layer.classList.add('visible');
    const bar = layer.querySelector('.pie-progress-bar');
    const count = layer.querySelector('.pie-progress-count');
    if (bar) bar.style.strokeDashoffset = `${PROGRESS_RING_C * (1 - pct)}`;
    if (count) count.textContent = `${safeDone}/${safeTotal}`;
  }

  function hideDownloadProgress() {
    const layer = document.querySelector(`#${ROOT_ID} .pie-download-progress`);
    if (layer) layer.classList.remove('visible');
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
          ? withExportRoot(pddCategoryFolder(group.label))
          : sanitizePathPart((folderInput && folderInput.value.trim()) || group.label, group.label);
        if (!folder) {
          showToast('请先填写文件夹名');
          if (folderInput) folderInput.focus();
          return;
        }
        if (isPddCategory) setFolderPreset(pddCategoryFolder(group.label));
        const selectedInGroup = group.items.filter((item) => item.selected);
        const toDownload = selectedInGroup.length > 0 ? selectedInGroup : group.items;
        downloadItems(toDownload, folder, sectionDownloadAllBtn);
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
        `<div class="pie-status" style="padding:24px">正在展开 SKU 表格并等待加载完成…</div>`,
        `</div></div>`,
      ].join('');
      await expandPddSkuTable();
      root.innerHTML = '';
    }

    images = await discoverImages();
    pddExportRoot = isPddMmsPage() ? resolvePddExportRoot() : null;

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

    let quickExportBtn = null;
    if (isPddMmsPage()) {
      quickExportBtn = document.createElement('button');
      quickExportBtn.type = 'button';
      quickExportBtn.className = 'pie-quick-export-btn pie-quick-export-all';
      quickExportBtn.textContent = '一键导出';
      quickExportBtn.title = '导出轮播图、详情图、预览图';
      quickExportBtn.addEventListener('click', () => {
        exportPddCategories(PDD_CATEGORY_ORDER, quickExportBtn);
      });
    }

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
      hideDownloadProgress();
      root.innerHTML = '';
      panelFolderInput = null;
      panelSyncPresets = null;
      saveDirHandle = null;
      pddExportRoot = null;
      fsDirHandleCache.clear();
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

      const pddBatches = batches.filter(
        (b) => b.items.length > 0 && isPddPresetCategory(b.items[0].moduleKey),
      );
      if (pddBatches.length === 1 && batches.length === 1) {
        setFolderPreset(pddBatches[0].folder);
      }

      downloadItemsMulti(batches, downloadBtn);
    });

    header.appendChild(title);
    header.appendChild(folderInput);
    header.appendChild(presets);
    if (quickExportBtn) header.appendChild(quickExportBtn);
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
    if (isPddMmsPage()) installExcelCaptureHook();

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
