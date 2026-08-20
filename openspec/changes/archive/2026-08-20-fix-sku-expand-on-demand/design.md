## Context

见 `proposal.md` - Why。当前三脚本对 SKU 虚拟表的处理不一致：

- `price_calculator`：`initSkuTableExpandOnLoad` 在 `document.body` 上挂 `MutationObserver`，任意 `childList` 变动都 `scheduleSkuTableExpand`；展开实现会先把内层 viewport 压到 `820px` 再撑到 `N×70+40`，并滚动唤醒虚拟列表。平台重渲后 `mounted >= countHint` 等退出条件易失败，形成 820 ↔ 超高 的反馈环。
- `image_exporter`：仅在导出路径调用 `expandPddSkuTable`，无常驻 body 监听（需核对保持）。
- `pdd_product_importer`：流水线内 `ensureSkuTableHeight`，无常驻展开监听（需核对保持）。

约束：不合并脚本文件；不改定价/分桶/导入业务语义；Python 命令仍用 `python3-dev`（本变更不涉及）。

## Goals / Non-Goals

**Goals:**

- 切断价格计算器的常驻监听展开环，空闲编辑页不再闪烁。
- 三个脚本统一约定：**只在各自用户动作入口按需展开/校正一次**。
- 打开价格计算（及刷新）、导出预览图、导入依赖 SKU 的步骤时，仍能展开虚拟表以便扫描/采集/上传。

**Non-Goals:**

- 不重构三脚本共用展开工具库（可后续再抽；本次各自改入口即可）。
- 不解决平台虚拟列表「撑高后仍不全量挂载」的根因（按需一轮后以当时 DOM 为准扫描）。
- 不改 FAB、公式、manifest、导入步骤顺序。

## Decisions

1. **触发模型：动作驱动，而非 DOM 驱动**  
   - 价格计算：在打开弹窗（`openPanel` / 等价入口）与「刷新」扫描前 `await loadAllVirtualSkuRows()`（或改名后的按需 API）一轮；删除 `initSkuTableExpandOnLoad` 中的 `MutationObserver`、`[1000,2500,5000,10000]` 定时 `run`，以及页面 `load` 空闲触发。  
   - 图片导出：保持「采集预览图前 expand」；确认无新增常驻 observer。  
   - 商品导入：保持流水线内 `ensureSkuTableHeight`；确认空闲无自动展开。  
   - 备选（否决）：仅去掉 observer、保留定时多次展开 —— 仍会在空闲改高度，不符合「不闪」。  
   - 备选（否决）：完全取消展开 —— 扫描/预览会丢行，与用户「仍使用自动展开」冲突。

2. **单次动作防重入，但不靠 MutationObserver 续跑**  
   - 保留进程内 `skuExpandRunning`（或等价锁），避免同一次打开弹窗并发两轮。  
   - **不再**因 `mounted < countHint` 在 observer 回调里自动重试整轮「压 820」。若一轮后行仍不全，以当前 DOM 扫描并在 UI 上沿用既有「刷新」让用户再触发。  
   - `dataset.pcSkuExpanded` 可作为同页短期跳过优化，但不得依赖它配合 body observer 形成闭环。

3. **展开算法可保留「先 820 再撑高」**  
   - 理由：历史证明对唤醒虚拟列表有效；问题在循环触发，不在单次算法。  
   - 单次动作内允许一次可见高度变化；禁止动作结束后继续跳。

4. **文档同步**  
   - 三个 README 写明：展开时机为打开价格计算/刷新、导出预览图、导入相关步骤；空闲不监听展开。

## Risks / Trade-offs

- [Risk] 打开弹窗前 SKU 区尚未渲染 → 展开找不到 viewport  
  → Mitigation：打开时若无 viewport，短等待/有限次重试（动作内），仍不挂 body observer；失败则空状态提示用户稍后刷新。
- [Risk] 一轮展开后 DOM 行仍少于 tableList → 扫描不全  
  → Mitigation：依赖用户点「刷新」再展一轮；不恢复常驻监听。
- [Risk] 误删导出/导入路径上的展开导致回归  
  → Mitigation：tasks 中明确核对两条路径仍调用 expand/ensure。

## Migration Plan

- 用户更新三个油猴脚本版本即可；无数据迁移。
- 回滚：恢复价格计算器 `initSkuTableExpandOnLoad` 的 observer 行为（不推荐，会恢复闪烁）。

## Open Questions

（无 — 触发时机已由用户确认：导出图片、价格计算、导入时各触发，而非监听循环。）
