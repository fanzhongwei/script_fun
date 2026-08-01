// ==UserScript==
// @name         价格计算器
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.0.0
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

  const DEFAULTS = {
    freight: 0,
    returnRate: 20,
    targetMargin: 20,
    platformFee: 0.6,
  };

  /** @type {{ style: string, groupInput: HTMLInputElement, singleInput: HTMLInputElement, rowIndex: number, cost: string, freight: number, returnRate: number, targetMargin: number, platformFee: number, groupPrice: number|null, singlePrice: number|null, marginRate: number|null }[]} */
  let rows = [];

  /** @type {{ reorder: ActivityItem, follow: ActivityItem, newCustomer: ActivityItem, live: ActivityItem, scene: ActivityItem, timeLimit: TimeLimitItem }} */
  let globalActivities = createDefaultActivities();

  /** @typedef {{ checked: boolean, amount: number }} ActivityItem */
  /** @typedef {{ checked: boolean, type: '立减'|'打折', value: number }} TimeLimitItem */

  function createDefaultActivities() {
    return {
      reorder: { checked: false, amount: 0 },
      follow: { checked: false, amount: 0 },
      newCustomer: { checked: false, amount: 0 },
      live: { checked: false, amount: 0 },
      scene: { checked: false, amount: 0 },
      timeLimit: { checked: false, type: '立减', value: 0 },
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

  function calcBase(C, E, G, I, J) {
    const denom = (1 - I) - J / (1 - G);
    if (!(C > 0) || denom <= 0 || !Number.isFinite(denom)) return null;
    const N = (C + E) / denom;
    const K = round2(N);
    const L = round2(K * 1.2 + 5);
    return { K, L, N };
  }

  function calcExclusiveCandidate(key, K, L, amount) {
    const a = Math.max(0, amount || 0);
    switch (key) {
      case 'reorder':
      case 'follow': {
        const pin = round2((K + a) / 0.6);
        return { pin, single: round2(pin * 1.2 + 5), key };
      }
      case 'newCustomer': {
        const pin = round2(K + a);
        return { pin, single: round2((K + a) * 1.3 + 15), key };
      }
      case 'live':
      case 'scene': {
        const pin = round2((K + a + 5) / 0.6);
        return { pin, single: round2((L + a + 5) / 0.6), key };
      }
      default:
        return { pin: K, single: L, key: 'base' };
    }
  }

  function pickExclusiveResult(K, L, activities) {
    const candidates = [{ pin: K, single: L, key: 'base' }];
    const keys = ['reorder', 'follow', 'newCustomer', 'live', 'scene'];
    keys.forEach((key) => {
      const act = activities[key];
      if (act && act.checked) {
        candidates.push(calcExclusiveCandidate(key, K, L, act.amount));
      }
    });
    return candidates.reduce((best, cur) => (cur.pin > best.pin ? cur : best));
  }

  function applyTimeLimit(pin0, single0, timeLimit) {
    if (!timeLimit || !timeLimit.checked) {
      return { pin: pin0, single: single0 };
    }
    const v = Math.max(0, timeLimit.value || 0);
    if (timeLimit.type === '立减') {
      const pin = round2(pin0 + v);
      return { pin, single: round2(pin * 1.2 + 5) };
    }
    const factor = 1 - clampPercent(v) / 100;
    if (factor <= 0) return { pin: pin0, single: single0 };
    const pin = round2(pin0 / factor);
    return { pin, single: round2(pin * 1.2 + 5) };
  }

  function customerNetPrice(pin, baseK, activities, pickedKey) {
    let net = pin;
    if (pickedKey && pickedKey !== 'base') {
      net = pin - Math.max(0, activities[pickedKey]?.amount || 0);
    } else if (pickedKey === 'base') {
      net = baseK;
    }
    const tl = activities.timeLimit;
    if (tl && tl.checked) {
      if (tl.type === '立减') {
        net -= Math.max(0, tl.value || 0);
      } else {
        const factor = 1 - clampPercent(tl.value) / 100;
        if (factor > 0) net *= factor;
      }
    }
    return Math.max(0, net);
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

    const { K, L } = base;
    const picked = pickExclusiveResult(K, L, activities);
    const finalPrices = applyTimeLimit(picked.pin, picked.single, activities.timeLimit);

    const net = customerNetPrice(finalPrices.pin, K, activities, picked.key);
    let marginRate = null;
    if (net > 0) {
      const F = net * (1 - I) - C - E;
      marginRate = round2((F / net) * (1 - G) * 100);
    }

    return {
      groupPrice: finalPrices.pin,
      singlePrice: finalPrices.single,
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

  function scanTableElement(table) {
    const trs = [...table.querySelectorAll('tr')];
    let headerIndex = -1;
    let styleCol = -1;
    let groupCol = -1;
    let singleCol = -1;

    for (let i = 0; i < trs.length; i += 1) {
      const cells = getRowCells(trs[i]);
      const texts = cells.map(cellText);
      const sIdx = texts.findIndex((t) => t.includes('款式'));
      const gIdx = texts.findIndex((t) => t.includes('拼单价'));
      const siIdx = texts.findIndex((t) => t.includes('单买价'));
      if (sIdx >= 0 && gIdx >= 0) {
        headerIndex = i;
        styleCol = sIdx;
        groupCol = gIdx;
        singleCol = siIdx >= 0 ? siIdx : gIdx + 1;
        break;
      }
    }

    if (headerIndex < 0) return [];

    const result = [];
    for (let i = headerIndex + 1; i < trs.length; i += 1) {
      const cells = getRowCells(trs[i]);
      if (cells.length <= Math.max(styleCol, groupCol, singleCol)) continue;

      const style = (cells[styleCol].textContent || '').replace(/\s+/g, ' ').trim();
      const groupInput = findInputInCell(cells[groupCol]);
      const singleInput = singleCol >= 0 ? findInputInCell(cells[singleCol]) : null;
      if (!style || !groupInput) continue;

      result.push({
        style,
        groupInput,
        singleInput,
        rowIndex: result.length,
        cost: '',
        freight: DEFAULTS.freight,
        returnRate: DEFAULTS.returnRate,
        targetMargin: DEFAULTS.targetMargin,
        platformFee: DEFAULTS.platformFee,
        groupPrice: null,
        singlePrice: null,
        marginRate: null,
      });
    }
    return result;
  }

  function scanSkuTable() {
    const candidates = [];

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
    return text
      .split(PASTE_SPLIT)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
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

    showToast(`回填完成：成功 ${success} 行，跳过 ${skipped} 行，失败 ${fail} 行`);
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
      #${ROOT_ID} .pc-status { padding: 0 16px 8px; color: #6b7280; font-size: 13px; flex-shrink: 0; }
      #${ROOT_ID} .pc-body { flex: 1; overflow: hidden; padding: 0 12px 12px; }
      #${ROOT_ID} .pc-table-wrap { width: 100%; height: 100%; overflow: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
      #${ROOT_ID} .pc-table { border-collapse: separate; border-spacing: 0; min-width: 100%; font-size: 13px; }
      #${ROOT_ID} .pc-table th, #${ROOT_ID} .pc-table td {
        border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;
        padding: 6px 8px; background: #fff; vertical-align: middle; white-space: nowrap;
      }
      #${ROOT_ID} .pc-table th { background: #f9fafb; font-weight: 600; position: sticky; top: 0; z-index: 3; }
      #${ROOT_ID} .pc-table input[type=number], #${ROOT_ID} .pc-table input[type=text] {
        width: 72px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px;
      }
      #${ROOT_ID} .pc-table input:read-only { background: #f3f4f6; color: #374151; }
      #${ROOT_ID} .pc-sticky-1 { position: sticky; left: 0; z-index: 2; min-width: 140px; max-width: 180px; }
      #${ROOT_ID} .pc-sticky-2 { position: sticky; left: 140px; z-index: 2; min-width: 88px; }
      #${ROOT_ID} .pc-sticky-3 { position: sticky; left: 228px; z-index: 2; min-width: 100px; box-shadow: 2px 0 4px rgba(0,0,0,.06); }
      #${ROOT_ID} .pc-sticky-r2 { position: sticky; right: 88px; z-index: 2; min-width: 72px; }
      #${ROOT_ID} .pc-sticky-r1 { position: sticky; right: 0; z-index: 2; min-width: 72px; box-shadow: -2px 0 4px rgba(0,0,0,.06); }
      #${ROOT_ID} .pc-table th.pc-sticky-1, #${ROOT_ID} .pc-table th.pc-sticky-2,
      #${ROOT_ID} .pc-table th.pc-sticky-3, #${ROOT_ID} .pc-table th.pc-sticky-r1,
      #${ROOT_ID} .pc-table th.pc-sticky-r2 { z-index: 4; }
      #${ROOT_ID} .pc-style-cell { white-space: normal; word-break: break-all; max-width: 180px; }
      #${ROOT_ID} .pc-activity-box {
        white-space: normal; min-width: 220px; max-width: 280px; padding: 8px;
        font-weight: normal; font-size: 12px; line-height: 1.6;
      }
      #${ROOT_ID} .pc-activity-line { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; flex-wrap: wrap; }
      #${ROOT_ID} .pc-activity-line input[type=number] { width: 56px; }
      #${ROOT_ID} .pc-activity-line select { font-size: 12px; padding: 2px 4px; }
      #${ROOT_ID} .pc-fill-btn {
        margin-top: 8px; width: 100%; padding: 6px 10px; border: none; border-radius: 6px;
        background: #2563eb; color: #fff; cursor: pointer; font-size: 13px;
      }
      #${ROOT_ID} .pc-fill-btn:hover { background: #1d4ed8; }
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

  function showToast(message) {
    const status = document.querySelector(`#${ROOT_ID} .pc-status`);
    if (status) status.textContent = message;
  }

  function bindPercentInput(input, row, field, onChange) {
    input.addEventListener('input', () => {
      let v = parseNum(input.value);
      if (!Number.isFinite(v)) return;
      v = clampPercent(v);
      row[field] = v;
      input.value = String(v);
      onChange();
    });
  }

  function bindNumberInput(input, row, field, onChange, allowEmpty) {
    input.addEventListener('input', () => {
      if (allowEmpty && input.value.trim() === '') {
        row[field] = allowEmpty ? '' : 0;
        onChange();
        return;
      }
      const v = parseNum(input.value);
      if (!Number.isFinite(v)) return;
      row[field] = v;
      onChange();
    });
  }

  /** @type {HTMLTableSectionElement|null} */
  let tbodyRef = null;

  function refreshTableBody() {
    if (tbodyRef) renderDataRows(tbodyRef);
  }

  function createActivityLine(label, actKey) {
    const line = document.createElement('div');
    line.className = 'pc-activity-line';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = globalActivities[actKey].checked;

    const span = document.createElement('span');
    span.textContent = label;

    const amt = document.createElement('input');
    amt.type = 'number';
    amt.min = '0';
    amt.step = '0.01';
    amt.value = String(globalActivities[actKey].amount);

    const unit = document.createElement('span');
    unit.textContent = '元';

    const refresh = () => {
      globalActivities[actKey].checked = cb.checked;
      globalActivities[actKey].amount = Math.max(0, parseNum(amt.value) || 0);
      amt.value = String(globalActivities[actKey].amount);
      recalcAllRows();
      refreshTableBody();
    };

    cb.addEventListener('change', refresh);
    amt.addEventListener('input', refresh);

    line.appendChild(cb);
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
      costInput.type = 'text';
      costInput.placeholder = '成本';
      costInput.value = row.cost;
      bindNumberInput(costInput, row, 'cost', () => {
        recalcAllRows();
        refreshTableBody();
      }, true);
      costInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const values = parsePasteValues(e.clipboardData?.getData('text') || '');
        if (values.length === 0) return;
        const start = row.rowIndex;
        let filled = 0;
        let discarded = 0;
        values.forEach((val, idx) => {
          const target = rows[start + idx];
          if (target) {
            target.cost = String(val);
            filled += 1;
          } else {
            discarded += 1;
          }
        });
        recalcAllRows();
        refreshTableBody();
        if (discarded > 0) {
          showToast(`已粘贴 ${filled} 项，超出 ${discarded} 项已丢弃`);
        } else {
          showToast(`已粘贴 ${filled} 项成本`);
        }
      });
      tdCost.appendChild(costInput);

      const tdTarget = document.createElement('td');
      tdTarget.className = 'pc-sticky-3';
      const targetInput = document.createElement('input');
      targetInput.type = 'number';
      targetInput.min = '0';
      targetInput.max = '100';
      targetInput.step = '0.01';
      targetInput.value = String(row.targetMargin);
      bindPercentInput(targetInput, row, 'targetMargin', () => {
        recalcAllRows();
        refreshTableBody();
      });
      tdTarget.appendChild(targetInput);

      const tdFreight = document.createElement('td');
      const freightInput = document.createElement('input');
      freightInput.type = 'number';
      freightInput.min = '0';
      freightInput.step = '0.01';
      freightInput.value = String(row.freight);
      bindNumberInput(freightInput, row, 'freight', () => {
        recalcAllRows();
        refreshTableBody();
      });
      tdFreight.appendChild(freightInput);

      const tdReturn = document.createElement('td');
      const returnInput = document.createElement('input');
      returnInput.type = 'number';
      returnInput.min = '0';
      returnInput.max = '100';
      returnInput.step = '0.01';
      returnInput.value = String(row.returnRate);
      bindPercentInput(returnInput, row, 'returnRate', () => {
        recalcAllRows();
        refreshTableBody();
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
      platformInput.type = 'number';
      platformInput.min = '0';
      platformInput.max = '100';
      platformInput.step = '0.01';
      platformInput.value = String(row.platformFee);
      bindPercentInput(platformInput, row, 'platformFee', () => {
        recalcAllRows();
        refreshTableBody();
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
    th.rowSpan = 1;
    th.className = 'pc-activity-box';

    const box = document.createElement('div');
    box.appendChild(createActivityLine('订单复购券', 'reorder'));
    box.appendChild(createActivityLine('店铺关注券', 'follow'));
    box.appendChild(createActivityLine('新客立减券', 'newCustomer'));
    box.appendChild(createActivityLine('直播券', 'live'));
    box.appendChild(createActivityLine('场景券', 'scene'));

    const tlLine = document.createElement('div');
    tlLine.className = 'pc-activity-line';
    const tlCb = document.createElement('input');
    tlCb.type = 'checkbox';
    tlCb.checked = globalActivities.timeLimit.checked;
    const tlLabel = document.createElement('span');
    tlLabel.textContent = '时限量购';
    const tlSelect = document.createElement('select');
    ['立减', '打折'].forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (globalActivities.timeLimit.type === opt) o.selected = true;
      tlSelect.appendChild(o);
    });
    const tlVal = document.createElement('input');
    tlVal.type = 'number';
    tlVal.min = '0';
    tlVal.step = '0.01';
    tlVal.value = String(globalActivities.timeLimit.value);
    const tlUnit = document.createElement('span');
    tlUnit.textContent = '%或元';

    const tlRefresh = () => {
      globalActivities.timeLimit.checked = tlCb.checked;
      globalActivities.timeLimit.type = tlSelect.value;
      globalActivities.timeLimit.value = Math.max(0, parseNum(tlVal.value) || 0);
      tlVal.value = String(globalActivities.timeLimit.value);
      tlUnit.textContent = globalActivities.timeLimit.type === '打折' ? '%' : '元';
      if (globalActivities.timeLimit.type === '打折') {
        tlVal.max = '100';
      } else {
        tlVal.removeAttribute('max');
      }
      recalcAllRows();
      refreshTableBody();
    };

    tlCb.addEventListener('change', tlRefresh);
    tlSelect.addEventListener('change', tlRefresh);
    tlVal.addEventListener('input', tlRefresh);

    tlLine.appendChild(tlCb);
    tlLine.appendChild(tlLabel);
    tlLine.appendChild(tlSelect);
    tlLine.appendChild(tlVal);
    tlLine.appendChild(tlUnit);
    box.appendChild(tlLine);

    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'pc-fill-btn';
    fillBtn.textContent = '回填';
    fillBtn.addEventListener('click', fillBackAll);
    box.appendChild(fillBtn);

    th.appendChild(box);
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

    const status = document.createElement('div');
    status.className = 'pc-status';

    const body = document.createElement('div');
    body.className = 'pc-body';

    if (rows.length === 0) {
      body.innerHTML = '<div class="pc-empty">未找到包含「款式」与「拼单价」列的 SKU 表格。<br>请确认当前页面为商品规格编辑页后点击「刷新」。</div>';
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'pc-table-wrap';

      const table = document.createElement('table');
      table.className = 'pc-table';

      const thead = document.createElement('thead');
      const headRow1 = document.createElement('tr');

      const hStyle = document.createElement('th');
      hStyle.className = 'pc-sticky-1';
      hStyle.rowSpan = 2;
      hStyle.textContent = '款式';

      const hCost = document.createElement('th');
      hCost.className = 'pc-sticky-2';
      hCost.rowSpan = 2;
      hCost.textContent = '成本（含人工）';

      const hTarget = document.createElement('th');
      hTarget.className = 'pc-sticky-3';
      hTarget.rowSpan = 2;
      hTarget.textContent = '目标销售利润率';

      const hFreight = document.createElement('th');
      hFreight.rowSpan = 2;
      hFreight.textContent = '运费（运费险）';

      const hReturn = document.createElement('th');
      hReturn.rowSpan = 2;
      hReturn.textContent = '退货率';

      const hMargin = document.createElement('th');
      hMargin.rowSpan = 2;
      hMargin.textContent = '利润率';

      const hPlatform = document.createElement('th');
      hPlatform.rowSpan = 2;
      hPlatform.textContent = '平台扣点';

      const hActivity = buildActivityHeaderCell();

      headRow1.appendChild(hStyle);
      headRow1.appendChild(hCost);
      headRow1.appendChild(hTarget);
      headRow1.appendChild(hFreight);
      headRow1.appendChild(hReturn);
      headRow1.appendChild(hMargin);
      headRow1.appendChild(hPlatform);
      headRow1.appendChild(hActivity);

      const headRow2 = document.createElement('tr');
      const hGroup = document.createElement('th');
      hGroup.className = 'pc-sticky-r2';
      hGroup.textContent = '拼单价';
      const hSingle = document.createElement('th');
      hSingle.className = 'pc-sticky-r1';
      hSingle.textContent = '单买价';
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
    }

    panel.appendChild(header);
    panel.appendChild(status);
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

  /* 公式自检：平台扣点 0% 时 成本 5.94 → 拼单价 7.92、单买价 14.50 */
  function selfTestFormulas() {
    const row = {
      cost: '5.94',
      freight: 0,
      returnRate: 20,
      targetMargin: 20,
      platformFee: 0,
    };
    const r0 = calcRow(row, createDefaultActivities());
    console.assert(r0.groupPrice === 7.92, `expected group 7.92 got ${r0.groupPrice}`);
    console.assert(r0.singlePrice === 14.5, `expected single 14.5 got ${r0.singlePrice}`);

    row.platformFee = 0.6;
    const r1 = calcRow(row, createDefaultActivities());
    console.assert(r1.groupPrice > 7.92, `expected group > 7.92 with fee got ${r1.groupPrice}`);
  }

  selfTestFormulas();
  createFab();
})();
