// ==UserScript==
// @name         规格名称批量粘贴
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.1.0
// @description  拼多多商家后台商品规格编辑页：在第一个规格名称框粘贴多值，自动拆分并依次填充
// @author       script_fun
// @match        *://mms.pinduoduo.com/*
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const SPEC_INPUT_SELECTOR = '.spec-input input[placeholder="请输入规格名称"]';
  const PASTE_SPLIT = /[\s,;，；|｜/／\\、\t\n\r]+/;
  const FILL_STEP_DELAY_MS = 100;
  const WAIT_TIMEOUT_MS = 3000;
  const TOAST_DURATION_MS = 3000;
  const TOAST_ID = 'sp-toast';

  let isFilling = false;

  function isSpecInput(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    return el.matches(SPEC_INPUT_SELECTOR);
  }

  /** 向上查找规格组根节点：父级存在多个含 .spec-input 的子树时停止 */
  function findGroupRoot(firstInput) {
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

  function getSpecInputsInGroup(firstInput) {
    const root = findGroupRoot(firstInput);
    return [...root.querySelectorAll(SPEC_INPUT_SELECTOR)];
  }

  function isFirstSpecInput(input) {
    if (!isSpecInput(input)) return false;
    const group = getSpecInputsInGroup(input);
    return group.length > 0 && group[0] === input;
  }

  function getAllSpecGroupRoots() {
    const roots = [];
    const seen = new Set();
    [...document.querySelectorAll(SPEC_INPUT_SELECTOR)].forEach((input) => {
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
        const inputs = [...groupRoot.querySelectorAll(SPEC_INPUT_SELECTOR)];
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
  }

  async function clearSpecInput(input) {
    if (input.value === '') return;
    input.focus();
    setInputValue(input, '');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
    input.blur();
    await delay(FILL_STEP_DELAY_MS);
  }

  async function clearSpecInputsFromIndex(groupRoot, fromIndex) {
    const inputs = [...groupRoot.querySelectorAll(SPEC_INPUT_SELECTOR)];
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
    if (!isFirstSpecInput(e.target)) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isFilling) return false;
    return true;
  }

  document.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertFromPaste') return;
    interceptPasteEvent(e);
  }, true);

  document.addEventListener('paste', (e) => {
    if (!interceptPasteEvent(e)) return;
    const text = e.clipboardData?.getData('text') || '';
    void handlePaste(e.target, text);
  }, true);
})();
