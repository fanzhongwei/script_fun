// ==UserScript==
// @name         1688库存检查
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.2.9
// @description  爱用分销商品管理：核对店铺 SKU 与 1688 货源库存，导出双 Sheet Excel
// @author       script_fun
// @match        *://light-app.1688.com/*
// @require      https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOW_STOCK_THRESHOLD = 20;
  const MAX_PRODUCT_RETRIES = 5;
  /** 返回商品列表后再检查下一件前的停顿，避免连续点开过于突兀 */
  const BETWEEN_PRODUCTS_MS = 1500;
  const BETWEEN_SHOPS_MS = 1500;

  const ROOT_ID = 'sc-overlay';
  const BTN_ID = 'sc-check-btn';
  const INJECTED_ATTR = 'data-sc-stock-check';
  const PENDING_RESULTS = new Set(['库存异常', '库存告急', '补充库存']);
  const EXCEL_HEADERS = [
    '店铺商品ID', '店铺商品名', '店铺SKU名', '店铺库存', '是否上架',
    '检查结果', '货源库存', '货源SKU名', '货源名称', '货源供应商',
  ];
  const MERGE_COLS = [0, 1, 8, 9];
  /** 列宽按列头字数，保证表头可见即可 */
  const EXCEL_COL_WIDTHS = [16, 14, 16, 12, 12, 12, 12, 16, 12, 14];

  let running = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(fn, timeoutMs = 20000, intervalMs = 200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const value = fn();
        if (value) return value;
      } catch (_) { /* ignore */ }
      await sleep(intervalMs);
    }
    return null;
  }

  function textOf(el) {
    return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function parseStock(text) {
    const raw = String(text || '').replace(/,/g, '');
    const m = raw.match(/库存[:：]?\s*(-?\d+)/);
    if (m) return Number(m[1]);
    return null;
  }

  function classifySku({ linked, onSale, shopStock, sourceStock }) {
    if (!linked) {
      if (onSale && shopStock != null && shopStock > 0) return '库存异常';
      return '关联异常';
    }
    if (!onSale && shopStock != null && shopStock > 0) return '关联异常';
    if (shopStock != null && sourceStock != null && shopStock > sourceStock) return '库存异常';
    if (shopStock === 0 && sourceStock != null && sourceStock > 0) return '补充库存';
    if (shopStock != null && shopStock > 0 && sourceStock != null && sourceStock <= LOW_STOCK_THRESHOLD) return '库存告急';
    return '库存正常';
  }

  function ensureOverlay() {
    let el = document.getElementById(ROOT_ID);
    if (el) return el;
    const style = document.createElement('style');
    style.textContent = [
      '#sc-overlay{position:fixed;top:12px;right:12px;left:auto;z-index:2147483646;min-width:260px;max-width:420px;',
      'background:#fff;border:1px solid #d9d9d9;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);',
      'padding:12px 14px;font-size:13px;color:#333;font-family:inherit;pointer-events:none;}',
      '#sc-overlay .sc-title{font-weight:600;margin-bottom:6px;}',
      '#sc-overlay .sc-line{line-height:1.6;}',
      '#sc-overlay .sc-actions{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;pointer-events:auto;}',
      '#sc-overlay button{cursor:pointer;pointer-events:auto;}',
      '#sc-check-btn{margin-left:8px;}',
    ].join('');
    document.head.appendChild(style);
    el = document.createElement('div');
    el.id = ROOT_ID;
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }

  function showProgress(message, extra, skuName) {
    const el = ensureOverlay();
    el.style.display = 'block';
    el.innerHTML = '<div class="sc-title">库存检查</div>'
      + '<div class="sc-line">' + escapeHtml(message) + '</div>'
      + (extra ? '<div class="sc-line">' + escapeHtml(extra) + '</div>' : '')
      + (skuName ? '<div class="sc-line">SKU：' + escapeHtml(skuName) + '</div>' : '');
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function clickTabOnly(el) {
    if (!el) return;
    const tab = el.closest('.ant-tabs-tab') || el.closest('[role="tab"]') || el;
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    tab.click();
  }

  function specMatchRoot() {
    return document.querySelector('.matchspecs-box')
      || document.querySelector('.relevance-baby');
  }

  function findSpecTab(prefix) {
    const root = specMatchRoot() || document;
    const tabs = root.querySelectorAll('.matchspecs-btns-tabs [role="tab"], .ant-tabs-nav-wrap [role="tab"], [role="tab"].ant-tabs-tab, .ant-tabs-tab');
    let fallback = null;
    for (const tab of tabs) {
      if (!textOf(tab).startsWith(prefix)) continue;
      if (tab.closest('.breadcrumb, .matchspecs-box-header .ant-breadcrumb')) continue;
      if (isVisible(tab)) return tab;
      if (!fallback) fallback = tab;
    }
    return fallback;
  }

  function findAllSpecsTab() {
    return findSpecTab('全部规格');
  }

  function isTabActive(tab) {
    return !!(tab && (tab.classList.contains('ant-tabs-tab-active') || tab.getAttribute('aria-selected') === 'true'));
  }

  async function waitPageAutoSwitchToLinkedNormal() {
    const hasNormalTab = await waitFor(() => findSpecTab('规格关联正常'), 5000);
    if (!hasNormalTab) return;
    const switched = await waitFor(() => isTabActive(findSpecTab('规格关联正常')), 8000);
    await sleep(switched ? 400 : 600);
  }

  async function forceSelectAllSpecsTab(tab) {
    clickTabOnly(tab);
  }

  async function clickAllSpecsTab(progress) {
    await waitFor(() => findAllSpecsTab(), 15000);
    if (progress) showProgress(progress.message, progress.productTitle, '等待页签自动切到「规格关联正常」…');
    await waitPageAutoSwitchToLinkedNormal();
    try { await waitSpecTableReady(); } catch (_) { /* 表稍后会再等 */ }
    if (!isSpecMatchPage()) throw new Error('规格匹配页已退出');
    const tab = findAllSpecsTab();
    if (!tab) throw new Error('未找到全部规格页签');
    if (isTabActive(tab)) {
      await sleep(200);
      return;
    }
    if (progress) showProgress(progress.message, progress.productTitle, '正在切换「全部规格」');
    for (let i = 0; i < 4; i += 1) {
      if (!isSpecMatchPage()) throw new Error('规格匹配页已退出');
      await forceSelectAllSpecsTab(findAllSpecsTab() || tab);
      const ok = await waitFor(() => isTabActive(findAllSpecsTab()), 2500);
      if (ok) {
        await sleep(400);
        return;
      }
      await sleep(300);
    }
    throw new Error('无法切换到全部规格页签');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function findBatchLinkBtn() {
    const line = document.querySelector('.relevance-box-header-new-line');
    if (!line) return null;
    const buttons = line.querySelectorAll('button');
    for (const btn of buttons) {
      if (textOf(btn).includes('批量关联货源')) return btn;
    }
    return null;
  }

  function getShopName() {
    return textOf(document.querySelector('.selected-shop-name')) || '未知店铺';
  }

  function listProductRows() {
    return Array.from(document.querySelectorAll('.relevance-table-row')).filter((row) => findSpecMatchBtn(row));
  }

  function findSpecMatchBtn(row) {
    const byAttr = row.querySelector('button[data-logger-action-type="ppgg"]');
    if (byAttr) return byAttr;
    const buttons = row.querySelectorAll('button');
    for (const btn of buttons) {
      if (textOf(btn) === '规格匹配') return btn;
    }
    return null;
  }

  function cleanProductTitle(raw) {
    return String(raw || '').replace(/^(1688|拼多多)\s*/, '').trim();
  }

  function productExtra(shopName, title) {
    const name = shopName || '';
    const t = title || '';
    if (name && t) return name + ' · ' + t;
    return name || t;
  }

  function shopTitleFromRow(row) {
    if (!row) return '';
    const tr = row.closest('tr') || row;
    return cleanProductTitle(textOf(
      tr.querySelector('.cell-shop-goods-info .table-title-text')
      || tr.querySelector('.shop-product-msg .table-title-text')
    ));
  }

  function snapshotCurrentPageTargets() {
    return listProductRows().map((row, index) => ({
      index,
      title: shopTitleFromRow(row) || ('商品' + (index + 1)),
    }));
  }

  async function waitProductListReady() {
    await waitFor(() => !isSpecMatchPage() && findBatchLinkBtn(), 20000);
    await waitFor(() => !document.querySelector('.relevance-table .ant-spin-spinning'), 20000);
    await sleep(400);
  }

  function productListPager() {
    const pagers = Array.from(document.querySelectorAll('ul.ant-pagination')).filter((p) => (
      !p.closest('.matchspecs-box, .specs-table-box')
    ));
    const byTotal = pagers.filter((p) => {
      const wrap = p.parentElement;
      const blob = textOf(p) + textOf(wrap) + textOf(wrap && wrap.parentElement);
      return /共\s*\d+\s*条/.test(blob);
    });
    const pool = (byTotal.length ? byTotal : pagers).filter(isVisible);
    return pool[pool.length - 1] || byTotal[byTotal.length - 1] || pagers[pagers.length - 1] || null;
  }

  function getActivePageNum(pager) {
    if (!pager) return 0;
    const n = parseInt(textOf(pager.querySelector('.ant-pagination-item-active')), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function parseProductListTotal() {
    const pager = productListPager();
    const wrap = pager && pager.parentElement;
    const blob = textOf(pager) + textOf(wrap) + textOf(wrap && wrap.parentElement);
    const m = blob.match(/共\s*(\d+)\s*条/);
    if (m) return Number(m[1]);
    return snapshotCurrentPageTargets().length;
  }

  async function gotoNextProductPage() {
    const pager = productListPager();
    if (!pager) return false;
    const nextLi = pager.querySelector('.ant-pagination-next');
    if (!nextLi || nextLi.classList.contains('ant-pagination-disabled') || nextLi.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    const prevNum = getActivePageNum(pager);
    const nextItem = prevNum ? pager.querySelector('.ant-pagination-item-' + (prevNum + 1)) : null;
    if (nextItem) nextItem.click();
    else {
      const clickable = nextLi.querySelector('a, button') || nextLi;
      clickable.click();
    }
    const ok = await waitFor(() => {
      const p = productListPager();
      const n = getActivePageNum(p);
      return n > 0 && n !== prevNum;
    }, 15000);
    if (!ok) return false;
    await waitProductListReady();
    return true;
  }

  function shopTrigger() {
    return document.querySelector('.nav-menu-select-shop .select-shop-main-select')
      || document.querySelector('.select-shop-main-select');
  }

  function shopItemName(el) {
    if (!el) return '';
    const named = el.querySelector('.shop-name, .select-shop-name, .selected-shop-name, td .shop-name, td');
    const t = textOf(named || el);
    if (/^店铺(名称|名)?$/.test(t)) return '';
    return t;
  }

  function shopItemNodes() {
    const nodes = [];
    document.querySelectorAll('.select-shop-table tbody tr, .select-shop-item, .select-shop-list-item').forEach((el) => nodes.push(el));
    document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) tbody tr, .ant-popover:not(.ant-popover-hidden) tbody tr').forEach((el) => {
      if (!el.closest('.matchspecs-box')) nodes.push(el);
    });
    const uniq = [];
    const seen = new Set();
    nodes.forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (shopItemName(el)) uniq.push(el);
    });
    return uniq;
  }

  async function collectShopNames() {
    const current = getShopName();
    const trigger = shopTrigger();
    if (!trigger) return current ? [current] : [];
    trigger.click();
    const items = await waitFor(() => {
      const list = shopItemNodes();
      return list.length ? list : null;
    }, 8000);
    const names = [];
    const seen = new Set();
    (items || []).forEach((el) => {
      const n = shopItemName(el);
      if (n && !seen.has(n)) {
        seen.add(n);
        names.push(n);
      }
    });
    trigger.click();
    await sleep(250);
    if (!names.length && current) names.push(current);
    const idx = names.indexOf(current);
    if (current && idx > 0) {
      names.splice(idx, 1);
      names.unshift(current);
    } else if (current && idx < 0) {
      names.unshift(current);
    }
    return names;
  }

  async function switchShop(name) {
    if (getShopName() === name) {
      await waitProductListReady();
      return;
    }
    const trigger = shopTrigger();
    if (!trigger) throw new Error('未找到店铺下拉');
    trigger.click();
    const item = await waitFor(() => shopItemNodes().find((el) => shopItemName(el) === name), 8000);
    if (!item) throw new Error('未找到店铺：' + name);
    item.click();
    const ok = await waitFor(() => getShopName() === name && !isSpecMatchPage(), 20000);
    if (!ok) throw new Error('切换店铺失败：' + name);
    await waitProductListReady();
  }

  function dismissAd() {
    const btn = document.querySelector('.ad-icon-btn');
    if (!btn || btn.offsetParent === null) return;
    if (btn.closest('.matchspecs-box-header, .breadcrumb, .ant-tabs, .specs-table-box')) return;
    btn.click();
  }

  function isSpecMatchPage() {
    const box = document.querySelector('.matchspecs-box');
    if (box && isVisible(box)) return true;
    const header = document.querySelector('.matchspecs-box-header');
    return !!(header && isVisible(header));
  }

  async function uncheckOnSaleOnly() {
    const wrap = document.querySelector('.show-on-sale-sku .ant-checkbox-wrapper');
    if (!wrap) return;
    const box = wrap.querySelector('.ant-checkbox');
    if (box && box.classList.contains('ant-checkbox-checked')) {
      wrap.click();
      await sleep(400);
    }
  }

  function specTableRoot() {
    return document.querySelector('.specs-table') || document.querySelector('.specs-table-box');
  }

  function parseShopProductMeta() {
    const box = document.querySelector('.shop-product-goods-box');
    let title = '';
    let id = '';
    if (box) {
      const titleNode = box.querySelector('.goods-card-info-title .goods-card-info-id');
      title = cleanProductTitle(textOf(titleNode));
      const ids = box.querySelectorAll('.goods-card-info-id');
      ids.forEach((node) => {
        const t = textOf(node);
        const m = t.match(/ID[:：]\s*(\d+)/);
        if (m) id = m[1];
      });
    }
    return { title, id };
  }

  function parseSourceProductMeta() {
    const card = document.querySelector('.product-goods-card, .product-goods-box .goods-card-box');
    let supplier = '';
    let name = '';
    if (card) {
      const nodes = card.querySelectorAll('.goods-card-info-id');
      nodes.forEach((node) => {
        const t = textOf(node);
        if (t.startsWith('供应商')) supplier = t.replace(/^供应商[:：]\s*/, '');
        else if (!t.startsWith('供应商') && t && t !== '1688') name = t;
      });
      if (!name) {
        const titleNode = card.querySelector('.goods-card-info-title .goods-card-info-id');
        name = textOf(titleNode);
      }
    }
    return { supplier, name };
  }

  function selectedSourceText(cell) {
    if (!cell) return '';
    return textOf(cell.querySelector('.ant-select-selection-selected-value, .ant-select-selection-item'));
  }

  function isLinkedSelect(cell) {
    const selectedText = selectedSourceText(cell);
    const placeholder = cell.querySelector('.ant-select-selection__placeholder, .ant-select-selection-placeholder');
    const phVisible = !!(placeholder && placeholder.style.display !== 'none' && isVisible(placeholder));
    if (/请选择货源规格/.test(selectedText)) return false;
    if (/默认规格/.test(selectedText)) return false;
    if (selectedText && !phVisible) return true;
    const sourceStock = parseStock(textOf(cell.querySelector('.product-specs-card-info-stock')));
    return sourceStock != null;
  }

  function isSkuOnSale(tr) {
    const switchBtn = tr.querySelector('button.ant-switch, .ant-switch');
    if (!switchBtn) return false;
    if (switchBtn.classList.contains('ant-switch-checked')) return true;
    return switchBtn.getAttribute('aria-checked') === 'true';
  }

  function parseSourceSkuName(selectedText) {
    const t = String(selectedText || '').trim();
    const m = t.match(/^货源[一二三四五六七八九十\d]+\s*[-—]\s*(.+)$/);
    return m ? m[1].trim() : t;
  }

  function parseSpecRow(tr, shopMeta, sourceMeta, shopName) {
    const skuTitle = textOf(tr.querySelector('.sku-info-title'));
    const shopStock = parseStock(textOf(tr.querySelector('.sku-info-stock')));
    const onSale = isSkuOnSale(tr);
    const specCell = tr.querySelector('.product-specs-column-specs') || tr;
    const linked = isLinkedSelect(specCell);
    const selectedText = selectedSourceText(specCell);
    const sourceStock = parseStock(textOf(specCell.querySelector('.product-specs-card-info-stock')));
    const sourceSkuName = linked ? parseSourceSkuName(selectedText) : '';
    const result = classifySku({
      linked,
      onSale,
      shopStock,
      sourceStock: linked ? sourceStock : null,
    });
    return {
      shopName,
      shopProductId: shopMeta.id,
      shopProductName: shopMeta.title,
      shopSkuName: skuTitle,
      shopStock,
      onSale: onSale ? '是' : '否',
      result,
      supplier: linked ? sourceMeta.supplier : '',
      sourceName: linked ? sourceMeta.name : '',
      sourceSkuName,
      sourceStock: linked ? sourceStock : '',
    };
  }

  async function waitSpecTableReady() {
    const table = await waitFor(() => specTableRoot(), 20000);
    if (!table) throw new Error('规格表未出现');
    await waitFor(() => {
      const spinning = document.querySelector('.specs-table-box .ant-spin-spinning');
      return !spinning && table.querySelector('tbody tr.ant-table-row');
    }, 15000);
    await sleep(200);
  }

  async function collectCurrentSpecPageRows(shopMeta, sourceMeta, shopName, progress) {
    await waitSpecTableReady();
    const rows = Array.from(document.querySelectorAll('.specs-table tbody tr.ant-table-row'));
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const parsed = parseSpecRow(rows[i], shopMeta, sourceMeta, shopName);
      if (progress) {
        showProgress(progress.message, progress.productTitle, parsed.shopSkuName || '（空规格名）');
      }
      out.push(parsed);
      await sleep(20);
    }
    return out;
  }

  async function collectAllSpecRows(shopName, progress) {
    dismissAd();
    await waitFor(() => findAllSpecsTab() || specTableRoot(), 20000);
    await clickAllSpecsTab(progress);
    await uncheckOnSaleOnly();
    await waitSpecTableReady();
    const shopMeta = parseShopProductMeta();
    const sourceMeta = parseSourceProductMeta();
    const ctx = progress || { message: '正在检查规格', productTitle: productExtra(shopName, shopMeta.title) };
    const rows = await collectCurrentSpecPageRows(shopMeta, sourceMeta, shopName, ctx);
    if (!rows.length) throw new Error('未解析到规格行');
    return { shopMeta, rows };
  }

  function findBackControl() {
    const header = document.querySelector('.matchspecs-box-header .breadcrumb');
    if (!header) return null;
    return header.querySelector('.anticon-left, .anticon-arrow-left, i.breadcrumb-separator, .breadcrumb-separator')
      || header.querySelector('a, .ant-breadcrumb-link')
      || header;
  }

  async function leaveSpecMatchPage() {
    if (!isSpecMatchPage()) return;
    dismissAd();
    const back = findBackControl();
    if (back) back.click();
    const ok = await waitFor(() => !isSpecMatchPage() && findBatchLinkBtn(), 20000);
    if (!ok) throw new Error('返回商品列表失败');
    await waitFor(() => listProductRows().length > 0, 15000);
    await sleep(400);
  }

  async function inspectOneProduct(target, shopName, seq, shopTotal) {
    const head = '正在检查 ' + seq + '/' + shopTotal;
    showProgress(head, productExtra(shopName, target.title));
    const rows = listProductRows();
    const row = rows[target.index];
    if (!row) throw new Error('未找到商品行');
    const btn = findSpecMatchBtn(row);
    if (!btn) throw new Error('未找到规格匹配');
    btn.click();
    const opened = await waitFor(() => isSpecMatchPage(), 20000);
    if (!opened) throw new Error('规格匹配页未打开');
    await waitFor(() => findAllSpecsTab() || findSpecTab('规格关联正常'), 15000);
    await sleep(600);
    const shopTitle = parseShopProductMeta().title || target.title;
    const extra = productExtra(shopName, shopTitle);
    showProgress(head, extra);
    const collected = await collectAllSpecRows(shopName, { message: head, productTitle: extra });
    await leaveSpecMatchPage();
    return collected.rows;
  }

  async function inspectProductWithRetry(target, shopName, seq, shopTotal) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_PRODUCT_RETRIES; attempt += 1) {
      try {
        if (isSpecMatchPage()) {
          try { await leaveSpecMatchPage(); } catch (_) { /* continue */ }
        }
        showProgress(
          '正在检查 ' + seq + '/' + shopTotal + (attempt > 1 ? '（重试 ' + attempt + '/' + MAX_PRODUCT_RETRIES + '）' : ''),
          productExtra(shopName, target.title),
        );
        return await inspectOneProduct(target, shopName, seq, shopTotal);
      } catch (err) {
        lastError = err;
        try { await leaveSpecMatchPage(); } catch (_) { /* ignore */ }
        await sleep(500);
      }
    }
    return [{
      shopName,
      shopProductId: '',
      shopProductName: target.title,
      shopSkuName: '',
      shopStock: '',
      onSale: '',
      result: '检查失败',
      supplier: '',
      sourceName: '',
      sourceSkuName: '',
      sourceStock: '',
      _fail: true,
      _error: lastError ? String(lastError.message || lastError) : '',
    }];
  }

  function rowToArray(row) {
    return [
      row.shopProductId,
      row.shopProductName,
      row.shopSkuName,
      row.shopStock === null || row.shopStock === undefined ? '' : row.shopStock,
      row.onSale || '',
      row.result,
      row.sourceStock === null || row.sourceStock === undefined ? '' : row.sourceStock,
      row.sourceSkuName,
      row.sourceName,
      row.supplier,
    ];
  }

  function productKey(row) {
    return String(row.shopProductId || '') + '\0' + String(row.shopProductName || '');
  }

  function groupRowsByProduct(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const k = productKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    const out = [];
    map.forEach((g) => { out.push.apply(out, g); });
    return out;
  }

  function applyProductMerges(ws, dataRows) {
    const merges = [];
    let i = 0;
    while (i < dataRows.length) {
      let j = i + 1;
      const key = productKey(dataRows[i]);
      while (j < dataRows.length && productKey(dataRows[j]) === key) j += 1;
      if (j - i > 1) {
        const start = i + 1;
        const end = j;
        MERGE_COLS.forEach((c) => {
          merges.push({ s: { r: start, c: c }, e: { r: end, c: c } });
        });
      }
      i = j;
    }
    if (merges.length) ws['!merges'] = merges;
  }

  function ensureCell(ws, r, c) {
    const addr = XLSX.utils.encode_cell({ r: r, c: c });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    return ws[addr];
  }

  function resultRowFill(result) {
    if (result === '库存异常') return { patternType: 'solid', fgColor: { rgb: 'FFFFC7CE' } };
    if (result === '库存告急') return { patternType: 'solid', fgColor: { rgb: 'FFFFFF99' } };
    return null;
  }

  function applySheetLayout(ws, dataRows) {
    applyProductMerges(ws, dataRows);
    ws['!cols'] = EXCEL_COL_WIDTHS.map((wch) => ({ wch }));
    ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const vCenter = { alignment: { vertical: 'center', wrapText: true } };
    const headerStyle = { font: { bold: true }, alignment: { vertical: 'center', wrapText: true } };
    EXCEL_HEADERS.forEach((_, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: c })];
      if (cell) cell.s = headerStyle;
    });
    const lastRow = dataRows.length;
    const colCount = EXCEL_HEADERS.length;
    for (let r = 1; r <= lastRow; r += 1) {
      const fill = resultRowFill(dataRows[r - 1].result);
      for (let c = 0; c < colCount; c += 1) {
        const cell = ensureCell(ws, r, c);
        const style = {};
        if (MERGE_COLS.indexOf(c) >= 0) Object.assign(style, vCenter);
        if (fill) style.fill = fill;
        if (Object.keys(style).length) cell.s = Object.assign({}, cell.s, style);
      }
    }
  }

  function buildWorkbook(rows) {
    if (typeof XLSX === 'undefined') throw new Error('未加载 SheetJS');
    const detail = groupRowsByProduct(rows);
    const pending = groupRowsByProduct(rows.filter((r) => PENDING_RESULTS.has(r.result)));
    const wb = XLSX.utils.book_new();
    const pendingSheet = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS].concat(pending.map(rowToArray)));
    const detailSheet = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS].concat(detail.map(rowToArray)));
    applySheetLayout(pendingSheet, pending);
    applySheetLayout(detailSheet, detail);
    XLSX.utils.book_append_sheet(wb, pendingSheet, '待处理库存');
    XLSX.utils.book_append_sheet(wb, detailSheet, '库存检查结果明细');
    return wb;
  }

  function groupRowsByShop(rows) {
    const map = {};
    rows.forEach((r) => {
      const shop = r.shopName || '未知店铺';
      if (!map[shop]) map[shop] = [];
      map[shop].push(r);
    });
    return map;
  }

  function downloadWorkbook(wb, shopName) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const safeShop = String(shopName || '店铺').replace(/[\\/:*?"<>|]/g, '_');
    const filename = '库存检查-' + safeShop + '-' + stamp + '.xlsx';
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function downloadByShop(rows) {
    const byShop = groupRowsByShop(rows);
    const shops = Object.keys(byShop);
    shops.forEach((shop, idx) => {
      setTimeout(() => downloadWorkbook(buildWorkbook(byShop[shop]), shop), idx * 2000);
    });
  }

  function countByResult(rows) {
    const map = {};
    rows.forEach((r) => {
      map[r.result] = (map[r.result] || 0) + 1;
    });
    return map;
  }

  function formatDuration(ms) {
    const sec = Math.max(0, Math.round(Number(ms) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h) return h + '小时' + m + '分' + s + '秒';
    if (m) return m + '分' + s + '秒';
    return s + '秒';
  }

  function showSummary(rows, productCount, elapsedMs) {
    const el = ensureOverlay();
    const skuCount = rows.filter((r) => r.result !== '检查失败').length;
    const failCount = rows.filter((r) => r.result === '检查失败').length;
    const counts = countByResult(rows);
    const byShop = groupRowsByShop(rows);
    const shops = Object.keys(byShop);
    const shopCount = shops.length;
    const lines = [
      '检查商品数：' + productCount,
      '店铺数：' + shopCount + '（按店铺分别下载）',
      'SKU 行数：' + skuCount,
      '库存异常：' + (counts['库存异常'] || 0),
      '库存告急：' + (counts['库存告急'] || 0),
      '补充库存：' + (counts['补充库存'] || 0),
      '关联异常：' + (counts['关联异常'] || 0),
      '库存正常：' + (counts['库存正常'] || 0),
      '检查失败商品数：' + failCount,
      '耗时：' + formatDuration(elapsedMs),
    ];
    el.style.display = 'block';
    el.innerHTML = '<div class="sc-title">库存检查完成</div>'
      + lines.map((l) => '<div class="sc-line">' + escapeHtml(l) + '</div>').join('')
      + '<div class="sc-actions">'
      + '<button type="button" class="ant-btn ant-btn-primary" id="sc-dl">下载 Excel</button>'
      + '<button type="button" class="ant-btn" id="sc-close">关闭</button>'
      + '</div>';
    el.querySelector('#sc-dl').addEventListener('click', () => downloadByShop(rows));
    el.querySelector('#sc-close').addEventListener('click', () => { el.style.display = 'none'; });
  }

  async function scanCurrentShop(shopName, counters) {
    const shopRows = [];
    let page = 0;
    let firstInShop = true;
    let shopSeq = 0;
    await waitProductListReady();
    const shopTotal = parseProductListTotal() || snapshotCurrentPageTargets().length;
    for (;;) {
      page += 1;
      await waitProductListReady();
      const targets = snapshotCurrentPageTargets();
      if (!targets.length && page === 1) return shopRows;
      for (let i = 0; i < targets.length; i += 1) {
        if (!firstInShop) {
          showProgress('即将检查下一件商品…', productExtra(shopName, targets[i].title));
          await sleep(BETWEEN_PRODUCTS_MS);
        }
        firstInShop = false;
        shopSeq += 1;
        counters.productCount += 1;
        const part = await inspectProductWithRetry(targets[i], shopName, shopSeq, shopTotal);
        shopRows.push.apply(shopRows, part);
      }
      const moved = await gotoNextProductPage();
      if (!moved) break;
    }
    return shopRows;
  }

  async function runCheck() {
    if (running) return;
    if (isSpecMatchPage()) {
      showProgress('请先返回商品管理列表再开始检查');
      return;
    }
    running = true;
    const checkBtn = document.getElementById(BTN_ID);
    if (checkBtn) checkBtn.disabled = true;
    const allRows = [];
    const counters = { productCount: 0 };
    const startedAt = Date.now();
    try {
      showProgress('正在读取店铺列表…');
      const shops = await collectShopNames();
      if (!shops.length) {
        showProgress('未找到店铺');
        return;
      }
      for (let s = 0; s < shops.length; s += 1) {
        const shopName = shops[s];
        if (s > 0) {
          showProgress('即将切换店铺…', shopName);
          await sleep(BETWEEN_SHOPS_MS);
        }
        showProgress('正在切换店铺 ' + (s + 1) + '/' + shops.length, shopName);
        await switchShop(shopName);
        const part = await scanCurrentShop(getShopName() || shopName, counters);
        allRows.push.apply(allRows, part);
        if (!part.length) {
          showProgress('当前店铺没有可检查的商品（需有「规格匹配」）', shopName);
        }
      }
      showSummary(allRows, counters.productCount, Date.now() - startedAt);
    } catch (err) {
      showProgress('检查中断', String(err && err.message ? err.message : err));
    } finally {
      running = false;
      if (checkBtn) checkBtn.disabled = false;
    }
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return true;
    const batch = findBatchLinkBtn();
    if (!batch || !batch.parentElement) return false;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = batch.className || 'ant-btn ant-btn-primary';
    btn.setAttribute(INJECTED_ATTR, '1');
    btn.innerHTML = '<span>库存检查</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runCheck();
    });
    batch.insertAdjacentElement('afterend', btn);
    return true;
  }

  function startWatch() {
    if (injectButton()) return;
    const obs = new MutationObserver(() => {
      if (injectButton()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setInterval(() => {
      if (injectButton()) {
        clearInterval(timer);
        obs.disconnect();
      }
    }, 800);
  }

  startWatch();
})();
