// ==UserScript==
// @name         价格计算器
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.6.4
// @description  拼多多商家后台 SKU 拼单价/单买价计算器，支持活动叠加、投产比与 Markdown 导入导出
// @author       script_fun
// @match        *://mms.pinduoduo.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROOT_ID = 'pc-root';
  const FAB_POS_KEY = 'pc_fab_pos';
  const PASTE_SPLIT = /[\s,;，；\t\n\r]+/;
  const EXPORT_VERSION = 'v1';

  const STYLE_HEADER_NAMES = new Set([
    '款式', '颜色', '尺寸', '型号', '器型', '材质', '口味', '色号', '适用人群',
    '容量', '花型', '尺码', '地点', '包装方式', '香型', '货号', '组合', '成份',
    '版本', '度数', '运营商', '属性', '重量', '地区', '套餐', '类别', '适用年龄',
    '功效', '品类', '时间', '规格',
  ]);

  const DEFAULTS = {
    freight: 0,
    returnRate: 20,
    targetMargin: 20,
    platformFee: 0.6,
  };

  const IMPORT_FIELD_MAP = {
    款式: 'style',
    采购成本: 'cost',
    运费: 'freight',
    退货率: 'returnRate',
    平台扣点: 'platformFee',
    目标利润率: 'targetMargin',
  };

  /** @type {SkuRow[]} */
  let rows = [];

  /** @type {{ coupon: { amount: number }, timeLimit: { type: '立减'|'打折', value: number } }} */
  let globalActivities = createDefaultActivities();

  let suppressCostInput = false;
  /** SKU 行高（px），用于虚拟表展开高度：count × 行高 */
  const SKU_ROW_HEIGHT_PX = 70;
  /** 事件回填兜底：每批行数与让出间隔 */
  const FILL_BATCH_SIZE = 1;
  const FILL_YIELD_MS = 80;
  let fillBackRunning = false;
  /** @type {HTMLButtonElement|null} */
  let fillBtnRef = null;

  /** @typedef {{ style: string, groupInput: HTMLInputElement, singleInput: HTMLInputElement, rowIndex: number, cost: string, freight: number, returnRate: number, targetMargin: number, platformFee: number, singleRandomOffset: number, actualCost: number|null, actualGroupPrice: number|null, groupPrice: number|null, singlePrice: number|null, actualProfit: number|null, marginRate: number|null, netBreakEvenRoi: number|null, microPaidRoi: number|null, optimalRoi: number|null }} SkuRow */

  function createDefaultActivities() {
    return {
      coupon: { amount: 0 },
      timeLimit: { type: '打折', value: 85 },
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 在 table 内部查询行（不可带 #sku 前缀） */
  const SKU_ROW_IN_TABLE = 'tbody tr[class*="TB_tr"], tbody [data-testid="beast-core-table-body-tr"]';

  /**
   * 定位内层滚动容器（不是 TB_innerMiddle）：
   * TB_body >
   *   <div style="max-height:820px;height:820px;overflow-y:scroll">  ← 改这里
   *     <div style="padding-top/bottom">
   *       <table.TB_tableWrapper>
   */
  function getSkuScrollViewport() {
    const skuRoot = document.querySelector('#sku, #goods-spec-sku');
    if (!skuRoot || skuRoot.closest(`#${ROOT_ID}`)) return null;

    const body = skuRoot.querySelector(
      '[data-testid="beast-core-table-middle-body"], [class*="TB_body"]',
    );
    if (!body || body.closest(`#${ROOT_ID}`)) return null;

    // 只认 TB_body 的直接子节点里包着 table 的那个滚动层
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

    // 兜底：TB_body 下第一个包含 table 的直接子 div
    return Array.from(body.children).find(
      (child) => child.querySelector('table[class*="TB_tableWrapper"]'),
    ) || null;
  }

  function getSkuSpacer(viewport) {
    if (!viewport) return null;
    const direct = viewport.querySelector(':scope > div');
    if (direct && direct.querySelector('table[class*="TB_tableWrapper"]')) return direct;
    const table = viewport.querySelector('table[class*="TB_tableWrapper"]');
    return table ? table.parentElement : null;
  }

  function clearSkuSpacer(viewport) {
    const spacer = getSkuSpacer(viewport);
    if (!spacer) return;
    spacer.style.paddingTop = '0px';
    spacer.style.paddingBottom = '0px';
  }

  /** 虚拟总高度 = paddingTop + 行高 + paddingBottom（滚动测量用） */
  function measureVirtualContentHeight(viewport) {
    const spacer = getSkuSpacer(viewport);
    const table = viewport.querySelector('table[class*="TB_tableWrapper"]') || viewport;
    const trs = table.querySelectorAll(SKU_ROW_IN_TABLE);
    let rowsH = 0;
    trs.forEach((row) => { rowsH += row.getBoundingClientRect().height || 0; });
    if (rowsH < 1 && trs.length > 0) rowsH = trs.length * SKU_ROW_HEIGHT_PX;

    const pt = spacer ? (parseFloat(spacer.style.paddingTop) || 0) : 0;
    const pb = spacer ? (parseFloat(spacer.style.paddingBottom) || 0) : 0;
    return Math.max(pt + rowsH + pb, viewport.scrollHeight, table.scrollHeight || 0, rowsH);
  }

  /** 优先 React tableList 长度，其次已扫描 rows / 当前 DOM 行数 */
  function getSkuCountHint() {
    try {
      const inst = findSkuBatchInstance();
      if (inst?.props?.sku?.tableList?.length) return inst.props.sku.tableList.length;
    } catch {
      /* ignore */
    }
    if (rows.length > 0) return rows.length;
    const viewport = getSkuScrollViewport();
    if (!viewport) return 0;
    return viewport.querySelectorAll(SKU_ROW_IN_TABLE).length;
  }

  /**
   * 展开虚拟 SKU 表（初始化/刷新用）：
   * 1) 先在 820px 高度下反复滚到底，唤醒虚拟列表并测量
   * 2) 再把高度设为 tableList 数量×70（无数量时用测量值），并清 spacer
   * 注意：只改高度不清滚动挂载，会出现「只有几行 + 大片空白」
   */
  async function loadAllVirtualSkuRows() {
    const viewport = getSkuScrollViewport();
    if (!viewport) return;

    const countHint = getSkuCountHint();
    if (viewport.dataset.pcSkuExpanded === '1') {
      const mounted = viewport.querySelectorAll(SKU_ROW_IN_TABLE).length;
      if (countHint > 0 && mounted >= countHint) return;
      if (countHint < 1 && mounted > 0
        && viewport.clientHeight >= measureVirtualContentHeight(viewport) - 4) {
        return;
      }
    }
    delete viewport.dataset.pcSkuExpanded;

    // 阶段1：保持可滚动，滚到底唤醒虚拟列表
    viewport.style.maxHeight = '820px';
    viewport.style.height = '820px';
    viewport.style.overflowY = 'scroll';

    let maxH = 0;
    let lastScrollH = 0;
    let stable = 0;
    for (let i = 0; i < 120; i += 1) {
      viewport.scrollTop = viewport.scrollHeight;
      await sleep(40);
      maxH = Math.max(maxH, measureVirtualContentHeight(viewport));
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

    // 阶段2：有 tableList/扫描数量时用 N×70；否则用滚动测量值
    const count = getSkuCountHint();
    const mounted = viewport.querySelectorAll(SKU_ROW_IN_TABLE).length;
    const n = count > 0 ? count : Math.max(mounted, 1);
    const byCount = n * SKU_ROW_HEIGHT_PX;
    let finalH = count > 0
      ? Math.ceil(Math.max(byCount, 820) + 40)
      : Math.ceil(Math.max(maxH, byCount, 820) + 40);

    viewport.style.maxHeight = `${finalH}px`;
    viewport.style.height = `${finalH}px`;
    viewport.style.overflowY = 'scroll';
    clearSkuSpacer(viewport);

    viewport.scrollTop = 0;
    await sleep(120);
    viewport.scrollTop = viewport.scrollHeight;
    await sleep(80);
    clearSkuSpacer(viewport);

    if (count < 1) {
      maxH = Math.max(maxH, measureVirtualContentHeight(viewport));
      if (maxH + 40 > finalH) {
        finalH = Math.ceil(maxH + 40);
        viewport.style.maxHeight = `${finalH}px`;
        viewport.style.height = `${finalH}px`;
      }
      clearSkuSpacer(viewport);
    }

    viewport.scrollTop = 0;
    clearSkuSpacer(viewport);
    viewport.dataset.pcSkuExpanded = '1';
  }

  /** 回填写入 tableList 后点击页脚「保存草稿」，让后台提交模型中的新价格 */
  function clickSaveDraftButton() {
    const footer = document.querySelector('#goods_create .goods-footer-main')
      || document.querySelector('.goods-footer-main');
    if (!footer) return false;
    const btn = [...footer.querySelectorAll('button, [role="button"], a, span')].find((el) => {
      const text = (el.textContent || '').replace(/\s+/g, '');
      return text === '保存草稿' || /^保存草稿/.test(text);
    });
    if (!btn) return false;
    const clickable = btn.closest('button') || btn;
    clickable.click();
    return true;
  }

  function findReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
    );
    return key ? el[key] : null;
  }

  /** 定位带 props.sku.tableList 的批量设置组件实例 */
  function findSkuBatchInstance() {
    const wrap = document.querySelector('#sku .batch-wrap')
      || document.querySelector('.sku-batch .batch-wrap')
      || document.querySelector('[data-testid="batch-set"]')
      || document.querySelector('.batch-wrap');
    if (!wrap) return null;
    const btn = [...wrap.querySelectorAll('button')].find((el) => /批量设置/.test(el.textContent || ''));
    let fiber = findReactFiber(btn) || findReactFiber(wrap);
    for (let i = 0; i < 40 && fiber; i += 1, fiber = fiber.return) {
      const node = fiber.stateNode;
      if (node && node.props && node.props.sku && Array.isArray(node.props.sku.tableList)) {
        return node;
      }
    }
    return null;
  }

  function normalizeStyleKey(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function styleKeyFromSpec(spec) {
    if (!Array.isArray(spec)) return '';
    return normalizeStyleKey(spec
      .map((s) => (s && (s.v_value || s.spec_value || s.value || s.spec_name || '')) || '')
      .map((t) => String(t).trim())
      .filter(Boolean)
      .join(' / '));
  }

  function yuanToFen(yuan) {
    return Math.round(Number(yuan) * 100);
  }

  /**
   * 通过 React sku.tableList 批量写价格（分）。
   * @returns {{ success: number, fail: number, count: number } | null}
   */
  function fillBackViaTableList(targets) {
    const inst = findSkuBatchInstance();
    const srcList = inst?.props?.sku?.tableList;
    if (!inst || !Array.isArray(srcList) || srcList.length === 0) return null;

    const list = JSON.parse(JSON.stringify(srcList));
    /** @type {Map<string, number>} */
    const indexByStyle = new Map();
    list.forEach((item, idx) => {
      const key = styleKeyFromSpec(item.spec);
      if (key && !indexByStyle.has(key)) indexByStyle.set(key, idx);
    });

    let success = 0;
    let fail = 0;
    const allowIndexFallback = list.length === rows.length || list.length === targets.length;
    targets.forEach((row, targetIdx) => {
      let idx = indexByStyle.get(normalizeStyleKey(row.style));
      if (idx == null && allowIndexFallback) {
        if (row.rowIndex >= 0 && row.rowIndex < list.length) idx = row.rowIndex;
        else if (targetIdx < list.length) idx = targetIdx;
      }
      if (idx == null) {
        fail += 1;
        return;
      }
      list[idx].multi_price = yuanToFen(row.groupPrice);
      list[idx].price = yuanToFen(row.singlePrice);
      list[idx].multi_price_in_yuan = null;
      list[idx].price_in_yuan = null;
      list[idx].forceUpdate = true;
      success += 1;
    });

    inst.props.sku.tableList = list;
    try {
      if (typeof inst.forceUpdate === 'function') inst.forceUpdate();
    } catch {
      /* ignore */
    }
    try {
      if (typeof inst.setState === 'function') inst.setState({ __pcFillTick: Date.now() });
    } catch {
      /* ignore */
    }

    return { success, fail, count: list.length };
  }

  let skuExpandTimer = null;
  let skuExpandRunning = false;

  function scheduleSkuTableExpand() {
    if (skuExpandTimer) clearTimeout(skuExpandTimer);
    skuExpandTimer = setTimeout(async () => {
      if (skuExpandRunning) return;
      const viewport = getSkuScrollViewport();
      if (!viewport) return;
      skuExpandRunning = true;
      try {
        await loadAllVirtualSkuRows();
      } finally {
        skuExpandRunning = false;
      }
    }, 400);
  }

  /** 页面加载完成后自动展开虚拟 SKU 表格 */
  function initSkuTableExpandOnLoad() {
    const run = () => scheduleSkuTableExpand();
    run();
    [1000, 2500, 5000, 10000].forEach((ms) => setTimeout(run, ms));
    if (document.readyState !== 'complete') {
      window.addEventListener('load', run, { once: true });
    }

    const observer = new MutationObserver(() => {
      if (getSkuScrollViewport() && !skuExpandRunning) scheduleSkuTableExpand();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function parseNum(val) {
    const n = parseFloat(String(val).trim());
    return Number.isFinite(n) ? n : NaN;
  }

  function clampPercent(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
  }

  function pctToDecimal(pct) {
    return clampPercent(pct) / 100;
  }

  /** 目标利润率：仅限制 ≥0，不封顶 100% */
  function targetMarginToDecimal(pct) {
    const n = parseNum(pct);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n / 100;
  }

  function randomSingleOffset() {
    return round2(3 + Math.random() * 2);
  }

  function calcSinglePrice(basePrice, couponAmount, timeLimitAdd, offset) {
    return round2(basePrice * 1.1 + couponAmount + timeLimitAdd + offset);
  }

  function applyTimeLimit(pin0, timeLimit) {
    if (!timeLimit || !(timeLimit.value > 0)) return pin0;
    const v = Math.max(0, timeLimit.value || 0);
    if (timeLimit.type === '立减') return round2(pin0 + v);
    const payRate = clampPercent(v) / 100;
    if (payRate <= 0) return pin0;
    return round2(pin0 / payRate);
  }

  function emptyCalcResult() {
    return {
      actualCost: null,
      actualGroupPrice: null,
      groupPrice: null,
      singlePrice: null,
      actualProfit: null,
      marginRate: null,
      netBreakEvenRoi: null,
      microPaidRoi: null,
      optimalRoi: null,
    };
  }

  function calcRow(row, activities) {
    const C = parseNum(row.cost);
    const E = parseNum(row.freight);
    const G = pctToDecimal(row.returnRate);
    const I = pctToDecimal(row.platformFee);
    const J = targetMarginToDecimal(row.targetMargin);

    if (!(C > 0) || !Number.isFinite(E) || E < 0) return emptyCalcResult();

    const actualCost = round2(C + E);
    const actualGroupPrice = round2(actualCost * (1 + J));

    const couponAmount = Math.max(0, activities.coupon?.amount || 0);
    const pin0 = round2(actualGroupPrice + couponAmount);
    const groupPrice = applyTimeLimit(pin0, activities.timeLimit);
    const timeLimitAdd = round2(Math.max(0, groupPrice - pin0));
    const singlePrice = calcSinglePrice(
      actualGroupPrice,
      couponAmount,
      timeLimitAdd,
      row.singleRandomOffset,
    );

    const actualProfit = round2(actualGroupPrice * (1 - I) - C - E);

    let marginRate = null;
    let netBreakEvenRoi = null;
    let microPaidRoi = null;
    let optimalRoi = null;

    if (actualCost > 0) {
      marginRate = round2((actualProfit / actualCost) * 100);
    }

    if (actualProfit > 0 && actualGroupPrice > 0 && G < 1) {
      netBreakEvenRoi = round2((actualGroupPrice / actualProfit) / (1 - G));
      microPaidRoi = round2(netBreakEvenRoi / 2 + 0.5);
      const coef = marginRate != null && marginRate > 50 ? 1.4 : 2;
      optimalRoi = round2(netBreakEvenRoi * coef);
    }

    return {
      actualCost,
      actualGroupPrice,
      groupPrice,
      singlePrice,
      actualProfit,
      marginRate,
      netBreakEvenRoi,
      microPaidRoi,
      optimalRoi,
    };
  }

  function applyCalcResult(row, r) {
    row.actualCost = r.actualCost;
    row.actualGroupPrice = r.actualGroupPrice;
    row.groupPrice = r.groupPrice;
    row.singlePrice = r.singlePrice;
    row.actualProfit = r.actualProfit;
    row.marginRate = r.marginRate;
    row.netBreakEvenRoi = r.netBreakEvenRoi;
    row.microPaidRoi = r.microPaidRoi;
    row.optimalRoi = r.optimalRoi;
  }

  function normalizeHeaderText(text) {
    return String(text || '').replace(/\*/g, '').replace(/\s+/g, '').trim();
  }

  function normalizeImportHeader(text) {
    return String(text || '')
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function getRowCells(row) {
    return [...row.querySelectorAll('th, td')];
  }

  function cellText(cell) {
    return normalizeHeaderText(cell.textContent);
  }

  function findInputInCell(cell) {
    return cell.querySelector('input');
  }

  function findPriceInputInCell(cell) {
    const priceInput = cell.querySelector('.sku-beast-price-input-container input');
    if (priceInput) return priceInput;
    return findInputInCell(cell);
  }

  function isStyleHeader(text) {
    return STYLE_HEADER_NAMES.has(text);
  }

  function extractStyleFromCell(cell) {
    const title = cell.querySelector('.sku-row-title');
    if (title) return (title.textContent || '').replace(/\s+/g, ' ').trim();
    return (cell.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function getRowColumnOffset(headerCellCount, rowCellCount) {
    return Math.max(0, headerCellCount - rowCellCount);
  }

  function getCellAt(cells, headerIndex, offset) {
    const index = headerIndex - offset;
    if (index < 0 || index >= cells.length) return null;
    return cells[index];
  }

  function detectHeaderColumns(cells) {
    const texts = cells.map(cellText);
    const styleCols = texts.reduce((acc, t, i) => {
      if (isStyleHeader(t)) acc.push(i);
      return acc;
    }, []);
    const groupCol = texts.findIndex((t) => t.includes('拼单价'));
    const singleCol = texts.findIndex((t) => t.includes('单买价'));
    if (styleCols.length === 0 || groupCol < 0) return null;
    return {
      styleCols,
      groupCol,
      singleCol: singleCol >= 0 ? singleCol : groupCol + 1,
      headerCellCount: cells.length,
    };
  }

  function extractStyleFromRow(cells, styleCols, offset, carry) {
    const parts = [];
    styleCols.forEach((colIndex) => {
      const cell = getCellAt(cells, colIndex, offset);
      let text = cell ? extractStyleFromCell(cell) : '';
      if (text) carry[colIndex] = text;
      else if (carry[colIndex]) text = carry[colIndex];
      if (text) parts.push(text);
    });
    return parts.join(' / ');
  }

  function findPriceInputsInRow(row, cells, cols, offset) {
    const priceInputs = row.querySelectorAll('.sku-beast-price-input-container input');
    let groupInput = priceInputs[0] || null;
    let singleInput = priceInputs[1] || null;
    if (!groupInput) {
      const groupCell = getCellAt(cells, cols.groupCol, offset);
      groupInput = groupCell ? findPriceInputInCell(groupCell) : null;
    }
    if (!singleInput && cols.singleCol >= 0) {
      const singleCell = getCellAt(cells, cols.singleCol, offset);
      singleInput = singleCell ? findPriceInputInCell(singleCell) : null;
    }
    return { groupInput, singleInput };
  }

  function buildSkuRow(style, groupInput, singleInput, rowIndex) {
    const groupPriceVal = parseNum(groupInput?.value);
    const cost = Number.isFinite(groupPriceVal) && groupPriceVal > 0 ? String(groupPriceVal) : '';
    return {
      style,
      groupInput,
      singleInput,
      rowIndex,
      cost,
      freight: DEFAULTS.freight,
      returnRate: DEFAULTS.returnRate,
      targetMargin: DEFAULTS.targetMargin,
      platformFee: DEFAULTS.platformFee,
      singleRandomOffset: randomSingleOffset(),
      actualCost: null,
      actualGroupPrice: null,
      groupPrice: null,
      singlePrice: null,
      actualProfit: null,
      marginRate: null,
      netBreakEvenRoi: null,
      microPaidRoi: null,
      optimalRoi: null,
    };
  }

  function extractSkuRowsFromBody(cols, bodyRows) {
    const carry = {};
    const result = [];
    bodyRows.forEach((row) => {
      const cells = getRowCells(row);
      const offset = getRowColumnOffset(cols.headerCellCount, cells.length);
      const style = extractStyleFromRow(cells, cols.styleCols, offset, carry);
      const { groupInput, singleInput } = findPriceInputsInRow(row, cells, cols, offset);
      if (!style || !groupInput) return;
      result.push(buildSkuRow(style, groupInput, singleInput, result.length));
    });
    return result;
  }

  function scanSkuContainer(container) {
    const headerRow = container.querySelector('[data-testid="beast-core-table-header-tr"]')
      || container.querySelector('thead tr');
    if (!headerRow) return [];

    const cols = detectHeaderColumns(getRowCells(headerRow));
    if (!cols) return [];

    const bodyRows = container.querySelectorAll(
      'tbody tr[class*="TB_tr"], [data-testid="beast-core-table-body-tr"], tbody tr',
    );
    return extractSkuRowsFromBody(cols, bodyRows);
  }

  function collectSkuContainers() {
    const selectors = [
      '#sku',
      '#goods-spec-sku',
      '[data-e2e-id="e2e-sku-table"]',
      '.sku-list',
      '[data-testid="beast-core-table"]',
    ];
    const raw = [];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.closest(`#${ROOT_ID}`)) return;
        raw.push(el);
      });
    });
    return raw.filter((el) => !raw.some((other) => other !== el && other.contains(el)));
  }

  function scanTableElement(table) {
    const trs = [...table.querySelectorAll('tr')];
    let headerIndex = -1;
    let cols = null;

    for (let i = 0; i < trs.length; i += 1) {
      const detected = detectHeaderColumns(getRowCells(trs[i]));
      if (detected) {
        headerIndex = i;
        cols = detected;
        break;
      }
    }

    if (headerIndex < 0 || !cols) return [];
    return extractSkuRowsFromBody(cols, trs.slice(headerIndex + 1));
  }

  function scanSkuTable() {
    const candidates = [];

    collectSkuContainers().forEach((container) => {
      const scanned = scanSkuContainer(container);
      if (scanned.length > 0) candidates.push(scanned);
    });

    document.querySelectorAll('table').forEach((table) => {
      if (table.closest(`#${ROOT_ID}`)) return;
      const scanned = scanTableElement(table);
      if (scanned.length > 0) candidates.push(scanned);
    });

    document.querySelectorAll('[role="table"]').forEach((table) => {
      if (table.closest(`#${ROOT_ID}`)) return;
      const scanned = scanTableElement(table);
      if (scanned.length > 0) candidates.push(scanned);
    });

    if (candidates.length === 0) return [];
    return candidates.reduce((best, cur) => (cur.length > best.length ? cur : best));
  }

  function getGoodsMeta() {
    let goodsId = 'unknown';
    try {
      const url = new URL(window.location.href);
      for (const key of ['goods_id', 'id', 'goodsId']) {
        const v = url.searchParams.get(key);
        if (v) {
          goodsId = v;
          break;
        }
      }
      if (goodsId === 'unknown') {
        const m = url.pathname.match(/(\d{8,})/);
        if (m) goodsId = m[1];
      }
    } catch {
      /* ignore */
    }

    const titleInput = document.querySelector('#basic\\.goods_name input[type="text"]');
    if (goodsId === 'unknown' && titleInput) {
      const tp = titleInput.getAttribute('data-tracking-params') || '';
      const m = tp.match(/goods_id_page=(\d+)/);
      if (m) goodsId = m[1];
    }

    const goodsTitle = titleInput?.value?.trim() || '未命名商品';
    return { goodsId, goodsTitle };
  }

  function sanitizeFilename(name) {
    return String(name).replace(/[/\\:*?"<>|]/g, '-').slice(0, 80);
  }

  function formatNum(val) {
    return val != null && Number.isFinite(val) ? val.toFixed(2) : '—';
  }

  function formatPct(val) {
    return val != null && Number.isFinite(val) ? `${val}%` : '—';
  }

  function escapeMdCell(text) {
    return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function buildExportMarkdown() {
    const { goodsId, goodsTitle } = getGoodsMeta();
    const lines = [
      `# ${goodsId}-${goodsTitle}`,
      '',
      `<!-- price-calculator-export ${EXPORT_VERSION} -->`,
      `<!-- goods_id: ${goodsId} -->`,
      '',
      '## 活动配置',
      '',
      '| 配置项 | 值 |',
      '| --- | --- |',
      `| 立减优惠券（元） | ${globalActivities.coupon.amount} |`,
      `| 限时限量购类型 | ${globalActivities.timeLimit.type} |`,
      `| 限时限量购值 | ${globalActivities.timeLimit.value} |`,
      '',
      '## SKU 定价',
      '',
      '| 款式 | 采购成本（元） | 运费（元） | 退货率（%） | 平台扣点（%） | 目标利润率（%） | 实际成本（元） | 实际利润率（%） | 实际利润（元） | 净保本投产比 | 微付费投产比 | 最佳投产比 | 实际拼单价（元） | 拼单价（元） | 单买价（元） |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    rows.forEach((row) => {
      lines.push([
        escapeMdCell(row.style),
        row.cost || '',
        row.freight,
        row.returnRate,
        row.platformFee,
        row.targetMargin,
        formatNum(row.actualCost),
        formatPct(row.marginRate),
        formatNum(row.actualProfit),
        formatNum(row.netBreakEvenRoi),
        formatNum(row.microPaidRoi),
        formatNum(row.optimalRoi),
        formatNum(row.actualGroupPrice),
        formatNum(row.groupPrice),
        formatNum(row.singlePrice),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    });

    return { markdown: lines.join('\n'), goodsId, goodsTitle };
  }

  function parseMarkdownTable(sectionText) {
    const lines = sectionText.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
    if (lines.length < 2) return null;

    const splitRow = (line) => line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim().replace(/\\(.)/g, '$1'));

    const headers = splitRow(lines[0]);
    const dataRows = [];
    for (let i = 2; i < lines.length; i += 1) {
      if (/^[\|\s:-]+$/.test(lines[i])) continue;
      dataRows.push(splitRow(lines[i]));
    }
    return { headers, rows: dataRows };
  }

  function parseMarkdownExport(text) {
    const result = {
      activities: null,
      skuRows: [],
    };

    const activityMatch = text.match(/##\s*活动配置\s*\n([\s\S]*?)(?=##\s*SKU|$)/i);
    if (activityMatch) {
      const table = parseMarkdownTable(activityMatch[1]);
      if (table) {
        const acts = createDefaultActivities();
        table.rows.forEach((row) => {
          const key = normalizeImportHeader(row[0]);
          const val = row[1];
          if (key.includes('立减优惠券')) acts.coupon.amount = Math.max(0, parseNum(val) || 0);
          else if (key.includes('限时限量购类型')) acts.timeLimit.type = val === '打折' ? '打折' : '立减';
          else if (key.includes('限时限量购值')) acts.timeLimit.value = Math.max(0, parseNum(val) || 0);
        });
        result.activities = acts;
      }
    }

    const skuMatch = text.match(/##\s*SKU\s*定价\s*\n([\s\S]*?)$/i);
    if (skuMatch) {
      const table = parseMarkdownTable(skuMatch[1]);
      if (table) {
        const headerKeys = table.headers.map((h) => normalizeImportHeader(h));
        table.rows.forEach((cells) => {
          const rowData = {};
          headerKeys.forEach((hk, i) => {
            const field = IMPORT_FIELD_MAP[hk];
            if (field && field !== 'style') rowData[field] = cells[i];
            else if (hk === '款式') rowData.style = cells[i];
          });
          if (rowData.style) result.skuRows.push(rowData);
        });
      }
    }

    return result;
  }

  function applyImportData(parsed) {
    if (parsed.activities) globalActivities = parsed.activities;

    let matched = 0;
    let unmatched = 0;

    parsed.skuRows.forEach((importRow) => {
      const styleKey = String(importRow.style || '').trim();
      const target = rows.find((r) => r.style.trim() === styleKey);
      if (!target) {
        unmatched += 1;
        return;
      }

      if (importRow.cost != null && importRow.cost !== '') {
        const c = parseNum(importRow.cost);
        target.cost = Number.isFinite(c) && c > 0 ? String(c) : '';
      }
      if (importRow.freight != null && importRow.freight !== '') {
        const v = parseNum(importRow.freight);
        if (Number.isFinite(v)) target.freight = Math.max(0, v);
      }
      if (importRow.returnRate != null && importRow.returnRate !== '') {
        const v = parseNum(String(importRow.returnRate).replace('%', ''));
        if (Number.isFinite(v)) target.returnRate = clampPercent(v);
      }
      if (importRow.platformFee != null && importRow.platformFee !== '') {
        const v = parseNum(String(importRow.platformFee).replace('%', ''));
        if (Number.isFinite(v)) target.platformFee = clampPercent(v);
      }
      if (importRow.targetMargin != null && importRow.targetMargin !== '') {
        const v = parseNum(String(importRow.targetMargin).replace('%', ''));
        if (Number.isFinite(v)) target.targetMargin = Math.max(0, v);
      }
      matched += 1;
    });

    recalcAllRows();
    refreshTableBody();
    refreshActivityInputs();

    showNotice(`导入完成：匹配 ${matched} 行，未匹配 ${unmatched} 行`);
  }

  function exportMarkdown() {
    if (rows.length === 0) {
      showNotice('无 SKU 数据可导出', 'error');
      return;
    }

    const { markdown, goodsId, goodsTitle } = buildExportMarkdown();
    const filename = `${sanitizeFilename(`${goodsId}-${goodsTitle}`)}.md`;

    navigator.clipboard.writeText(markdown).then(() => {
      showNotice('已复制到剪贴板并下载文件');
    }).catch(() => {
      showNotice('剪贴板复制失败，已下载文件', 'error');
    });

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function processImportText(text) {
    const parsed = parseMarkdownExport(text);
    if (!parsed.activities && parsed.skuRows.length === 0) {
      showNotice('未识别有效的 Markdown 导入格式', 'error');
      return;
    }
    applyImportData(parsed);
  }

  function openImportDialog() {
    const root = ensureRoot();
    const layer = document.createElement('div');
    layer.className = 'pc-import-layer';

    const box = document.createElement('div');
    box.className = 'pc-import-box';

    const title = document.createElement('h3');
    title.textContent = '导入 Markdown';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.md,.txt,text/markdown';
    fileInput.className = 'pc-import-file';

    const textarea = document.createElement('textarea');
    textarea.className = 'pc-import-text';
    textarea.placeholder = '或粘贴 Markdown 内容…';

    const btnRow = document.createElement('div');
    btnRow.className = 'pc-import-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'pc-primary';
    confirmBtn.textContent = '确认导入';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '取消';

    const close = () => layer.remove();

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = String(reader.result || '');
      };
      reader.readAsText(file);
    });

    confirmBtn.addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) {
        showNotice('请选择文件或粘贴 Markdown 内容', 'error');
        return;
      }
      processImportText(text);
      close();
    });

    cancelBtn.addEventListener('click', close);
    layer.addEventListener('click', (e) => {
      if (e.target === layer) close();
    });

    btnRow.appendChild(confirmBtn);
    btnRow.appendChild(cancelBtn);
    box.appendChild(title);
    box.appendChild(fileInput);
    box.appendChild(textarea);
    box.appendChild(btnRow);
    layer.appendChild(box);
    root.appendChild(layer);
  }

  /** @type {HTMLTableSectionElement|null} */
  let tbodyRef = null;
  /** @type {HTMLElement|null} */
  let activityPanelRef = null;

  function refreshActivityInputs() {
    if (!activityPanelRef) return;
    const couponInput = activityPanelRef.querySelector('[data-pc-act="coupon"]');
    const tlSelect = activityPanelRef.querySelector('[data-pc-act="tl-type"]');
    const tlVal = activityPanelRef.querySelector('[data-pc-act="tl-value"]');
    const tlUnit = activityPanelRef.querySelector('[data-pc-act="tl-unit"]');
    if (couponInput) couponInput.value = String(globalActivities.coupon.amount);
    if (tlSelect) tlSelect.value = globalActivities.timeLimit.type;
    if (tlVal) {
      tlVal.value = String(globalActivities.timeLimit.value);
      tlVal.placeholder = globalActivities.timeLimit.type === '打折' ? '六折填60' : '';
    }
    if (tlUnit) tlUnit.textContent = globalActivities.timeLimit.type === '打折' ? '%付' : '元';
  }

  function parsePasteValues(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .split(PASTE_SPLIT)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
  }

  function updateCostInputsInDom(startIndex, count) {
    if (!tbodyRef || count <= 0) return;
    const trs = tbodyRef.querySelectorAll('tr');
    for (let i = startIndex; i < startIndex + count; i += 1) {
      const input = trs[i]?.querySelector('td[data-pc-field="cost"] input');
      if (input) {
        input.value = rows[i].cost === '' || rows[i].cost == null ? '' : String(rows[i].cost);
      }
    }
  }

  function pasteCostsFromRow(row, text) {
    const values = parsePasteValues(text);
    if (values.length === 0) return;
    const start = rows.indexOf(row);
    if (start < 0) return;

    suppressCostInput = true;
    let filled = 0;
    let discarded = 0;
    try {
      values.forEach((val, idx) => {
        const target = rows[start + idx];
        if (target) {
          target.cost = String(val);
          filled += 1;
        } else {
          discarded += 1;
        }
      });
      updateCostInputsInDom(start, filled);
      recalcAndUpdateOutputs();
    } finally {
      suppressCostInput = false;
    }

    if (discarded > 0) {
      showNotice(`已粘贴 ${filled} 项，超出 ${discarded} 项已丢弃`);
    } else {
      showNotice(`已粘贴 ${filled} 项采购成本`);
    }
  }

  function setInputValue(input, value, options = {}) {
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    if (!options.silent) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  async function fillBackByInputEvents(targets, skipped) {
    let success = 0;
    let fail = 0;
    const total = targets.length;
    showNotice(`回填中 0/${total}…（事件兜底）`);

    for (let i = 0; i < targets.length; i += FILL_BATCH_SIZE) {
      const batch = targets.slice(i, i + FILL_BATCH_SIZE);
      for (const row of batch) {
        try {
          if (!row.groupInput || !row.groupInput.isConnected) {
            fail += 1;
          } else if (row.singleInput && !row.singleInput.isConnected) {
            fail += 1;
          } else {
            const gOk = setInputValue(row.groupInput, row.groupPrice.toFixed(2));
            await sleep(FILL_YIELD_MS);
            const sOk = row.singleInput
              ? setInputValue(row.singleInput, row.singlePrice.toFixed(2))
              : true;
            if (gOk && sOk) success += 1;
            else fail += 1;
          }
        } catch {
          fail += 1;
        }
      }
      const done = Math.min(i + FILL_BATCH_SIZE, total);
      showNotice(`回填中 ${done}/${total}…（事件兜底）`);
      await sleep(FILL_YIELD_MS);
    }

    showNotice(`回填完成：成功 ${success} 行，跳过 ${skipped} 行，失败 ${fail} 行`);
  }

  async function fillBackAll() {
    if (fillBackRunning) return;
    fillBackRunning = true;
    if (fillBtnRef) {
      fillBtnRef.disabled = true;
      fillBtnRef.textContent = '回填中…';
    }

    let skipped = 0;
    /** @type {SkuRow[]} */
    const targets = [];
    rows.forEach((row) => {
      if (row.groupPrice == null || row.singlePrice == null) {
        skipped += 1;
        return;
      }
      targets.push(row);
    });

    try {
      if (targets.length === 0) {
        showNotice(`回填完成：成功 0 行，跳过 ${skipped} 行，失败 0 行`);
        return;
      }

      showNotice(`回填中：写入 tableList（${targets.length} 行）…`);
      const bulk = fillBackViaTableList(targets);
      if (bulk && bulk.success > 0) {
        showNotice(`回填中：已写入 ${bulk.success} 行，正在保存草稿…`);
        await sleep(80);
        const saved = clickSaveDraftButton();
        showNotice(
          `回填完成：成功 ${bulk.success} 行，跳过 ${skipped} 行，失败 ${bulk.fail} 行`
          + `（tableList${saved ? '，已点保存草稿' : '，未找到保存草稿按钮'}）`,
        );
        return;
      }

      showNotice('未命中 tableList，改用逐行事件回填…');
      await fillBackByInputEvents(targets, skipped);
      await sleep(80);
      if (clickSaveDraftButton()) {
        showNotice('事件回填结束，已点保存草稿');
      }
    } finally {
      fillBackRunning = false;
      if (fillBtnRef) {
        fillBtnRef.disabled = false;
        fillBtnRef.textContent = '回填';
      }
    }
  }

  function recalcAllRows() {
    rows.forEach((row) => {
      applyCalcResult(row, calcRow(row, globalActivities));
    });
  }

  function injectStyles() {
    let style = document.getElementById('pc-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pc-styles';
      document.documentElement.appendChild(style);
    }
    style.textContent = `
      #${ROOT_ID} { --pc-r-col-w: 108px; --pc-style-col-w: 160px; --pc-idx-col-w: 48px; }
      #${ROOT_ID} * { box-sizing: border-box; }
      #${ROOT_ID} .pc-fab {
        position: fixed; right: 16px; bottom: 72px; left: auto; top: auto;
        z-index: 2147483646; padding: 10px 14px; border: none; border-radius: 8px;
        background: #2563eb; color: #fff; font-size: 14px; cursor: grab;
        box-shadow: 0 4px 12px rgba(0,0,0,.2); user-select: none; touch-action: none;
      }
      #${ROOT_ID} .pc-fab:hover { background: #1d4ed8; }
      #${ROOT_ID} .pc-fab.dragging { cursor: grabbing; opacity: .92; }
      #${ROOT_ID} .pc-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center;
      }
      #${ROOT_ID} .pc-panel {
        width: 80vw; height: 80vh; max-width: none; background: #fff; border-radius: 12px;
        display: flex; flex-direction: column; overflow: hidden;
        box-shadow: 0 12px 40px rgba(0,0,0,.25);
      }
      #${ROOT_ID} .pc-header {
        padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
        display: flex; gap: 8px; align-items: center; flex-shrink: 0;
      }
      #${ROOT_ID} .pc-header h2 {
        margin: 0; font-size: 14px; flex: 1; min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${ROOT_ID} .pc-header button {
        padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb; cursor: pointer;
      }
      #${ROOT_ID} .pc-header button.pc-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
      #${ROOT_ID} .pc-body { flex: 1; overflow: hidden; padding: 0 12px 12px; }
      #${ROOT_ID} .pc-table-wrap { width: 100%; height: 100%; overflow: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
      #${ROOT_ID} .pc-table { border-collapse: separate; border-spacing: 0; min-width: 100%; font-size: 13px; }
      #${ROOT_ID} .pc-table th, #${ROOT_ID} .pc-table td {
        border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;
        padding: 6px 8px; background: #fff; vertical-align: middle; white-space: nowrap;
      }
      #${ROOT_ID} .pc-table th { background: #f9fafb; font-weight: 600; position: sticky; top: 0; z-index: 3; }
      #${ROOT_ID} .pc-table thead tr:first-child th { top: 0; z-index: 5; }
      #${ROOT_ID} .pc-table input[type=number], #${ROOT_ID} .pc-table input[type=text] {
        width: 72px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px;
      }
      #${ROOT_ID} .pc-table input:read-only { background: #f3f4f6; color: #374151; }
      #${ROOT_ID} .pc-sticky-idx {
        position: sticky; left: 0; z-index: 3;
        width: var(--pc-idx-col-w); min-width: var(--pc-idx-col-w); max-width: var(--pc-idx-col-w);
        text-align: center; background: #fff; color: #6b7280; font-weight: 600;
      }
      #${ROOT_ID} .pc-sticky-1 {
        position: sticky; left: var(--pc-idx-col-w); z-index: 2;
        width: var(--pc-style-col-w); min-width: var(--pc-style-col-w); max-width: var(--pc-style-col-w);
        background: #fff;
      }
      #${ROOT_ID} .pc-sticky-r-panel {
        position: sticky; right: 0; z-index: 6;
        width: calc(var(--pc-r-col-w) * 3); min-width: calc(var(--pc-r-col-w) * 3);
        max-width: calc(var(--pc-r-col-w) * 3);
        background: #f9fafb; box-shadow: -2px 0 4px rgba(0,0,0,.06);
        vertical-align: top;
      }
      #${ROOT_ID} .pc-sticky-r3 {
        position: sticky; right: calc(var(--pc-r-col-w) * 2); z-index: 2;
        width: var(--pc-r-col-w); min-width: var(--pc-r-col-w); max-width: var(--pc-r-col-w);
        background: #fff;
      }
      #${ROOT_ID} .pc-sticky-r2 {
        position: sticky; right: var(--pc-r-col-w); z-index: 2;
        width: var(--pc-r-col-w); min-width: var(--pc-r-col-w); max-width: var(--pc-r-col-w);
        background: #fff;
      }
      #${ROOT_ID} .pc-sticky-r1 {
        position: sticky; right: 0; z-index: 2;
        width: var(--pc-r-col-w); min-width: var(--pc-r-col-w); max-width: var(--pc-r-col-w);
        box-shadow: -2px 0 4px rgba(0,0,0,.06); background: #fff;
      }
      #${ROOT_ID} .pc-table th.pc-sticky-idx { background: #f9fafb; z-index: 8; }
      #${ROOT_ID} .pc-table th.pc-sticky-1 { background: #f9fafb; z-index: 7; }
      #${ROOT_ID} .pc-table th.pc-sticky-r-panel { z-index: 6; }
      #${ROOT_ID} .pc-table td.pc-sticky-idx,
      #${ROOT_ID} .pc-table td.pc-sticky-1, #${ROOT_ID} .pc-table td.pc-sticky-r1,
      #${ROOT_ID} .pc-table td.pc-sticky-r2, #${ROOT_ID} .pc-table td.pc-sticky-r3 { background: #fff; }
      #${ROOT_ID} .pc-table td.pc-style-cell {
        white-space: normal !important; word-break: break-all; overflow-wrap: anywhere;
        line-height: 1.4; vertical-align: top;
      }
      #${ROOT_ID} .pc-table th.pc-sticky-1.pc-style-head { white-space: normal; }
      #${ROOT_ID} .pc-activity-box {
        white-space: normal; padding: 8px;
        font-weight: normal; font-size: 12px; line-height: 1.5;
      }
      #${ROOT_ID} .pc-activity-grid { display: flex; flex-direction: column; gap: 8px; }
      #${ROOT_ID} .pc-price-subheads {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 4px; margin-top: 8px; padding-top: 8px;
        border-top: 1px solid #e5e7eb;
        font-weight: 600; font-size: 11px; line-height: 1.3;
        text-align: center; white-space: normal;
      }
      #${ROOT_ID} .pc-price-subheads .pc-th-formula { font-size: 9px; margin-top: 2px; }
      #${ROOT_ID} .pc-activity-item { display: flex; align-items: center; gap: 4px; min-width: 0; }
      #${ROOT_ID} .pc-activity-item span { flex-shrink: 0; white-space: nowrap; }
      #${ROOT_ID} .pc-activity-item input[type=text] { width: 52px; flex-shrink: 0; }
      #${ROOT_ID} .pc-col-header { font-weight: 600; vertical-align: middle; white-space: normal; }
      #${ROOT_ID} .pc-col-header .pc-batch-wrap { margin-top: 6px; }
      #${ROOT_ID} .pc-batch-wrap { display: flex; gap: 4px; align-items: center; justify-content: center; flex-wrap: wrap; }
      #${ROOT_ID} .pc-batch-wrap input { width: 52px; padding: 3px 5px; font-size: 12px; }
      #${ROOT_ID} .pc-batch-btn {
        padding: 3px 6px; font-size: 11px; border: 1px solid #d1d5db; border-radius: 4px;
        background: #f9fafb; cursor: pointer; white-space: nowrap;
      }
      #${ROOT_ID} .pc-batch-btn:hover { background: #eff6ff; border-color: #2563eb; color: #2563eb; }
      #${ROOT_ID} .pc-th-title { display: block; font-weight: 600; margin-bottom: 2px; }
      #${ROOT_ID} .pc-th-formula {
        display: block; font-weight: normal; font-size: 10px; color: #6b7280;
        line-height: 1.35; margin-top: 2px; white-space: normal; word-break: break-all;
      }
      #${ROOT_ID} .pc-activity-select {
        font-size: 12px; padding: 4px 24px 4px 8px; border: 1px solid #d1d5db; border-radius: 4px;
        background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E") no-repeat right 6px center;
        appearance: none; min-width: 72px; height: 28px; cursor: pointer; flex-shrink: 0;
      }
      #${ROOT_ID} .pc-fill-btn {
        margin-top: 4px; width: 100%; padding: 6px 10px; border: none; border-radius: 6px;
        background: #2563eb; color: #fff; cursor: pointer; font-size: 13px;
      }
      #${ROOT_ID} .pc-fill-btn:hover:not(:disabled) { background: #1d4ed8; }
      #${ROOT_ID} .pc-fill-btn:disabled { opacity: .65; cursor: not-allowed; }
      #${ROOT_ID} .pc-import-layer {
        position: fixed; inset: 0; z-index: 2147483649;
        background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center;
      }
      #${ROOT_ID} .pc-import-box {
        width: min(560px, 90vw); background: #fff; border-radius: 12px; padding: 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,.25);
      }
      #${ROOT_ID} .pc-import-box h3 { margin: 0 0 12px; font-size: 16px; }
      #${ROOT_ID} .pc-import-text {
        width: 100%; min-height: 160px; margin-top: 8px; padding: 8px;
        border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; resize: vertical;
      }
      #${ROOT_ID} .pc-import-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
      #${ROOT_ID} .pc-notice-layer {
        position: fixed; inset: 0; z-index: 2147483650;
        display: flex; align-items: center; justify-content: center; pointer-events: none;
      }
      #${ROOT_ID} .pc-notice {
        pointer-events: auto; display: flex; align-items: flex-start; gap: 12px;
        min-width: 280px; max-width: 420px; padding: 16px 18px; border-radius: 10px;
        background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.2); border: 1px solid #e5e7eb;
        transform: translateY(-10px) scale(.98); opacity: 0;
        transition: opacity .22s ease, transform .22s ease;
      }
      #${ROOT_ID} .pc-notice-show { transform: translateY(0) scale(1); opacity: 1; }
      #${ROOT_ID} .pc-notice-icon {
        width: 28px; height: 28px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; font-weight: 700; flex-shrink: 0;
      }
      #${ROOT_ID} .pc-notice-success .pc-notice-icon { color: #16a34a; background: #dcfce7; }
      #${ROOT_ID} .pc-notice-error .pc-notice-icon { color: #dc2626; background: #fee2e2; }
      #${ROOT_ID} .pc-notice-text { flex: 1; font-size: 14px; color: #111827; line-height: 1.5; }
      #${ROOT_ID} .pc-notice-close {
        border: none; background: transparent; color: #9ca3af;
        font-size: 20px; cursor: pointer; padding: 0 0 0 4px; line-height: 1;
      }
      #${ROOT_ID} .pc-notice-close:hover { color: #6b7280; }
      #${ROOT_ID} .pc-empty { padding: 48px 24px; text-align: center; color: #6b7280; }
      #${ROOT_ID} .pc-result { font-variant-numeric: tabular-nums; }
      #${ROOT_ID} .pc-readonly { font-variant-numeric: tabular-nums; color: #374151; }
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

  let noticeTimer = null;
  let noticeRemoveTimer = null;

  function removeNoticeLayer(overlay) {
    if (!overlay?.parentNode) return;
    if (noticeRemoveTimer) clearTimeout(noticeRemoveTimer);
    noticeRemoveTimer = setTimeout(() => {
      overlay.remove();
      noticeRemoveTimer = null;
    }, 220);
  }

  function hideNotice() {
    const root = document.getElementById(ROOT_ID);
    const overlay = root?.querySelector('.pc-notice-layer');
    if (!overlay) return;
    const box = overlay.querySelector('.pc-notice');
    if (box) box.classList.remove('pc-notice-show');
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    removeNoticeLayer(overlay);
  }

  function showNotice(message, type = 'success') {
    const root = ensureRoot();
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    const existing = root.querySelector('.pc-notice-layer');
    if (existing) {
      if (noticeRemoveTimer) {
        clearTimeout(noticeRemoveTimer);
        noticeRemoveTimer = null;
      }
      existing.remove();
    }

    const layer = document.createElement('div');
    layer.className = 'pc-notice-layer';

    const box = document.createElement('div');
    box.className = `pc-notice pc-notice-${type}`;

    const icon = document.createElement('div');
    icon.className = 'pc-notice-icon';
    icon.textContent = type === 'error' ? '!' : '✓';

    const text = document.createElement('div');
    text.className = 'pc-notice-text';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pc-notice-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', hideNotice);

    box.appendChild(icon);
    box.appendChild(text);
    box.appendChild(closeBtn);
    layer.appendChild(box);
    root.appendChild(layer);

    requestAnimationFrame(() => box.classList.add('pc-notice-show'));
    noticeTimer = setTimeout(hideNotice, 2800);
  }

  function bindDecimalField(input, row, field, onChange, options = {}) {
    input.type = 'text';
    input.inputMode = 'decimal';
    const fallback = () => (options.defaultValue != null ? options.defaultValue : 0);

    input.addEventListener('input', () => {
      if (suppressCostInput) return;
      const raw = input.value.trim();
      if (options.allowEmpty && raw === '') {
        row[field] = '';
        onChange();
        return;
      }
      if (raw === '' || raw === '.' || /^\d+\.$/.test(raw) || /^\d*\.$/.test(raw)) return;
      if (!/^\d*\.?\d*$/.test(raw)) {
        const cur = row[field];
        input.value = cur === '' || cur == null ? '' : String(cur);
        return;
      }
      let v = parseNum(raw);
      if (!Number.isFinite(v)) return;
      if (options.clampPercent) v = clampPercent(v);
      if (options.min != null) v = Math.max(options.min, v);
      if (options.max != null) v = Math.min(options.max, v);
      row[field] = options.storeString ? String(v) : v;
      onChange();
    });

    input.addEventListener('blur', () => {
      if (suppressCostInput) return;
      const raw = input.value.trim();
      if (options.allowEmpty && raw === '') {
        row[field] = '';
        input.value = '';
        onChange();
        return;
      }
      let v = parseNum(raw);
      if (!Number.isFinite(v)) v = fallback();
      if (options.clampPercent) v = clampPercent(v);
      if (options.min != null) v = Math.max(options.min, v);
      if (options.max != null) v = Math.min(options.max, v);
      row[field] = options.storeString ? String(v) : v;
      input.value = String(v);
      onChange();
    });
  }

  function bindGlobalDecimalInput(input, getValue, setValue, onChange, options = {}) {
    input.type = 'text';
    input.inputMode = 'decimal';
    const resolveOptions = () => (typeof options === 'function' ? options() : options);
    const fallback = () => {
      const opts = resolveOptions();
      return opts.defaultValue != null ? opts.defaultValue : 0;
    };

    input.addEventListener('input', () => {
      const opts = resolveOptions();
      const raw = input.value.trim();
      if (raw === '' || raw === '.' || /^\d+\.$/.test(raw) || /^\d*\.$/.test(raw)) return;
      if (!/^\d*\.?\d*$/.test(raw)) {
        input.value = String(getValue());
        return;
      }
      let v = parseNum(raw);
      if (!Number.isFinite(v)) return;
      if (opts.clampPercent) v = clampPercent(v);
      if (opts.min != null) v = Math.max(opts.min, v);
      if (opts.max != null) v = Math.min(opts.max, v);
      setValue(v);
      onChange();
    });

    input.addEventListener('blur', () => {
      const opts = resolveOptions();
      let v = parseNum(input.value);
      if (!Number.isFinite(v)) v = fallback();
      if (opts.clampPercent) v = clampPercent(v);
      if (opts.min != null) v = Math.max(opts.min, v);
      if (opts.max != null) v = Math.min(opts.max, v);
      setValue(v);
      input.value = String(v);
      onChange();
    });
  }

  function refreshTableBody() {
    if (tbodyRef) renderDataRows(tbodyRef);
  }

  function appendBatchControls(th, field, options = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'pc-batch-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = options.placeholder || '值';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pc-batch-btn';
    btn.textContent = '批量设置';
    btn.addEventListener('click', () => {
      let v = parseNum(input.value);
      if (!Number.isFinite(v)) {
        showNotice('请输入有效数值', 'error');
        return;
      }
      if (options.isPercent) v = clampPercent(v);
      if (options.unboundedPercent) v = Math.max(0, v);
      if (options.min != null) v = Math.max(options.min, v);
      rows.forEach((row) => {
        if (field === 'cost') row[field] = String(v);
        else row[field] = v;
      });
      onTableDataChange();
      showNotice(`批量设置完成：已设置 ${rows.length} 行`);
    });

    wrap.appendChild(input);
    wrap.appendChild(btn);
    th.appendChild(wrap);
  }

  function createSimpleHeaderTh(text, className, formula) {
    const th = document.createElement('th');
    if (className) th.className = className;
    let html = `<span class="pc-th-title">${text}</span>`;
    if (formula) html += `<span class="pc-th-formula">${formula}</span>`;
    th.innerHTML = html;
    return th;
  }

  function createColumnHeaderTh(text, field, className, batchOptions = {}, formula) {
    const th = document.createElement('th');
    th.className = ['pc-col-header', className].filter(Boolean).join(' ');
    let html = `<span class="pc-th-title">${text}</span>`;
    if (formula) html += `<span class="pc-th-formula">${formula}</span>`;
    th.innerHTML = html;
    appendBatchControls(th, field, batchOptions);
    return th;
  }

  function createReadonlyTd(value, extraClass) {
    const td = document.createElement('td');
    if (extraClass) td.className = extraClass;
    td.classList.add('pc-readonly');
    td.textContent = value;
    return td;
  }

  function recalcAndUpdateOutputs() {
    recalcAllRows();
    refreshTableBody();
  }

  function onTableInputChange() {
    recalcAndUpdateOutputs();
  }

  function onTableDataChange() {
    recalcAllRows();
    refreshTableBody();
  }

  function onActivityChange() {
    recalcAndUpdateOutputs();
  }

  function renderDataRows(tbody) {
    tbody.innerHTML = '';
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');

      const tdIndex = document.createElement('td');
      tdIndex.className = 'pc-sticky-idx';
      tdIndex.textContent = String(index + 1);

      const tdStyle = document.createElement('td');
      tdStyle.className = 'pc-sticky-1 pc-style-cell';
      tdStyle.textContent = row.style;

      const tdCost = document.createElement('td');
      tdCost.dataset.pcField = 'cost';
      const costInput = document.createElement('input');
      costInput.placeholder = '采购成本';
      costInput.value = row.cost;
      bindDecimalField(costInput, row, 'cost', onTableInputChange, { allowEmpty: true, storeString: true, min: 0 });
      costInput.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'insertFromPaste') e.preventDefault();
      });
      costInput.addEventListener('paste', (e) => {
        e.preventDefault();
        pasteCostsFromRow(row, e.clipboardData?.getData('text') || '');
      });
      tdCost.appendChild(costInput);

      const tdFreight = document.createElement('td');
      const freightInput = document.createElement('input');
      freightInput.value = String(row.freight);
      bindDecimalField(freightInput, row, 'freight', onTableInputChange, { min: 0, defaultValue: DEFAULTS.freight });
      tdFreight.appendChild(freightInput);

      const tdReturn = document.createElement('td');
      const returnInput = document.createElement('input');
      returnInput.value = String(row.returnRate);
      bindDecimalField(returnInput, row, 'returnRate', onTableInputChange, {
        clampPercent: true, defaultValue: DEFAULTS.returnRate,
      });
      tdReturn.appendChild(returnInput);

      const tdPlatform = document.createElement('td');
      const platformInput = document.createElement('input');
      platformInput.value = String(row.platformFee);
      bindDecimalField(platformInput, row, 'platformFee', onTableInputChange, {
        clampPercent: true, defaultValue: DEFAULTS.platformFee,
      });
      tdPlatform.appendChild(platformInput);

      const tdTarget = document.createElement('td');
      const targetInput = document.createElement('input');
      targetInput.value = String(row.targetMargin);
      bindDecimalField(targetInput, row, 'targetMargin', onTableInputChange, {
        min: 0, defaultValue: DEFAULTS.targetMargin,
      });
      tdTarget.appendChild(targetInput);

      const tdActualCost = createReadonlyTd(formatNum(row.actualCost));
      const tdMargin = createReadonlyTd(formatPct(row.marginRate));
      const tdProfit = createReadonlyTd(formatNum(row.actualProfit));
      const tdNetRoi = createReadonlyTd(formatNum(row.netBreakEvenRoi));
      const tdMicroRoi = createReadonlyTd(formatNum(row.microPaidRoi));
      const tdOptimalRoi = createReadonlyTd(formatNum(row.optimalRoi));

      const tdActualGroup = createReadonlyTd(formatNum(row.actualGroupPrice), 'pc-sticky-r3 pc-result');
      const tdGroup = createReadonlyTd(formatNum(row.groupPrice), 'pc-sticky-r2 pc-result');
      const tdSingle = createReadonlyTd(formatNum(row.singlePrice), 'pc-sticky-r1 pc-result');

      tr.appendChild(tdIndex);
      tr.appendChild(tdStyle);
      tr.appendChild(tdCost);
      tr.appendChild(tdFreight);
      tr.appendChild(tdReturn);
      tr.appendChild(tdPlatform);
      tr.appendChild(tdTarget);
      tr.appendChild(tdActualCost);
      tr.appendChild(tdMargin);
      tr.appendChild(tdProfit);
      tr.appendChild(tdNetRoi);
      tr.appendChild(tdMicroRoi);
      tr.appendChild(tdOptimalRoi);
      tr.appendChild(tdActualGroup);
      tr.appendChild(tdGroup);
      tr.appendChild(tdSingle);
      tbody.appendChild(tr);
    });
  }

  function buildActivityHeaderCell() {
    const th = document.createElement('th');
    th.colSpan = 3;
    th.className = 'pc-activity-box pc-sticky-r-panel';

    const grid = document.createElement('div');
    grid.className = 'pc-activity-grid';
    activityPanelRef = grid;

    const couponLine = document.createElement('div');
    couponLine.className = 'pc-activity-item';
    const couponLabel = document.createElement('span');
    couponLabel.textContent = '立减优惠券';
    const couponInput = document.createElement('input');
    couponInput.dataset.pcAct = 'coupon';
    couponInput.value = String(globalActivities.coupon.amount);
    const couponUnit = document.createElement('span');
    couponUnit.textContent = '元';
    bindGlobalDecimalInput(
      couponInput,
      () => globalActivities.coupon.amount,
      (v) => { globalActivities.coupon.amount = v; },
      onActivityChange,
      { min: 0 },
    );
    couponLine.appendChild(couponLabel);
    couponLine.appendChild(couponInput);
    couponLine.appendChild(couponUnit);
    grid.appendChild(couponLine);

    const tlLine = document.createElement('div');
    tlLine.className = 'pc-activity-item';
    const tlLabel = document.createElement('span');
    tlLabel.textContent = '限时限量购';
    const tlSelect = document.createElement('select');
    tlSelect.className = 'pc-activity-select';
    tlSelect.dataset.pcAct = 'tl-type';
    ['立减', '打折'].forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (globalActivities.timeLimit.type === opt) o.selected = true;
      tlSelect.appendChild(o);
    });
    const tlVal = document.createElement('input');
    tlVal.dataset.pcAct = 'tl-value';
    tlVal.value = String(globalActivities.timeLimit.value);
    tlVal.placeholder = globalActivities.timeLimit.type === '打折' ? '六折填60' : '';
    const tlUnit = document.createElement('span');
    tlUnit.dataset.pcAct = 'tl-unit';
    tlUnit.textContent = globalActivities.timeLimit.type === '打折' ? '%付' : '元';

    const tlRefreshMeta = () => {
      tlVal.placeholder = globalActivities.timeLimit.type === '打折' ? '六折填60' : '';
      tlUnit.textContent = globalActivities.timeLimit.type === '打折' ? '%付' : '元';
    };

    bindGlobalDecimalInput(
      tlVal,
      () => globalActivities.timeLimit.value,
      (v) => { globalActivities.timeLimit.value = v; },
      onActivityChange,
      () => ({
        min: 0,
        clampPercent: globalActivities.timeLimit.type === '打折',
        max: globalActivities.timeLimit.type === '打折' ? 100 : undefined,
      }),
    );

    tlSelect.addEventListener('change', () => {
      globalActivities.timeLimit.type = tlSelect.value;
      tlRefreshMeta();
      onActivityChange();
    });

    tlLine.appendChild(tlLabel);
    tlLine.appendChild(tlSelect);
    tlLine.appendChild(tlVal);
    tlLine.appendChild(tlUnit);
    grid.appendChild(tlLine);

    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'pc-fill-btn';
    fillBtn.textContent = '回填';
    fillBtn.addEventListener('click', () => { fillBackAll(); });
    fillBtnRef = fillBtn;
    grid.appendChild(fillBtn);

    const subheads = document.createElement('div');
    subheads.className = 'pc-price-subheads';
    [
      { label: '实际拼单价（元）', formula: '实际成本×(1+目标利润率)' },
      { label: '拼单价（元）', formula: '实际拼单价+活动优惠' },
      { label: '单买价（元）', formula: '实际拼单价×1.1+券+限时+随机' },
    ].forEach(({ label, formula }) => {
      const cell = document.createElement('span');
      cell.innerHTML = `${label}<span class="pc-th-formula">${formula}</span>`;
      subheads.appendChild(cell);
    });

    th.appendChild(grid);
    th.appendChild(subheads);
    return th;
  }

  async function openPanel() {
    const root = ensureRoot();
    root.innerHTML = '';

    const loading = document.createElement('div');
    loading.className = 'pc-overlay';
    loading.innerHTML = '<div class="pc-panel" style="padding:24px;text-align:center;color:#374151">正在加载 SKU 列表...</div>';
    root.appendChild(loading);

    await loadAllVirtualSkuRows();

    root.innerHTML = '';

    globalActivities = createDefaultActivities();
    rows = scanSkuTable();
    recalcAllRows();

    const overlay = document.createElement('div');
    overlay.className = 'pc-overlay';

    const panel = document.createElement('div');
    panel.className = 'pc-panel';

    const header = document.createElement('div');
    header.className = 'pc-header';
    const title = document.createElement('h2');
    const { goodsId, goodsTitle } = getGoodsMeta();
    title.textContent = rows.length > 0
      ? `${goodsId}-${goodsTitle}（共 ${rows.length} 个 SKU）`
      : `${goodsId}-${goodsTitle}（未找到 SKU 表格）`;
    title.title = title.textContent;

    const exportBtn = document.createElement('button');
    exportBtn.className = 'pc-primary';
    exportBtn.textContent = '导出';
    exportBtn.addEventListener('click', exportMarkdown);

    const importBtn = document.createElement('button');
    importBtn.className = 'pc-primary';
    importBtn.textContent = '导入';
    importBtn.addEventListener('click', openImportDialog);

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '刷新';
    refreshBtn.addEventListener('click', () => openPanel());

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.addEventListener('click', () => {
      root.innerHTML = '';
      createFab();
    });

    header.appendChild(title);
    header.appendChild(exportBtn);
    header.appendChild(importBtn);
    header.appendChild(refreshBtn);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'pc-body';

    if (rows.length === 0) {
      body.innerHTML = '<div class="pc-empty">未找到包含规格列（款式/颜色/尺寸等）与「拼单价」列的 SKU 表格。<br>请确认当前页面为商品规格编辑页后点击「刷新」。</div>';
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'pc-table-wrap';

      const table = document.createElement('table');
      table.className = 'pc-table';

      const thead = document.createElement('thead');
      const headRow1 = document.createElement('tr');

      headRow1.appendChild(createSimpleHeaderTh('序号', 'pc-sticky-idx'));
      headRow1.appendChild(createSimpleHeaderTh('款式', 'pc-sticky-1 pc-style-head'));
      headRow1.appendChild(createColumnHeaderTh('采购成本（元）', 'cost', null, { min: 0, placeholder: '元' }));
      headRow1.appendChild(createColumnHeaderTh('运费（元）', 'freight', null, { min: 0, placeholder: '元' }));
      headRow1.appendChild(createColumnHeaderTh('退货率（%）', 'returnRate', null, { isPercent: true, placeholder: '%' }));
      headRow1.appendChild(createColumnHeaderTh('平台扣点（%）', 'platformFee', null, { isPercent: true, placeholder: '%' }));
      headRow1.appendChild(createColumnHeaderTh('目标利润率（%）', 'targetMargin', null, {
        unboundedPercent: true, placeholder: '%',
      }, '实际拼单价的加成比例，可超过100%'));
      headRow1.appendChild(createSimpleHeaderTh('实际成本（元）', null, '采购成本+运费'));
      headRow1.appendChild(createSimpleHeaderTh('实际利润率（%）', null, '实际利润÷实际成本×100'));
      headRow1.appendChild(createSimpleHeaderTh('实际利润（元）', null, '实际拼单价×(1-扣点)-采购成本-运费'));
      headRow1.appendChild(createSimpleHeaderTh('净保本投产比', null, '(实际拼单价÷实际利润)÷(1-退货率)'));
      headRow1.appendChild(createSimpleHeaderTh('微付费投产比', null, '净保本÷2+0.5'));
      headRow1.appendChild(createSimpleHeaderTh('最佳投产比', null, '净保本×1.4(>50%)或×2(≤50%)'));
      headRow1.appendChild(buildActivityHeaderCell());

      thead.appendChild(headRow1);

      const tbody = document.createElement('tbody');
      tbodyRef = tbody;
      renderDataRows(tbody);

      table.appendChild(thead);
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
    }

    panel.appendChild(header);
    panel.appendChild(body);
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
      fab.style.left = `${Math.min(Math.max(4, originLeft + dx), maxLeft)}px`;
      fab.style.top = `${Math.min(Math.max(4, originTop + dy), maxTop)}px`;
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
    if (root.querySelector('.pc-fab')) return;

    const fab = document.createElement('button');
    fab.className = 'pc-fab';
    fab.type = 'button';
    fab.textContent = '价格计算';
    fab.title = '价格计算（可拖动）';
    applyFabPosition(fab);
    makeFabDraggable(fab, openPanel);
    root.appendChild(fab);
  }

  function selfTestFormulas() {
    const row = {
      cost: '5.94',
      freight: 0,
      returnRate: 20,
      targetMargin: 20,
      platformFee: 0.6,
      singleRandomOffset: 4,
    };
    const acts = createDefaultActivities();
    const r = calcRow(row, acts);
    console.assert(r.actualGroupPrice === 7.13, `expected actualGroup 7.13 got ${r.actualGroupPrice}`);
    console.assert(r.groupPrice === 7.13, `expected group 7.13 got ${r.groupPrice}`);
    console.assert(r.actualProfit === 1.15, `expected profit 1.15 got ${r.actualProfit}`);
    console.assert(r.marginRate === 19.36, `expected marginRate 19.36 got ${r.marginRate}`);
    console.assert(r.netBreakEvenRoi === 7.75, `expected netRoi 7.75 got ${r.netBreakEvenRoi}`);
    console.assert(r.microPaidRoi === 4.38, `expected microRoi 4.38 got ${r.microPaidRoi}`);
    console.assert(r.optimalRoi === 15.5, `expected optimalRoi 15.5 got ${r.optimalRoi}`);

    acts.coupon.amount = 5;
    const r2 = calcRow(row, acts);
    console.assert(r2.groupPrice === 12.13, `expected group 12.13 got ${r2.groupPrice}`);
    console.assert(r2.actualGroupPrice === 7.13, `actualGroup unchanged got ${r2.actualGroupPrice}`);
  }

  selfTestFormulas();
  initSkuTableExpandOnLoad();
  createFab();
})();
