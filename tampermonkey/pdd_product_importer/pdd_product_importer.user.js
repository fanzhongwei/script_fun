// ==UserScript==
// @name         拼多多商品包导入器
// @namespace    https://github.com/fanzhongwei/script_fun
// @version      1.0.0
// @description  从 image_exporter 导出的商品包文件夹一键导入：轮播/详情/规格/Excel/预览图
// @author       script_fun
// @match        *://mms.pinduoduo.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROOT_ID = 'ppi-root';
  const FAB_POS_KEY = 'ppi_fab_pos';
  const MANIFEST_VERSION = '1';
  const CHUNK_SIZE = 12;
  const SKU_ROW_HEIGHT_PX = 70;
  const FILL_STEP_DELAY_MS = 100;
  const WAIT_TIMEOUT_MS = 5000;
  const PDD_SKU_ROW_IN_TABLE = 'tbody tr[class*="TB_tr"], tbody [data-testid="beast-core-table-body-tr"]';

  /** @type {boolean} */
  let pipelineRunning = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function pieNormText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    return root;
  }

  function showToast(message, ms = 2800) {
    let toast = document.getElementById(`${ROOT_ID}-toast`);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = `${ROOT_ID}-toast`;
      toast.style.cssText = [
        'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
        'z-index:2147483646', 'max-width:420px', 'padding:12px 18px',
        'background:#1f2937', 'color:#f9fafb', 'font-size:14px', 'line-height:1.5',
        'text-align:center', 'border-radius:8px', 'box-shadow:0 4px 16px rgba(0,0,0,.2)',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { toast.style.opacity = '0'; }, ms);
  }

  function findReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
    );
    return key ? el[key] : null;
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

  function triggerClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    } catch {
      /* ignore */
    }
    if (tryInvokeReactOnClick(el)) return true;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (typeof el.click === 'function') el.click();
    return true;
  }

  function assignFilesToInput(input, files) {
    if (!input || !files.length) return false;
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findFileInputNear(el) {
    if (!el) return null;
    const inEl = el.querySelector?.('input[type=file]') || (el.matches?.('input[type=file]') ? el : null);
    if (inEl) return inEl;
    const root = el.closest('div, section, form') || el.parentElement;
    if (!root) return null;
    return root.querySelector('input[type=file]');
  }

  async function waitFor(fn, timeoutMs = WAIT_TIMEOUT_MS, intervalMs = 120) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = fn();
      if (result) return result;
      await sleep(intervalMs);
    }
    return null;
  }

  function canUseFileSystemAccess() {
    return typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  }

  async function resolveDirHandle(rootHandle, dirParts) {
    let dir = rootHandle;
    for (const part of dirParts) {
      if (!part) continue;
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    return dir;
  }

  async function readFileFromPackage(rootHandle, relativePath) {
    const parts = String(relativePath || '').split('/').filter(Boolean);
    if (!parts.length) throw new Error('empty path');
    const fileName = parts.pop();
    const dir = parts.length ? await resolveDirHandle(rootHandle, parts) : rootHandle;
    const fileHandle = await dir.getFileHandle(fileName, { create: false });
    return fileHandle.getFile();
  }

  async function readManifestFromHandle(packageRoot) {
    const fileHandle = await packageRoot.getFileHandle('manifest.json', { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  }

  async function resolvePackageRoot(rootHandle) {
    try {
      const manifest = await readManifestFromHandle(rootHandle);
      return { packageRoot: rootHandle, manifest };
    } catch {
      /* 可能在子目录 {标题-ID}/ 下 */
    }
    for await (const entry of rootHandle.values()) {
      if (entry.kind !== 'directory') continue;
      try {
        const manifest = await readManifestFromHandle(entry);
        return { packageRoot: entry, manifest };
      } catch {
        /* try next */
      }
    }
    throw new Error('未找到 manifest.json');
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') return 'manifest 不是有效 JSON 对象';
    if (String(manifest.version) !== MANIFEST_VERSION) {
      return `不支持的 manifest 版本：${manifest.version}`;
    }
    if (!manifest.images || !Array.isArray(manifest.images.carousel)) {
      return 'manifest 缺少 images.carousel';
    }
    if (!Array.isArray(manifest.images.detail)) manifest.images.detail = [];
    if (!Array.isArray(manifest.images.preview)) manifest.images.preview = [];
    if (!Array.isArray(manifest.specDimensions)) return 'manifest 缺少 specDimensions';
    return null;
  }

  function createStepResult(id, label) {
    return {
      id,
      label,
      status: 'pending',
      total: 0,
      ok: 0,
      fail: 0,
      detail: '',
      items: [],
    };
  }

  function finalizeStep(step, status, detail) {
    step.status = status;
    if (detail != null) step.detail = detail;
    if (status === 'success' && step.fail > 0) step.status = 'partial';
    if (status === 'success' && step.ok === 0 && step.total > 0) step.status = 'failed';
    return step;
  }

  function skippedStep(id, label, reason) {
    const step = createStepResult(id, label);
    step.status = 'skipped';
    step.detail = reason || '已跳过';
    return step;
  }

  function findDeleteButton(container) {
    if (!container) return null;
    const nodes = container.querySelectorAll('a, button, span, [role="button"], i, svg');
    for (const node of nodes) {
      const text = (node.textContent || '').replace(/\s+/g, '');
      const aria = node.getAttribute('aria-label') || '';
      if (/删除|关闭|remove|close/i.test(`${text}${aria}`)) {
        return node.closest('a, button, [role="button"]') || node;
      }
    }
    return container.querySelector(
      '[class*="close"], [class*="Close"], [class*="delete"], [class*="Delete"], [aria-label="关闭"]',
    );
  }

  function findCarouselRoot() {
    const inGallery = document.querySelector(
      '#basic\\.carousel_gallery [class*="MaterialModalButton_v2_materialContainer"], ' +
      '#picture [class*="MaterialModalButton_v2_materialContainer"]',
    );
    if (inGallery && !inGallery.closest(`#${ROOT_ID}`)) return inGallery;
    return document.querySelector('#picture') || null;
  }

  function getCarouselImageBoxes() {
    const root = findCarouselRoot();
    if (!root) return [];
    return [...root.querySelectorAll('[class*="MaterialModalButton_v2_imageBox"]')];
  }

  async function deleteImagesExceptFirst(boxes) {
    for (let i = boxes.length - 1; i >= 1; i -= 1) {
      const del = findDeleteButton(boxes[i]);
      if (del) {
        triggerClick(del);
        await sleep(350);
      }
    }
  }

  function findCarouselUploadInput() {
    const upload = document.querySelector(
      '[data-tracking-click-viewid="carousel_img_localfile_upload"]',
    );
    return findFileInputNear(upload || findCarouselRoot());
  }

  function getDetailImageItems() {
    const root = document.querySelector('#detail_pic');
    if (!root) return [];
    return [...root.querySelectorAll('img[data-tracking-click-viewid="el_preview_business_details"]')]
      .map((img) => img.closest('[class*="item"], [class*="cell"], figure, div') || img.parentElement)
      .filter(Boolean);
  }

  function findDetailUploadInput() {
    const root = document.querySelector('#detail_pic');
    if (!root) return null;
    const upload = root.querySelector('[data-tracking-click-viewid*="upload"], [class*="upload"]');
    return findFileInputNear(upload || root);
  }

  async function loadFilesFromManifest(rootHandle, paths) {
    const files = [];
    for (const rel of paths) {
      try {
        files.push(await readFileFromPackage(rootHandle, rel));
      } catch {
        /* skip missing */
      }
    }
    return files;
  }

  async function stepCarousel(manifest, rootHandle, onProgress) {
    const step = createStepResult('carousel', '轮播图');
    step.total = manifest.images.carousel.length;
    onProgress('轮播图：删除旧图…');
    await deleteImagesExceptFirst(getCarouselImageBoxes());
    onProgress(`轮播图：上传 0/${step.total}…`);
    const files = await loadFilesFromManifest(rootHandle, manifest.images.carousel);
    if (!files.length) {
      return finalizeStep(step, step.total ? 'failed' : 'skipped', '未读取到轮播图文件');
    }
    const input = await waitFor(() => findCarouselUploadInput(), 8000);
    if (!input) {
      return finalizeStep(step, 'failed', '未找到轮播图上传入口');
    }
    const ok = assignFilesToInput(input, files);
    if (ok) {
      step.ok = files.length;
      await sleep(1500);
      return finalizeStep(step, 'success', `上传 ${files.length}/${step.total} 张`);
    }
    step.fail = files.length;
    return finalizeStep(step, 'failed', '轮播图上传失败');
  }

  async function stepDetail(manifest, rootHandle, onProgress) {
    const step = createStepResult('detail', '详情图');
    step.total = manifest.images.detail.length;
    onProgress('详情图：删除旧图…');
    await deleteImagesExceptFirst(getDetailImageItems());
    onProgress(`详情图：上传 0/${step.total}…`);
    const files = await loadFilesFromManifest(rootHandle, manifest.images.detail);
    if (!files.length) {
      return finalizeStep(step, step.total ? 'failed' : 'skipped', '未读取到详情图文件');
    }
    const input = await waitFor(() => findDetailUploadInput(), 8000);
    if (!input) {
      return finalizeStep(step, 'failed', '未找到详情图上传入口');
    }
    const ok = assignFilesToInput(input, files);
    if (ok) {
      step.ok = files.length;
      await sleep(1500);
      return finalizeStep(step, 'success', `上传 ${files.length}/${step.total} 张`);
    }
    step.fail = files.length;
    return finalizeStep(step, 'failed', '详情图上传失败');
  }

  function isSpecInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.closest('table[class*="TB_tableWrapper"], [class*="TB_body"]')) return false;
    const ph = input.placeholder || '';
    if (ph === '请输入规格名称' || /^自定义/.test(ph)) return true;
    if (/规格名称|请输入规格|规格值/.test(ph)) return true;
    if (/库存|价格|编码|拼单价|单买价|全部颜色|全部尺寸|搜索/.test(ph)) return false;
    return !!input.closest('.custom-input-container, .package-item-container, .package-container, .property-values-container, #newSpec, #stand_spec');
  }

  function querySpecInputs(root) {
    if (!root) return [];
    return [...root.querySelectorAll('input')].filter(isSpecInput);
  }

  function findSpecGroupRoot(firstInput) {
    const scope = firstInput.closest('#goods-spec-sku, #sku, #newSpec, .goods-sku-box') || document.body;
    let el = firstInput;
    while (el && el !== scope) {
      const hasDelete = [...el.querySelectorAll('a, button, span')].some(
        (node) => /删除规格类型|删除/.test((node.textContent || '').replace(/\s+/g, '')),
      );
      if (hasDelete && querySpecInputs(el).length > 0) return el;
      el = el.parentElement;
    }
    return firstInput.closest('.package-container, .property-values-container') || firstInput.parentElement;
  }

  function getAllSpecGroupRoots() {
    const roots = [];
    const seen = new Set();
    const scopes = document.querySelectorAll('#goods-spec-sku, #sku, #newSpec, .goods-sku-box');
    const inputs = [];
    scopes.forEach((scope) => querySpecInputs(scope).forEach((input) => {
      if (!inputs.includes(input)) inputs.push(input);
    }));
    inputs.forEach((input) => {
      const group = querySpecInputs(findSpecGroupRoot(input));
      if (!group.length || group[0] !== input) return;
      const root = findSpecGroupRoot(input);
      if (seen.has(root)) return;
      seen.add(root);
      roots.push(root);
    });
    return roots;
  }

  function findDeleteSpecTypeButton(groupRoot) {
    const nodes = groupRoot.querySelectorAll('a, button, span, [role="button"]');
    for (const node of nodes) {
      const text = (node.textContent || '').replace(/\s+/g, '');
      if (/删除规格类型/.test(text)) {
        return node.closest('a, button, [role="button"]') || node;
      }
    }
    return null;
  }

  async function confirmDialogIfAny() {
    await sleep(200);
    const scopes = document.querySelectorAll('[class*="Modal"], [role="dialog"], [class*="modal"]');
    for (const scope of scopes) {
      if (scope.closest(`#${ROOT_ID}`)) continue;
      const btn = [...scope.querySelectorAll('button')].find((b) => /确定|确认|是/.test(b.textContent || ''));
      if (btn) {
        triggerClick(btn);
        await sleep(300);
        return;
      }
    }
  }

  async function deleteAllSpecTypes() {
    for (let guard = 0; guard < 20; guard += 1) {
      const roots = getAllSpecGroupRoots();
      if (!roots.length) return;
      const root = roots[roots.length - 1];
      const del = findDeleteSpecTypeButton(root);
      if (!del) return;
      triggerClick(del);
      await confirmDialogIfAny();
      await sleep(450);
    }
  }

  function findAddSpecTypeButton() {
    const scopes = document.querySelectorAll('#goods-spec-sku, #sku, #newSpec, .goods-sku-box');
    for (const scope of scopes) {
      const nodes = scope.querySelectorAll('a, button, span, [role="button"]');
      for (const node of nodes) {
        const text = (node.textContent || '').replace(/\s+/g, '');
        if (/添加规格类型|添加规格/.test(text)) {
          return node.closest('a, button, [role="button"]') || node;
        }
      }
    }
    return null;
  }

  function findSpecTypeOption(typeLabel) {
    const target = pieNormText(typeLabel);
    const scopes = document.querySelectorAll(
      '[class*="Modal"], [role="dialog"], [class*="modal"], [class*="Drawer"], [role="listbox"], [class*="popover"], [class*="Popover"]',
    );
    const searchNodes = (root) => {
      const nodes = root.querySelectorAll('li, div, span, a, button, [role="option"], [role="menuitem"]');
      for (const node of nodes) {
        const text = pieNormText(node.textContent);
        if (text === target) return node.closest('li, a, button, [role="option"]') || node;
      }
      return null;
    };
    for (const scope of scopes) {
      if (scope.closest(`#${ROOT_ID}`)) continue;
      const hit = searchNodes(scope);
      if (hit) return hit;
    }
    return searchNodes(document.body);
  }

  async function selectSpecType(typeLabel) {
    const addBtn = findAddSpecTypeButton();
    if (!addBtn) return false;
    triggerClick(addBtn);
    await sleep(400);
    const option = await waitFor(() => findSpecTypeOption(typeLabel), 5000);
    if (!option) return false;
    triggerClick(option);
    await sleep(500);
    return true;
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function commitSpecInput(input, value) {
    input.focus();
    setInputValue(input, value);
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
    input.blur();
    await sleep(FILL_STEP_DELAY_MS);
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
      observer = new MutationObserver(() => { check(); });
      observer.observe(groupRoot, { childList: true, subtree: true });
      pollTimer = setInterval(check, 50);
    });
  }

  async function clearSpecInput(input) {
    if (input.value === '') return;
    await commitSpecInput(input, '');
  }

  async function clearSpecInputsFromIndex(groupRoot, fromIndex) {
    const inputs = querySpecInputs(groupRoot);
    for (let j = inputs.length - 1; j >= fromIndex; j -= 1) {
      await clearSpecInput(inputs[j]);
    }
  }

  async function fillSpecGroup(firstInput, names) {
    const groupRoot = findSpecGroupRoot(firstInput);
    let filled = 0;
    await clearSpecInputsFromIndex(groupRoot, 1);
    for (let i = 0; i < names.length; i += 1) {
      let input;
      if (i === 0) {
        input = firstInput;
      } else {
        input = await waitForSpecInput(groupRoot, i, i + 1);
        if (!input) break;
      }
      await commitSpecInput(input, names[i]);
      filled += 1;
    }
    await clearSpecInputsFromIndex(groupRoot, names.length);
    return filled;
  }

  function getLatestSpecGroupFirstInput() {
    const roots = getAllSpecGroupRoots();
    if (!roots.length) return null;
    const inputs = querySpecInputs(roots[roots.length - 1]);
    return inputs[0] || null;
  }

  async function stepSpecs(manifest, onProgress) {
    const steps = [];
    onProgress('规格：删除已有规格类型…');
    await deleteAllSpecTypes();
    await sleep(500);

    for (let i = 0; i < manifest.specDimensions.length; i += 1) {
      const dim = manifest.specDimensions[i];
      const step = createStepResult(`spec:${i}`, `规格-${dim.typeLabel || i + 1}`);
      step.total = (dim.values || []).length;
      onProgress(`规格：添加类型「${dim.typeLabel}」…`);

      const matched = await selectSpecType(dim.typeLabel);
      if (!matched) {
        finalizeStep(step, 'aborted', `未找到规格类型「${dim.typeLabel}」`);
        steps.push(step);
        return { steps, aborted: true, reason: step.detail };
      }

      const firstInput = await waitFor(() => getLatestSpecGroupFirstInput(), 5000);
      if (!firstInput) {
        finalizeStep(step, 'failed', '未找到规格输入框');
        steps.push(step);
        continue;
      }

      const filled = await fillSpecGroup(firstInput, dim.values || []);
      step.ok = filled;
      step.fail = Math.max(0, step.total - filled);
      finalizeStep(step, filled >= step.total ? 'success' : 'partial', `填充 ${filled}/${step.total} 项`);
      steps.push(step);
      await sleep(400);
    }

    return { steps, aborted: false };
  }

  function findSkuExcelEntry() {
    const links = document.querySelectorAll(
      '#sku a[class*="BTN_outerWrapperLink"], #goods-spec-sku a[class*="BTN_outerWrapperLink"], #sku a, #goods-spec-sku a',
    );
    for (const a of links) {
      if (a.closest(`#${ROOT_ID}`)) continue;
      const text = (a.textContent || '').replace(/\s+/g, '');
      if (/Excel批量编辑规格|Excel批量编辑|批量编辑规格/.test(text)) return a;
    }
    const scopes = [document.querySelector('#sku'), document.querySelector('#goods-spec-sku')].filter(Boolean);
    for (const scope of scopes) {
      const nodes = scope.querySelectorAll('a, button, span, [role="button"]');
      for (const node of nodes) {
        const text = (node.textContent || '').replace(/\s+/g, '');
        if (/Excel批量编辑规格|Excel批量编辑|批量编辑规格/.test(text)) {
          return node.closest('a, button, [role="button"]') || node;
        }
      }
    }
    return null;
  }

  function findExcelImportInput() {
    const scopes = document.querySelectorAll(
      '[class*="Modal"], [role="dialog"], [class*="modal"], [class*="Drawer"]',
    );
    for (const scope of scopes) {
      const scopeText = (scope.textContent || '').replace(/\s+/g, '');
      if (!/Excel批量编辑规格/.test(scopeText)) continue;
      const input = scope.querySelector('input[type=file]');
      if (input) return input;
      const importBtn = [...scope.querySelectorAll('a, button, span, [role="button"]')].find(
        (node) => /导入|上传Excel|选择文件/.test((node.textContent || '').replace(/\s+/g, '')),
      );
      if (importBtn) {
        triggerClick(importBtn.closest('a, button, [role="button"]') || importBtn);
      }
    }
    return document.querySelector('[class*="Modal"] input[type=file], [role="dialog"] input[type=file]');
  }

  async function stepExcel(manifest, rootHandle, onProgress) {
    const step = createStepResult('excel', 'Excel导入');
    const excelPath = manifest.excel || '成本表.xlsx';
    onProgress('Excel：打开批量编辑…');
    const entry = findSkuExcelEntry();
    if (!entry) {
      return finalizeStep(step, 'failed', '未找到 Excel 批量编辑规格入口');
    }
    triggerClick(entry);
    await sleep(600);

    let file;
    try {
      file = await readFileFromPackage(rootHandle, excelPath);
    } catch {
      return finalizeStep(step, 'failed', `未找到 ${excelPath}`);
    }

    onProgress('Excel：导入文件…');
    const input = await waitFor(() => findExcelImportInput(), 10000);
    if (!input) {
      return finalizeStep(step, 'failed', '未找到 Excel 导入上传入口');
    }
    if (!assignFilesToInput(input, [file])) {
      return finalizeStep(step, 'failed', 'Excel 文件注入失败');
    }

    await sleep(2000);
    const modalGone = await waitFor(() => {
      const scopes = document.querySelectorAll('[class*="Modal"], [role="dialog"]');
      for (const scope of scopes) {
        if (/Excel批量编辑规格/.test((scope.textContent || '').replace(/\s+/g, ''))) return null;
      }
      return true;
    }, 30000, 300);

    step.ok = 1;
    step.total = 1;
    if (modalGone) {
      return finalizeStep(step, 'success', '导入完成（未点击保存草稿）');
    }
    return finalizeStep(step, 'partial', '已上传，等待平台更新超时');
  }

  function getSkuScrollViewport() {
    const skuRoot = document.querySelector('#sku, #goods-spec-sku');
    if (!skuRoot || skuRoot.closest(`#${ROOT_ID}`)) return null;
    const body = skuRoot.querySelector(
      '[data-testid="beast-core-table-middle-body"], [class*="TB_body"]',
    );
    if (!body) return null;
    for (const child of Array.from(body.children)) {
      if (!child.querySelector('table[class*="TB_tableWrapper"]')) continue;
      const style = child.getAttribute('style') || '';
      const cs = getComputedStyle(child);
      const looksLikeScroll = /max-height|overflow-y|height\s*:/i.test(style)
        || cs.overflowY === 'scroll' || cs.overflowY === 'auto';
      if (looksLikeScroll) return child;
    }
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

  function findSkuBatchInstance() {
    const wrap = document.querySelector('#sku .batch-wrap, .batch-wrap');
    if (!wrap) return null;
    const btn = [...wrap.querySelectorAll('button')].find((el) => /批量设置/.test(el.textContent || ''));
    let fiber = findReactFiber(btn) || findReactFiber(wrap);
    for (let i = 0; i < 40 && fiber; i += 1, fiber = fiber.return) {
      const node = fiber.stateNode;
      if (node?.props?.sku?.tableList?.length) return node;
    }
    return null;
  }

  function getSkuCountHint() {
    try {
      const inst = findSkuBatchInstance();
      if (inst?.props?.sku?.tableList?.length) return inst.props.sku.tableList.length;
    } catch {
      /* ignore */
    }
    const viewport = getSkuScrollViewport();
    if (!viewport) return 0;
    return viewport.querySelectorAll(PDD_SKU_ROW_IN_TABLE).length;
  }

  function isSkuTableHeightCorrect(viewport, count) {
    if (!viewport || count < 1) return false;
    const expected = count * SKU_ROW_HEIGHT_PX;
    const mounted = viewport.querySelectorAll(PDD_SKU_ROW_IN_TABLE).length;
    const h = parseFloat(viewport.style.height) || parseFloat(viewport.style.maxHeight) || 0;
    const spacer = getSkuSpacer(viewport);
    const pt = spacer ? parseFloat(spacer.style.paddingTop) || 0 : 0;
    const pb = spacer ? parseFloat(spacer.style.paddingBottom) || 0 : 0;
    return mounted >= count && h >= expected - 4 && pt === 0 && pb === 0;
  }

  function ensureSkuTableHeight() {
    const viewport = getSkuScrollViewport();
    if (!viewport) return false;
    const count = getSkuCountHint() || (document.querySelectorAll('#sku .sku-preview-cell, #goods-spec-sku .sku-preview-cell').length);
    if (count < 1) return false;
    if (isSkuTableHeightCorrect(viewport, count)) return true;
    const finalH = Math.ceil(Math.max(count * SKU_ROW_HEIGHT_PX, 820) + 40);
    viewport.style.maxHeight = `${finalH}px`;
    viewport.style.height = `${finalH}px`;
    viewport.style.overflowY = 'scroll';
    const spacer = getSkuSpacer(viewport);
    if (spacer) {
      spacer.style.paddingTop = '0px';
      spacer.style.paddingBottom = '0px';
    }
    return true;
  }

  function getPreviewCells() {
    return [...document.querySelectorAll('#goods-spec-sku .sku-preview-cell, #sku .sku-preview-cell')]
      .filter((cell) => !cell.closest(`#${ROOT_ID}`));
  }

  function previewCellHasImage(cell) {
    const preview = cell.querySelector(
      '[data-tracking-click-viewid="el_specification_batch_modification_preview_picture"]',
    );
    const target = preview || cell;
    const bg = target.style?.backgroundImage || getComputedStyle(target).backgroundImage;
    if (bg && bg !== 'none' && !/none/i.test(bg)) {
      const inline = (target.textContent || '').replace(/\s+/g, '');
      if (!/暂无预览|无预览|文本暂无预览/.test(inline)) return true;
    }
    const img = cell.querySelector('img');
    if (img?.src && !/placeholder|empty/i.test(img.src)) return true;
    return false;
  }

  function findPreviewDeleteButton(cell) {
    const preview = cell.querySelector(
      '[data-tracking-click-viewid="el_specification_batch_modification_preview_picture"]',
    ) || cell;
    return findDeleteButton(preview) || findDeleteButton(cell);
  }

  function findPreviewUploadTarget(cell) {
    const preview = cell.querySelector(
      '[data-tracking-click-viewid="el_specification_batch_modification_preview_picture"]',
    );
    if (preview) return preview;
    return cell.querySelector('[data-tracking-click-viewid*="preview"], [class*="upload"]') || cell;
  }

  async function deletePreviewInCells(cells) {
    for (const cell of cells) {
      if (!previewCellHasImage(cell)) continue;
      const del = findPreviewDeleteButton(cell);
      if (del) {
        triggerClick(del);
        await sleep(250);
        await confirmDialogIfAny();
      }
    }
  }

  function chunkPreviewEntries(previewList) {
    const sorted = [...previewList].sort((a, b) => a.index - b.index);
    const chunks = [];
    for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
      chunks.push(sorted.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
  }

  async function waitBatchPreviewUpdate(cells, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = cells.every((cell) => previewCellHasImage(cell));
      if (ready) return true;
      await sleep(300);
    }
    return cells.filter((cell) => previewCellHasImage(cell)).length;
  }

  async function stepPreview(manifest, rootHandle, onProgress) {
    const step = createStepResult('preview', '预览图');
    const entries = manifest.images.preview || [];
    step.total = entries.length;
    if (!entries.length) {
      return finalizeStep(step, 'skipped', 'manifest 无预览图');
    }

    ensureSkuTableHeight();
    await sleep(400);

    const chunks = chunkPreviewEntries(entries);
    let ok = 0;
    let fail = 0;

    for (let ci = 0; ci < chunks.length; ci += 1) {
      const chunk = chunks[ci];
      const startRow = ci * CHUNK_SIZE;
      onProgress(`预览图：第 ${ci + 1}/${chunks.length} 批…`);

      ensureSkuTableHeight();
      const allCells = getPreviewCells();
      const batchCells = allCells.slice(startRow, startRow + chunk.length);
      if (!batchCells.length) {
        fail += chunk.length;
        continue;
      }

      await deletePreviewInCells(batchCells);

      const files = [];
      for (const entry of chunk) {
        try {
          files.push(await readFileFromPackage(rootHandle, entry.file));
        } catch {
          fail += 1;
        }
      }
      if (!files.length) continue;

      const uploadTarget = findPreviewUploadTarget(batchCells[0]);
      triggerClick(uploadTarget);
      await sleep(300);
      let input = findFileInputNear(uploadTarget);
      if (!input) {
        input = await waitFor(() => findFileInputNear(batchCells[0]), 3000);
      }
      if (!input || !assignFilesToInput(input, files)) {
        fail += chunk.length;
        continue;
      }

      const updated = await waitBatchPreviewUpdate(batchCells.slice(0, files.length));
      if (updated === true) {
        ok += files.length;
      } else {
        ok += typeof updated === 'number' ? updated : 0;
        fail += chunk.length - (typeof updated === 'number' ? updated : 0);
      }
      await sleep(500);
    }

    step.ok = ok;
    step.fail = fail;
    return finalizeStep(
      step,
      ok >= step.total ? 'success' : ok > 0 ? 'partial' : 'failed',
      `上传 ${ok}/${step.total} 张`,
    );
  }

  function buildReport(steps, sourceTitle, elapsedMs, aborted) {
    const lines = [
      `商品包导入结果`,
      `来源：${sourceTitle || '未知'}`,
      `耗时：${Math.round(elapsedMs / 1000)}s`,
      aborted ? '状态：已中断' : '',
      '',
    ].filter(Boolean);
    steps.forEach((step) => {
      lines.push(`[${step.status}] ${step.label}：${step.detail || ''}`);
    });
    return lines.join('\n');
  }

  function statusLabel(status) {
    const map = {
      success: '✅',
      partial: '⚠️',
      failed: '❌',
      skipped: '⏭',
      aborted: '⛔',
    };
    return map[status] || status;
  }

  function renderSummaryModal(steps, sourceTitle, elapsedMs, aborted, onClose) {
    const root = ensureRoot();
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'ppi-overlay';

    const panel = document.createElement('div');
    panel.className = 'ppi-panel';

    const title = document.createElement('h2');
    title.textContent = '商品包导入结果';

    const meta = document.createElement('div');
    meta.className = 'ppi-meta';
    meta.textContent = `来源：${sourceTitle || '未知'} · 耗时 ${Math.round(elapsedMs / 1000)}s${aborted ? ' · 已中断' : ''}`;

    const table = document.createElement('table');
    table.className = 'ppi-table';
    table.innerHTML = '<thead><tr><th>步骤</th><th>状态</th><th>详情</th></tr></thead>';
    const tbody = document.createElement('tbody');
    steps.forEach((step) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${step.label}</td><td>${statusLabel(step.status)} ${step.status}</td><td>${step.detail || ''}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const actions = document.createElement('div');
    actions.className = 'ppi-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制报告';
    copyBtn.addEventListener('click', async () => {
      const text = buildReport(steps, sourceTitle, elapsedMs, aborted);
      try {
        await navigator.clipboard.writeText(text);
        showToast('报告已复制');
      } catch {
        showToast('复制失败');
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ppi-primary';
    closeBtn.textContent = '关闭';
    closeBtn.addEventListener('click', () => {
      root.innerHTML = '';
      createFab();
      if (onClose) onClose();
    });

    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);

    panel.appendChild(title);
    panel.appendChild(meta);
    panel.appendChild(table);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  function renderProgressModal(message) {
    const root = ensureRoot();
    let box = root.querySelector('.ppi-progress');
    if (!box) {
      root.innerHTML = '';
      const overlay = document.createElement('div');
      overlay.className = 'ppi-overlay';
      box = document.createElement('div');
      box.className = 'ppi-panel ppi-progress';
      overlay.appendChild(box);
      root.appendChild(overlay);
    }
    box.textContent = message;
  }

  async function runImportPipeline(manifest, rootHandle) {
    const start = Date.now();
    const steps = [];
    let aborted = false;
    const sourceTitle = manifest.source
      ? `${manifest.source.goodsTitle || ''}-${manifest.source.goodsId || ''}`
      : '';

    const onProgress = (msg) => renderProgressModal(msg);

    try {
      steps.push(await stepCarousel(manifest, rootHandle, onProgress));
      steps.push(await stepDetail(manifest, rootHandle, onProgress));

      const specResult = await stepSpecs(manifest, onProgress);
      steps.push(...specResult.steps);
      if (specResult.aborted) {
        aborted = true;
        steps.push(skippedStep('excel', 'Excel导入', specResult.reason || '规格类型匹配失败'));
        steps.push(skippedStep('preview', '预览图', '因规格步骤中断'));
        renderSummaryModal(steps, sourceTitle, Date.now() - start, aborted);
        return;
      }

      steps.push(await stepExcel(manifest, rootHandle, onProgress));
      steps.push(await stepPreview(manifest, rootHandle, onProgress));
    } catch (err) {
      steps.push(createStepResult('fatal', '致命错误'));
      const last = steps[steps.length - 1];
      last.status = 'failed';
      last.detail = String(err?.message || err);
    }

    renderSummaryModal(steps, sourceTitle, Date.now() - start, aborted);
  }

  async function startImport() {
    if (pipelineRunning) {
      showToast('导入进行中…');
      return;
    }
    if (!canUseFileSystemAccess()) {
      showToast('请使用 Chrome/Edge 并允许目录访问');
      return;
    }

    let rootHandle;
    try {
      rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      showToast('已取消选择文件夹');
      return;
    }

    pipelineRunning = true;
    try {
      let packageRoot;
      let manifest;
      try {
        ({ packageRoot, manifest } = await resolvePackageRoot(rootHandle));
      } catch (err) {
        showToast(String(err?.message || '无法读取 manifest.json'));
        return;
      }

      const err = validateManifest(manifest);
      if (err) {
        showToast(err);
        return;
      }

      await runImportPipeline(manifest, packageRoot);
    } finally {
      pipelineRunning = false;
    }
  }

  function injectStyles() {
    if (document.getElementById(`${ROOT_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
      #${ROOT_ID} .ppi-overlay {
        position: fixed; inset: 0; z-index: 2147483645;
        background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center;
      }
      #${ROOT_ID} .ppi-panel {
        width: min(640px, 92vw); max-height: 86vh; overflow: auto;
        background: #fff; border-radius: 12px; padding: 20px;
        box-shadow: 0 12px 40px rgba(0,0,0,.25);
      }
      #${ROOT_ID} .ppi-panel h2 { margin: 0 0 8px; font-size: 18px; }
      #${ROOT_ID} .ppi-meta { color: #6b7280; font-size: 13px; margin-bottom: 12px; }
      #${ROOT_ID} .ppi-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      #${ROOT_ID} .ppi-table th, #${ROOT_ID} .ppi-table td {
        border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top;
      }
      #${ROOT_ID} .ppi-table th { background: #f9fafb; }
      #${ROOT_ID} .ppi-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
      #${ROOT_ID} .ppi-actions button {
        padding: 8px 14px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer;
      }
      #${ROOT_ID} .ppi-actions .ppi-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
      #${ROOT_ID} .ppi-progress { font-size: 15px; line-height: 1.6; text-align: center; min-width: 280px; }
      #${ROOT_ID} .ppi-fab {
        position: fixed; right: 16px; bottom: 140px; z-index: 2147483640;
        padding: 10px 14px; border: none; border-radius: 999px;
        background: #059669; color: #fff; font-size: 14px; font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,.2); cursor: pointer; user-select: none;
      }
      #${ROOT_ID} .ppi-fab.dragging { opacity: .85; cursor: grabbing; }
    `;
    document.head.appendChild(style);
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
    GM_setValue(FAB_POS_KEY, { left: fab.offsetLeft, top: fab.offsetTop });
  }

  function makeFabDraggable(fab, onClick) {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragged = false;

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
      if (dragged) saveFabPosition(fab);
      else onClick();
    };

    fab.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
      originLeft = fab.offsetLeft;
      originTop = fab.offsetTop;
      fab.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
    });

    fab.addEventListener('touchstart', (e) => {
      dragged = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      originLeft = fab.offsetLeft;
      originTop = fab.offsetTop;
      fab.classList.add('dragging');
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    }, { passive: true });
  }

  function createFab() {
    const root = ensureRoot();
    if (root.querySelector('.ppi-fab')) return;

    injectStyles();
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'ppi-fab';
    fab.textContent = '导入商品包';
    applyFabPosition(fab);
    makeFabDraggable(fab, () => { void startImport(); });
    root.appendChild(fab);
  }

  createFab();
})();
