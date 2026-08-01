// ==UserScript==
// @name         规格名称批量粘贴
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.0.7
// @description  拼多多商家后台商品规格编辑页：在第一个规格名称框粘贴多值，自动拆分并依次填充
// @author       script_fun
// @match        *://mms.pinduoduo.com/*
// @run-at       document-idle
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

  function parseSpecNames(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .split(PASTE_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function setInputValue(input, value) {
    if (!input) return false;
    const strValue = String(value);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, strValue);
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
      data: strValue === '' ? null : strValue,
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function dispatchBlur(input) {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: true }));
    input.blur();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForSpecInput(groupRoot, index, timeout = WAIT_TIMEOUT_MS) {
    const start = Date.now();

    return new Promise((resolve) => {
      let pollTimer = null;
      let observer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
      };

      const check = () => {
        const inputs = [...groupRoot.querySelectorAll(SPEC_INPUT_SELECTOR)];
        if (inputs[index]) {
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

  async function fillAndBlur(input, value) {
    setInputValue(input, value);
    dispatchBlur(input);
    await delay(FILL_STEP_DELAY_MS);
  }

  async function fillSpecGroup(firstInput, names) {
    const groupRoot = findGroupRoot(firstInput);
    let filled = 0;

    for (let i = 0; i < names.length; i += 1) {
      let input;
      if (i === 0) {
        input = firstInput;
      } else {
        input = await waitForSpecInput(groupRoot, i);
        if (!input) {
          const remaining = names.length - filled;
          showToast(`已填充 ${filled} 项，剩余 ${remaining} 项超时未填入`);
          return { filled, remaining };
        }
      }
      if (i === 0) {
        setInputValue(input, names[i]);
        dispatchBlur(input);
        await delay(FILL_STEP_DELAY_MS);
      } else {
        await fillAndBlur(input, names[i]);
      }
      filled += 1;
    }

    const allInputs = [...groupRoot.querySelectorAll(SPEC_INPUT_SELECTOR)];
    for (let j = names.length; j < allInputs.length; j += 1) {
      await fillAndBlur(allInputs[j], '');
    }

    showToast(`已填充 ${filled} 项规格`);
    return { filled, remaining: 0 };
  }

  async function handlePaste(firstInput, text) {
    const names = parseSpecNames(text);
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

  document.addEventListener('beforeinput', (e) => {
    if (isFilling) return;
    if (e.inputType !== 'insertFromPaste') return;
    if (!isFirstSpecInput(e.target)) return;
    e.preventDefault();
  }, true);

  document.addEventListener('paste', (e) => {
    if (isFilling) return;
    const target = e.target;
    if (!isFirstSpecInput(target)) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text') || '';
    handlePaste(target, text);
  }, true);
})();
