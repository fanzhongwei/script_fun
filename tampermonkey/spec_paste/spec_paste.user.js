// ==UserScript==
// @name         规格名称批量粘贴
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.2.3
// @description  拼多多商家后台商品规格编辑页：在第一个规格名称框粘贴多值，自动拆分并依次填充
// @author       script_fun
// @match        *://mms.pinduoduo.com/*
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const SPEC_NAME_PLACEHOLDER = '请输入规格名称';
  /** 旧版：.spec-input；新版：#newSpec / .goods-sku-box / .package-container */
  const LEGACY_SPEC_INPUT_SELECTOR = `.spec-input input[placeholder="${SPEC_NAME_PLACEHOLDER}"]`;
  const NEW_SPEC_SCOPE_SELECTOR = [
    '.custom-input-container',
    '.package-item-container',
    '.package-container',
    '.property-values-container',
    '.custom-package',
    '.property-container-v2',
    '.goods-sku-box',
    '#newSpec',
    '#stand_spec',
  ].join(', ');
  const PASTE_SPLIT = /[\s,;，；|｜/／\\、\t\n\r]+/;
  const FILL_STEP_DELAY_MS = 100;
  const WAIT_TIMEOUT_MS = 3000;
  const TOAST_DURATION_MS = 3000;
  const TOAST_ID = 'sp-toast';

  let isFilling = false;

  function isLegacySpecInput(input) {
    return input instanceof HTMLInputElement && input.matches(LEGACY_SPEC_INPUT_SELECTOR);
  }

  /** 排除 SKU 价格/库存表内的 input */
  function isInSkuPriceTable(el) {
    return !!el.closest(
      'table[class*="TB_tableWrapper"], [class*="TB_body"], [data-testid="beast-core-table-middle-body"]',
    );
  }

  /**
   * 排除价格表头「全部颜色/全部尺寸」等筛选下拉及其搜索框。
   * 批量填充 blur 后焦点可能落到这些控件，导致复制中断。
   */
  function isInSkuBatchFilter(el) {
    if (!el || !el.closest) return false;
    if (el.closest([
      '[data-testid*="select"]',
      '[data-testid*="Select"]',
      '[class*="ST_"]',
      '[class*="Select"]',
      '[role="listbox"]',
      '[role="combobox"]',
      '[class*="dropdown"]',
      '[class*="Dropdown"]',
      '[class*="popover"]',
      '[class*="Popover"]',
      '[class*="overlay"]',
    ].join(', '))) {
      return true;
    }

    let node = el;
    for (let i = 0; i < 10 && node && node !== document.body; i += 1, node = node.parentElement) {
      const text = (node.textContent || '').replace(/\s+/g, ' ');
      if (!/全部颜色|全部尺寸|全部规格/.test(text)) continue;
      if (/批量设置|拼单价|单买价|规格编码|库存/.test(text)) return true;
    }
    return false;
  }

  function looksLikeSpecNamePlaceholder(placeholder, allowEmpty) {
    const text = String(placeholder || '').trim();
    if (!text) return !!allowEmpty;
    if (text === SPEC_NAME_PLACEHOLDER) return true;
    // 新版自定义规格：自定义尺寸 / 自定义重量 / 自定义颜色 …
    if (/^自定义/.test(text)) return true;
    if (/规格名称|请输入规格|输入规格|规格值/.test(text)) return true;
    if (text === '请输入') return true;
    if (/库存|价格|编码|数量|重量单位|拼单价|单买价|全部颜色|全部尺寸|搜索/.test(text)) return false;
    return false;
  }

  function isNewLayoutSpecInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.type && input.type !== 'text' && input.type !== 'search') return false;
    if (isInSkuPriceTable(input) || isInSkuBatchFilter(input)) return false;
    // 新版最稳锚点：自定义规格输入容器内的 beast-core input
    if (input.closest('.custom-input-container, .package-item-container')) {
      return looksLikeSpecNamePlaceholder(input.placeholder, true)
        || !/库存|价格|编码|拼单价|单买价|全部颜色|全部尺寸|搜索/.test(input.placeholder || '');
    }
    // 勿仅凭 .goods-sku-box 放宽：会误收价格表头筛选 input
    if (!input.closest([
      '.custom-input-container',
      '.package-item-container',
      '.package-container',
      '.property-values-container',
      '.custom-package',
      '.property-container-v2',
      '#newSpec',
      '#stand_spec',
    ].join(', '))) {
      return false;
    }
    return looksLikeSpecNamePlaceholder(input.placeholder, false);
  }

  /** blur 后若焦点掉到表头筛选下拉，立刻移开，避免中断后续填充 */
  function dismissStraySkuFilterFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (isInSkuBatchFilter(active) || isInSkuPriceTable(active)) {
      active.blur();
    }
  }

  function isSpecInput(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (isInSkuPriceTable(el) || isInSkuBatchFilter(el)) return false;
    return isLegacySpecInput(el) || isNewLayoutSpecInput(el);
  }

  function querySpecInputs(root) {
    if (!root) return [];
    return [...root.querySelectorAll('input')].filter(isSpecInput);
  }

  function getAllSpecNameInputs() {
    const scopes = document.querySelectorAll('#goods-spec-sku, #sku, #newSpec, .goods-sku-box');
    const seen = new Set();
    const inputs = [];
    const collect = (root) => {
      querySpecInputs(root).forEach((input) => {
        if (seen.has(input)) return;
        seen.add(input);
        inputs.push(input);
      });
    };
    scopes.forEach(collect);
    if (inputs.length === 0) collect(document);
    return inputs;
  }

  /** 旧版：向上查找规格组根节点，父级存在多个含 .spec-input 的子树时停止 */
  function findGroupRootLegacy(firstInput) {
    const row = firstInput.closest('.spec-input');
    if (!row) return document.body;

    let root = row;
    while (root.parentElement && root.parentElement !== document.body) {
      const parent = root.parentElement;
      const clusters = [...parent.children].filter((el) => el.querySelector('.spec-input'));
      if (clusters.length > 1) break;
      root = parent;
    }
    return root;
  }

  /** 新版：优先 package-container（同组多个 package-item） */
  function findGroupRootNew(firstInput) {
    const packageContainer = firstInput.closest('.package-container');
    if (packageContainer && querySpecInputs(packageContainer).length > 0) {
      return packageContainer;
    }
    const valuesRoot = firstInput.closest('.property-values-container');
    if (valuesRoot && querySpecInputs(valuesRoot).length > 0) {
      return valuesRoot;
    }
    const preferred = firstInput.closest('.custom-package, .property-container-v2');
    if (preferred && querySpecInputs(preferred).length > 0) {
      return preferred;
    }

    const scope = firstInput.closest('.goods-sku-box, #newSpec, #stand_spec, #goods-spec-sku')
      || document.body;

    let el = firstInput;
    while (el && el !== scope) {
      const hasDelete = [...el.querySelectorAll('a, button, span')].some(
        (node) => /删除规格类型|删除/.test((node.textContent || '').replace(/\s+/g, '')),
      );
      if (hasDelete && querySpecInputs(el).length > 0) return el;
      el = el.parentElement;
    }

    let root = firstInput.closest('[data-testid="beast-core-grid-col-wrapper"]')
      || firstInput.closest('[data-testid="beast-core-input"]')
      || firstInput;

    while (root.parentElement && root.parentElement !== scope && scope.contains(root.parentElement)) {
      const parent = root.parentElement;
      const clusters = [...parent.children].filter((child) => querySpecInputs(child).length > 0);
      if (clusters.length > 1) break;
      root = parent;
    }
    return root;
  }

  function findGroupRoot(firstInput) {
    if (firstInput.closest('.spec-input')) return findGroupRootLegacy(firstInput);
    return findGroupRootNew(firstInput);
  }

  function getSpecInputsInGroup(firstInput) {
    const root = findGroupRoot(firstInput);
    return querySpecInputs(root);
  }

  function isFirstSpecInput(input) {
    if (!isSpecInput(input)) return false;
    const group = getSpecInputsInGroup(input);
    return group.length > 0 && group[0] === input;
  }

  function getAllSpecGroupRoots() {
    const roots = [];
    const seen = new Set();
    getAllSpecNameInputs().forEach((input) => {
      if (!isFirstSpecInput(input)) return;
      const root = findGroupRoot(input);
      if (seen.has(root)) return;
      seen.add(root);
      roots.push(root);
    });
    return roots;
  }

  function getGroupColumnIndex(firstInput) {
    const root = findGroupRoot(firstInput);
    const idx = getAllSpecGroupRoots().indexOf(root);
    return idx >= 0 ? idx : 0;
  }

  function parseTextRows(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function dedupeOrdered(values) {
    const seen = new Set();
    const result = [];
    values.forEach((v) => {
      const key = String(v).trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(key);
    });
    return result;
  }

  /** 多列 Tab 表格：取当前规格组对应列并按首次出现顺序去重；单列/单行仍兼容旧分隔符 */
  function parseSpecNames(text, columnIndex) {
    const lines = parseTextRows(text);
    if (lines.length === 0) return [];

    const hasTabs = lines.some((line) => line.includes('\t'));
    if (hasTabs) {
      const col = columnIndex >= 0 ? columnIndex : 0;
      const values = lines
        .map((line) => {
          const parts = line.split('\t').map((s) => s.trim());
          return parts[col] || '';
        })
        .filter(Boolean);
      return dedupeOrdered(values);
    }

    if (lines.length > 1) {
      return dedupeOrdered(lines);
    }

    return dedupeOrdered(
      lines[0].split(PASTE_SPLIT).map((s) => s.trim()).filter(Boolean),
    );
  }

  function setInputValue(input, value) {
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForSpecInput(groupRoot, index, minLength, timeout = WAIT_TIMEOUT_MS) {
    const start = Date.now();
    const requiredLength = minLength != null ? minLength : index + 1;

    return new Promise((resolve) => {
      let pollTimer = null;
      let observer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
      };

      const check = () => {
        const inputs = querySpecInputs(groupRoot);
        if (inputs.length >= requiredLength && inputs[index]) {
          cleanup();
          resolve(inputs[index]);
          return true;
        }
        if (Date.now() - start >= timeout) {
          cleanup();
          resolve(null);
          return true;
        }
        return false;
      };

      if (check()) return;

      observer = new MutationObserver(() => {
        check();
      });
      observer.observe(groupRoot, { childList: true, subtree: true });
      pollTimer = setInterval(check, 50);
    });
  }

  function showToast(message) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.style.cssText = [
        'position:fixed',
        'top:50%',
        'left:50%',
        'transform:translate(-50%,-50%)',
        'z-index:2147483646',
        'max-width:360px',
        'padding:12px 18px',
        'background:#1f2937',
        'color:#f9fafb',
        'font-size:14px',
        'line-height:1.5',
        'text-align:center',
        'border-radius:8px',
        'box-shadow:0 4px 16px rgba(0,0,0,.2)',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity .2s ease',
      ].join(';');
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.style.opacity = '0';
    }, TOAST_DURATION_MS);
  }

  async function commitSpecInput(input, value) {
    input.focus();
    setInputValue(input, value);
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
    input.blur();
    await delay(FILL_STEP_DELAY_MS);
    dismissStraySkuFilterFocus();
  }

  async function clearSpecInput(input) {
    if (input.value === '') return;
    input.focus();
    setInputValue(input, '');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
    input.blur();
    await delay(FILL_STEP_DELAY_MS);
    dismissStraySkuFilterFocus();
  }

  async function clearSpecInputsFromIndex(groupRoot, fromIndex) {
    const inputs = querySpecInputs(groupRoot);
    for (let j = inputs.length - 1; j >= fromIndex; j -= 1) {
      await clearSpecInput(inputs[j]);
    }
  }

  async function fillSpecGroup(firstInput, names) {
    const groupRoot = findGroupRoot(firstInput);
    let filled = 0;

    // 先清空 sibling 框，避免写入首项 blur 校验时与旧值撞重复名
    await clearSpecInputsFromIndex(groupRoot, 1);

    for (let i = 0; i < names.length; i += 1) {
      let input;
      if (i === 0) {
        input = firstInput;
      } else {
        const minLength = i + 1;
        input = await waitForSpecInput(groupRoot, i, minLength);
        if (!input) {
          const remaining = names.length - filled;
          showToast(`已填充 ${filled} 项，剩余 ${remaining} 项超时未填入`);
          return { filled, remaining };
        }
      }
      await commitSpecInput(input, names[i]);
      filled += 1;
    }

    await clearSpecInputsFromIndex(groupRoot, names.length);

    showToast(`已填充 ${filled} 项规格`);
    return { filled, remaining: 0 };
  }

  function resolvePasteTarget(target) {
    if (target instanceof HTMLInputElement && isSpecInput(target)) return target;
    if (!(target instanceof Element)) return null;
    const nested = target.querySelector?.('input');
    if (nested instanceof HTMLInputElement && isSpecInput(nested)) return nested;
    const closestInput = target.closest?.('input');
    if (closestInput instanceof HTMLInputElement && isSpecInput(closestInput)) return closestInput;
    // 点在 package-container 空白处粘贴时，取该容器内第一个规格框
    const container = target.closest?.(
      '.package-container, .property-values-container, .custom-package, .property-container-v2',
    );
    if (container) {
      const inputs = querySpecInputs(container);
      if (inputs.length > 0) return inputs[0];
    }
    return null;
  }

  async function handlePaste(firstInput, text) {
    const columnIndex = getGroupColumnIndex(firstInput);
    const names = parseSpecNames(text, columnIndex);
    if (names.length === 0) {
      showToast('未识别到有效规格名称');
      return;
    }

    isFilling = true;
    try {
      await fillSpecGroup(firstInput, names);
    } finally {
      isFilling = false;
    }
  }

  function interceptPasteEvent(e) {
    const input = resolvePasteTarget(e.target);
    if (!input || !isFirstSpecInput(input)) return null;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isFilling) return null;
    return input;
  }

  document.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertFromPaste') return;
    interceptPasteEvent(e);
  }, true);

  document.addEventListener('paste', (e) => {
    const input = interceptPasteEvent(e);
    if (!input) return;
    const text = e.clipboardData?.getData('text') || '';
    void handlePaste(input, text);
  }, true);
})();
