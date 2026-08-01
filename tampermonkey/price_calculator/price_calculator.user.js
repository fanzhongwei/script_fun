// ==UserScript==
// @name         价格计算器
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.3.1
// @description  拼多多商家后台 SKU 拼单价/单买价计算器，支持活动叠加与一键回填
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

  /** 拼多多 SKU 表第一规格列常见表头（语义匹配，非固定「款式/尺寸」） */
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

  /** @type {{ style: string, groupInput: HTMLInputElement, singleInput: HTMLInputElement, rowIndex: number, cost: string, freight: number, returnRate: number, targetMargin: number, platformFee: number, singleRandomOffset: number, groupPrice: number|null, singlePrice: number|null, marginRate: number|null }[]} */
  let rows = [];

  /** @type {{ reorder: ActivityItem, follow: ActivityItem, newCustomer: ActivityItem, live: ActivityItem, scene: ActivityItem, timeLimit: TimeLimitItem }} */
  let globalActivities = createDefaultActivities();

  /** 批量粘贴成本时抑制 input 回调，避免重绘后空 input 事件清空首行 */
  let suppressCostInput = false;

  /** @typedef {{ amount: number }} ActivityItem */
  /** @typedef {{ type: '立减'|'打折', value: number }} TimeLimitItem */

  function createDefaultActivities() {
    return {
      reorder: { amount: 0 },
      follow: { amount: 0 },
      newCustomer: { amount: 0 },
      live: { amount: 0 },
      scene: { amount: 0 },
      timeLimit: { type: '立减', value: 0 },
    };
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

  function randomSingleOffset() {
    return round2(3 + Math.random() * 2);
  }

  /**
   * 单买价 = 基础拼单价 K × 1.1 + 优惠券金额 + 限时加价 + [3~5] 随机小数
   * 优惠券/限时加价部分不乘 1.1（限时加价 = 最终拼单价 - 互斥活动后拼单价，含立减/打折）
   */
  function calcSinglePrice(K, couponAmount, timeLimitAdd, offset) {
    return round2(K * 1.1 + couponAmount + timeLimitAdd + offset);
  }

  function calcBase(C, E, G, I, J) {
    const denom = (1 - I) - J / (1 - G);
    if (!(C > 0) || denom <= 0 || !Number.isFinite(denom)) return null;
    const N = (C + E) / denom;
    const K = round2(N);
    return { K, N };
  }

  /** 前五项均为「立减 a 元」类优惠券，拼单价补偿 K+a */
  function calcExclusiveCandidate(key, K, amount) {
    const a = Math.max(0, amount || 0);
    const pin = round2(K + a);
    return { pin, key };
  }

  const EXCLUSIVE_ACTIVITY_KEYS = ['reorder', 'follow', 'newCustomer', 'live', 'scene'];

  /**
   * 前五项互斥活动：取金额最高的一项，再按其类型公式计算（同额时按列表优先级）
   * 限时限量购在结果上叠加，见 applyTimeLimit
   */
  function pickExclusiveResult(K, activities) {
    let pickedKey = null;
    let pickedAmount = 0;
    EXCLUSIVE_ACTIVITY_KEYS.forEach((key) => {
      const a = Math.max(0, activities[key]?.amount || 0);
      if (a > pickedAmount) {
        pickedAmount = a;
        pickedKey = key;
      }
    });
    if (!pickedKey || pickedAmount <= 0) {
      return { pin: K, key: 'base', couponAmount: 0 };
    }
    const result = calcExclusiveCandidate(pickedKey, K, pickedAmount);
    return { ...result, couponAmount: pickedAmount };
  }

  function applyTimeLimit(pin0, timeLimit) {
    if (!timeLimit || !(timeLimit.value > 0)) {
      return pin0;
    }
    const v = Math.max(0, timeLimit.value || 0);
    if (timeLimit.type === '立减') {
      return round2(pin0 + v);
    }
    // 打折：v 为折后支付比例（六折 = 60，即顾客付挂牌价 60%）
    const payRate = clampPercent(v) / 100;
    if (payRate <= 0) return pin0;
    return round2(pin0 / payRate);
  }

  /** 顾客实付净价：用于回算实际利润率 */
  function customerNetPrice(finalPin, pickedKey, activities, timeLimit) {
    const tl = timeLimit;
    const hasTimeLimit = tl && (tl.value || 0) > 0;

    if (hasTimeLimit) {
      if (tl.type === '立减') {
        return Math.max(0, finalPin - Math.max(0, tl.value || 0));
      }
      const payRate = clampPercent(tl.value) / 100;
      return payRate > 0 ? Math.max(0, finalPin * payRate) : 0;
    }

    if (pickedKey && pickedKey !== 'base') {
      return Math.max(0, finalPin - Math.max(0, activities[pickedKey]?.amount || 0));
    }
    return Math.max(0, finalPin);
  }

  function calcRow(row, activities) {
    const C = parseNum(row.cost);
    const E = parseNum(row.freight);
    const G = pctToDecimal(row.returnRate);
    const I = pctToDecimal(row.platformFee);
    const J = pctToDecimal(row.targetMargin);

    if (!(C > 0) || !Number.isFinite(E) || E < 0) {
      return { groupPrice: null, singlePrice: null, marginRate: null };
    }

    const base = calcBase(C, E, G, I, J);
    if (!base) return { groupPrice: null, singlePrice: null, marginRate: null };

    const { K } = base;
    const picked = pickExclusiveResult(K, activities);
    const finalPin = applyTimeLimit(picked.pin, activities.timeLimit);
    const timeLimitAdd = round2(Math.max(0, finalPin - picked.pin));
    const single = calcSinglePrice(K, picked.couponAmount, timeLimitAdd, row.singleRandomOffset);

    const net = customerNetPrice(finalPin, picked.key, activities, activities.timeLimit);
    let marginRate = null;
    if (net > 0) {
      const F = net * (1 - I) - C - E;
      marginRate = round2((F / net) * (1 - G) * 100);
    }

    return {
      groupPrice: finalPin,
      singlePrice: single,
      marginRate,
    };
  }

  function normalizeHeaderText(text) {
    return String(text || '').replace(/\*/g, '').replace(/\s+/g, '').trim();
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

  function extractStyleFromCells(cells, styleCols) {
    const titleCell = styleCols.map((i) => cells[i]).find((c) => c?.querySelector('.sku-row-title'));
    if (titleCell) {
      const title = titleCell.querySelector('.sku-row-title');
      if (title) return (title.textContent || '').replace(/\s+/g, ' ').trim();
    }
    const parts = styleCols
      .map((i) => (cells[i]?.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return parts.join('_');
  }

  function extractStyleFromCell(cell) {
    const title = cell.querySelector('.sku-row-title');
    if (title) return (title.textContent || '').replace(/\s+/g, ' ').trim();
    return (cell.textContent || '').replace(/\s+/g, ' ').trim();
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
      styleCol: styleCols[0],
      groupCol,
      singleCol: singleCol >= 0 ? singleCol : groupCol + 1,
    };
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
      groupPrice: null,
      singlePrice: null,
      marginRate: null,
    };
  }

  function extractSkuRowsFromBody(cols, bodyRows) {
    const result = [];
    bodyRows.forEach((row) => {
      const cells = getRowCells(row);
      const maxCol = Math.max(...cols.styleCols, cols.groupCol, cols.singleCol);
      if (cells.length <= maxCol) return;

      const style = cols.styleCols.length > 1
        ? extractStyleFromCells(cells, cols.styleCols)
        : extractStyleFromCell(cells[cols.styleCol]);
      const groupInput = findPriceInputInCell(cells[cols.groupCol]);
      const singleInput = cols.singleCol >= 0 ? findPriceInputInCell(cells[cols.singleCol]) : null;
      if (!style || !groupInput) return;

      result.push(buildSkuRow(style, groupInput, singleInput, result.length));
    });
    return result;
  }

  /** 处理 beast-core-table 等「表头 table + 表体 table」分离结构 */
  function scanSkuContainer(container) {
    const headerRow = container.querySelector('[data-testid="beast-core-table-header-tr"]')
      || container.querySelector('thead tr');
    if (!headerRow) return [];

    const cols = detectHeaderColumns(getRowCells(headerRow));
    if (!cols) return [];

    const bodyRows = container.querySelectorAll(
      '[data-testid="beast-core-table-body-tr"], tbody tr',
    );
    return extractSkuRowsFromBody(cols, bodyRows);
  }

  function collectSkuContainers() {
    const selectors = [
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
      const input = trs[i]?.querySelectorAll('td')[1]?.querySelector('input');
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
      showNotice(`已粘贴 ${filled} 项成本`);
    }
  }

  function setInputValue(input, value) {
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function fillBackAll() {
    let success = 0;
    let skipped = 0;
    let fail = 0;

    rows.forEach((row) => {
      if (row.groupPrice == null || row.singlePrice == null) {
        skipped += 1;
        return;
      }
      try {
        const styleOk = row.groupInput.closest('tr')?.textContent?.includes(row.style.slice(0, 8));
        if (styleOk === false) fail += 1;
        const gOk = setInputValue(row.groupInput, row.groupPrice.toFixed(2));
        const sOk = row.singleInput ? setInputValue(row.singleInput, row.singlePrice.toFixed(2)) : true;
        if (gOk && sOk) success += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    });

    showNotice(`回填完成：成功 ${success} 行，跳过 ${skipped} 行，失败 ${fail} 行`);
  }

  function recalcAllRows() {
    rows.forEach((row) => {
      const r = calcRow(row, globalActivities);
      row.groupPrice = r.groupPrice;
      row.singlePrice = r.singlePrice;
      row.marginRate = r.marginRate;
    });
  }

  function injectStyles() {
    if (document.getElementById('pc-styles')) return;
    const style = document.createElement('style');
    style.id = 'pc-styles';
    style.textContent = `
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
      #${ROOT_ID} .pc-header h2 { margin: 0; font-size: 16px; flex: 1; }
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
      #${ROOT_ID} .pc-table thead tr:first-child th[rowspan="2"] { top: 0; z-index: 5; }
      #${ROOT_ID} .pc-table thead tr:nth-child(2) th { top: var(--pc-head-row1-h, 80px); z-index: 4; }
      #${ROOT_ID} .pc-table input[type=number], #${ROOT_ID} .pc-table input[type=text] {
        width: 72px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px;
      }
      #${ROOT_ID} .pc-table input:read-only { background: #f3f4f6; color: #374151; }
      #${ROOT_ID} .pc-sticky-1 { position: sticky; left: 0; z-index: 2; min-width: 140px; max-width: 180px; background: #fff; }
      #${ROOT_ID} .pc-sticky-2 { position: sticky; left: 140px; z-index: 2; min-width: 88px; background: #fff; }
      #${ROOT_ID} .pc-sticky-3 { position: sticky; left: 228px; z-index: 2; min-width: 100px; box-shadow: 2px 0 4px rgba(0,0,0,.06); background: #fff; }
      #${ROOT_ID} .pc-sticky-r2 { position: sticky; right: 80px; z-index: 2; min-width: 80px; background: #fff; }
      #${ROOT_ID} .pc-sticky-r1 { position: sticky; right: 0; z-index: 2; min-width: 80px; box-shadow: -2px 0 4px rgba(0,0,0,.06); background: #fff; }
      #${ROOT_ID} .pc-table th.pc-sticky-1, #${ROOT_ID} .pc-table th.pc-sticky-2,
      #${ROOT_ID} .pc-table th.pc-sticky-3 { background: #f9fafb; z-index: 6; }
      #${ROOT_ID} .pc-table th.pc-sticky-r1, #${ROOT_ID} .pc-table th.pc-sticky-r2 { background: #f9fafb; z-index: 6; }
      #${ROOT_ID} .pc-table td.pc-sticky-1, #${ROOT_ID} .pc-table td.pc-sticky-2,
      #${ROOT_ID} .pc-table td.pc-sticky-3, #${ROOT_ID} .pc-table td.pc-sticky-r1,
      #${ROOT_ID} .pc-table td.pc-sticky-r2 { background: #fff; }
      #${ROOT_ID} .pc-style-cell { white-space: normal; word-break: break-all; max-width: 180px; }
      #${ROOT_ID} .pc-activity-box {
        white-space: normal; min-width: 320px; max-width: 420px; padding: 8px;
        font-weight: normal; font-size: 12px; line-height: 1.5;
      }
      #${ROOT_ID} .pc-activity-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; align-items: center;
      }
      #${ROOT_ID} .pc-activity-item { display: flex; align-items: center; gap: 4px; min-width: 0; }
      #${ROOT_ID} .pc-activity-item span { flex-shrink: 0; white-space: nowrap; }
      #${ROOT_ID} .pc-activity-full-row { grid-column: 1 / -1; }
      #${ROOT_ID} .pc-activity-item input[type=text] { width: 52px; flex-shrink: 0; }
      #${ROOT_ID} .pc-activity-item input[type=checkbox] { flex-shrink: 0; }
      #${ROOT_ID} .pc-batch-header { font-weight: normal; vertical-align: middle; }
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
      #${ROOT_ID} .pc-activity-select {
        font-size: 12px; padding: 4px 24px 4px 8px; border: 1px solid #d1d5db; border-radius: 4px;
        background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E") no-repeat right 6px center;
        appearance: none; min-width: 72px; height: 28px; cursor: pointer; flex-shrink: 0;
      }
      #${ROOT_ID} .pc-fill-btn {
        grid-column: 1 / -1;
        margin-top: 4px; width: 100%; padding: 6px 10px; border: none; border-radius: 6px;
        background: #2563eb; color: #fff; cursor: pointer; font-size: 13px;
      }
      #${ROOT_ID} .pc-fill-btn:hover { background: #1d4ed8; }
      #${ROOT_ID} .pc-notice-layer {
        position: fixed; inset: 0; z-index: 2147483648;
        display: flex; align-items: center; justify-content: center;
        pointer-events: none;
      }
      #${ROOT_ID} .pc-notice {
        pointer-events: auto;
        display: flex; align-items: flex-start; gap: 12px;
        min-width: 280px; max-width: 420px;
        padding: 16px 18px; border-radius: 10px;
        background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.2);
        border: 1px solid #e5e7eb;
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
    `;
    document.documentElement.appendChild(style);
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

  /** @type {ReturnType<typeof setTimeout>|null} */
  let noticeTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
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

  /** @type {HTMLTableSectionElement|null} */
  let tbodyRef = null;

  function refreshTableBody() {
    if (tbodyRef) renderDataRows(tbodyRef);
  }

  function updateStickyHeaderOffset(table) {
    const row1 = table.querySelector('thead tr:first-child');
    if (!row1) return;
    table.style.setProperty('--pc-head-row1-h', `${row1.getBoundingClientRect().height}px`);
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
      if (options.min != null) v = Math.max(options.min, v);
      rows.forEach((row) => {
        row[field] = v;
      });
      onTableDataChange();
      showNotice(`批量设置完成：已设置 ${rows.length} 行`);
    });

    wrap.appendChild(input);
    wrap.appendChild(btn);
    th.appendChild(wrap);
  }

  function createSimpleHeaderTh(text, className) {
    const th = document.createElement('th');
    th.rowSpan = 2;
    if (className) th.className = className;
    th.innerHTML = `<span class="pc-th-title">${text}</span>`;
    return th;
  }

  function createColumnHeaderTh(text, field, className, batchOptions = {}) {
    const th = document.createElement('th');
    th.rowSpan = 2;
    th.className = ['pc-col-header', className].filter(Boolean).join(' ');
    th.innerHTML = `<span class="pc-th-title">${text}</span>`;
    appendBatchControls(th, field, batchOptions);
    return th;
  }

  function recalcAndUpdateOutputs() {
    recalcAllRows();
    if (!tbodyRef) return;
    const trs = tbodyRef.querySelectorAll('tr');
    rows.forEach((row, i) => {
      const tr = trs[i];
      if (!tr) return;
      const cells = tr.querySelectorAll('td');
      const marginInput = cells[5]?.querySelector('input');
      if (marginInput) {
        marginInput.value = row.marginRate != null ? `${row.marginRate}%` : '—';
      }
      const groupCell = cells[7];
      if (groupCell) {
        groupCell.textContent = row.groupPrice != null ? row.groupPrice.toFixed(2) : '—';
      }
      const singleCell = cells[8];
      if (singleCell) {
        singleCell.textContent = row.singlePrice != null ? row.singlePrice.toFixed(2) : '—';
      }
    });
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

  function createActivityLine(label, actKey) {
    const line = document.createElement('div');
    line.className = 'pc-activity-item';

    const span = document.createElement('span');
    span.textContent = label;

    const amt = document.createElement('input');
    amt.value = String(globalActivities[actKey].amount);

    const unit = document.createElement('span');
    unit.textContent = '元';

    bindGlobalDecimalInput(
      amt,
      () => globalActivities[actKey].amount,
      (v) => { globalActivities[actKey].amount = v; },
      onActivityChange,
      { min: 0 },
    );

    line.appendChild(span);
    line.appendChild(amt);
    line.appendChild(unit);
    return line;
  }

  function renderDataRows(tbody) {
    tbody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');

      const tdStyle = document.createElement('td');
      tdStyle.className = 'pc-sticky-1 pc-style-cell';
      tdStyle.textContent = row.style;

      const tdCost = document.createElement('td');
      tdCost.className = 'pc-sticky-2';
      const costInput = document.createElement('input');
      costInput.placeholder = '成本';
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

      const tdTarget = document.createElement('td');
      tdTarget.className = 'pc-sticky-3';
      const targetInput = document.createElement('input');
      targetInput.value = String(row.targetMargin);
      bindDecimalField(targetInput, row, 'targetMargin', onTableInputChange, {
        clampPercent: true, defaultValue: DEFAULTS.targetMargin,
      });
      tdTarget.appendChild(targetInput);

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

      const tdMargin = document.createElement('td');
      const marginInput = document.createElement('input');
      marginInput.type = 'text';
      marginInput.readOnly = true;
      marginInput.value = row.marginRate != null ? `${row.marginRate}%` : '—';
      tdMargin.appendChild(marginInput);

      const tdPlatform = document.createElement('td');
      const platformInput = document.createElement('input');
      platformInput.value = String(row.platformFee);
      bindDecimalField(platformInput, row, 'platformFee', onTableInputChange, {
        clampPercent: true, defaultValue: DEFAULTS.platformFee,
      });
      tdPlatform.appendChild(platformInput);

      const tdGroup = document.createElement('td');
      tdGroup.className = 'pc-sticky-r2 pc-result';
      tdGroup.textContent = row.groupPrice != null ? row.groupPrice.toFixed(2) : '—';

      const tdSingle = document.createElement('td');
      tdSingle.className = 'pc-sticky-r1 pc-result';
      tdSingle.textContent = row.singlePrice != null ? row.singlePrice.toFixed(2) : '—';

      tr.appendChild(tdStyle);
      tr.appendChild(tdCost);
      tr.appendChild(tdTarget);
      tr.appendChild(tdFreight);
      tr.appendChild(tdReturn);
      tr.appendChild(tdMargin);
      tr.appendChild(tdPlatform);
      tr.appendChild(tdGroup);
      tr.appendChild(tdSingle);
      tbody.appendChild(tr);
    });
  }

  function buildActivityHeaderCell() {
    const th = document.createElement('th');
    th.colSpan = 2;
    th.className = 'pc-activity-box';

    const grid = document.createElement('div');
    grid.className = 'pc-activity-grid';
    grid.appendChild(createActivityLine('订单复购券', 'reorder'));
    grid.appendChild(createActivityLine('店铺关注券', 'follow'));
    grid.appendChild(createActivityLine('新客立减券', 'newCustomer'));
    grid.appendChild(createActivityLine('直播券', 'live'));
    grid.appendChild(createActivityLine('场景券', 'scene'));

    const tlLine = document.createElement('div');
    tlLine.className = 'pc-activity-item pc-activity-full-row';
    const tlLabel = document.createElement('span');
    tlLabel.textContent = '限时限量购';
    const tlSelect = document.createElement('select');
    tlSelect.className = 'pc-activity-select';
    ['立减', '打折'].forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (globalActivities.timeLimit.type === opt) o.selected = true;
      tlSelect.appendChild(o);
    });
    const tlVal = document.createElement('input');
    tlVal.value = String(globalActivities.timeLimit.value);
    tlVal.placeholder = globalActivities.timeLimit.type === '打折' ? '六折填60' : '';
    const tlUnit = document.createElement('span');
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
    fillBtn.addEventListener('click', fillBackAll);
    grid.appendChild(fillBtn);

    th.appendChild(grid);
    return th;
  }

  function openPanel() {
    const root = ensureRoot();
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
    title.textContent = rows.length > 0 ? `价格计算器 — 共 ${rows.length} 个 SKU` : '价格计算器 — 未找到 SKU 表格';

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
      const headRow2 = document.createElement('tr');

      headRow1.appendChild(createSimpleHeaderTh('款式', 'pc-sticky-1'));
      headRow1.appendChild(createSimpleHeaderTh('成本（含人工）（元）', 'pc-sticky-2'));
      headRow1.appendChild(createColumnHeaderTh('目标销售利润率（%）', 'targetMargin', 'pc-sticky-3', {
        isPercent: true,
        placeholder: '%',
      }));
      headRow1.appendChild(createColumnHeaderTh('运费（运费险）（元）', 'freight', null, {
        min: 0,
        placeholder: '元',
      }));
      headRow1.appendChild(createColumnHeaderTh('退货率（%）', 'returnRate', null, {
        isPercent: true,
        placeholder: '%',
      }));
      headRow1.appendChild(createSimpleHeaderTh('实际利润率（%）'));
      headRow1.appendChild(createColumnHeaderTh('平台扣点（%）', 'platformFee', null, {
        decimal: true,
        isPercent: true,
        placeholder: '%',
      }));
      headRow1.appendChild(buildActivityHeaderCell());

      const hGroup = document.createElement('th');
      hGroup.className = 'pc-sticky-r2';
      hGroup.textContent = '拼单价（元）';
      const hSingle = document.createElement('th');
      hSingle.className = 'pc-sticky-r1';
      hSingle.textContent = '单买价（元）';
      headRow2.appendChild(hGroup);
      headRow2.appendChild(hSingle);

      thead.appendChild(headRow1);
      thead.appendChild(headRow2);

      const tbody = document.createElement('tbody');
      tbodyRef = tbody;
      renderDataRows(tbody);

      table.appendChild(thead);
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
      requestAnimationFrame(() => updateStickyHeaderOffset(table));
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

  /* 公式自检：平台扣点 0% 时 成本 5.94 → 拼单价 7.92 */
  function selfTestFormulas() {
    const row = {
      cost: '5.94',
      freight: 0,
      returnRate: 20,
      targetMargin: 20,
      platformFee: 0,
      singleRandomOffset: 4,
    };
    const r0 = calcRow(row, createDefaultActivities());
    console.assert(r0.groupPrice === 7.92, `expected group 7.92 got ${r0.groupPrice}`);
    console.assert(r0.singlePrice === calcSinglePrice(7.92, 0, 0, 4), `expected single ${calcSinglePrice(7.92, 0, 0, 4)} got ${r0.singlePrice}`);

    row.platformFee = 0.6;
    const r1 = calcRow(row, createDefaultActivities());
    console.assert(r1.groupPrice > 7.92, `expected group > 7.92 with fee got ${r1.groupPrice}`);
  }

  selfTestFormulas();
  createFab();
})();
