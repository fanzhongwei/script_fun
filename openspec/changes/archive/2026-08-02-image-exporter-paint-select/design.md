## Context

`tampermonkey/image_exporter/image_exporter.user.js` 已实现图片发现、模块分组网格、单击/checkbox 切换选中、全选/取消全选，以及选中项按顺序编号下载。FAB 拖动已使用 4px 移动阈值区分点击与拖动。本次在导出面板 `.pie-grid` 内增加相册式鼠标划选，并在划选过程中轻量更新 DOM 以实时展示序号 badge。动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 在缩略图卡片上实现 paint selection：经过的卡片 toggle 选中态，同手势内每张仅处理一次
- 4px 阈值区分单击 toggle 与划选，互不干扰
- 划选过程中实时更新卡片选中样式、checkbox 状态与序号 badge，避免整页 `renderGrid()` 导致卡顿与手势中断
- 更新 README 说明划选用法

**Non-Goals:**

- Touch / 平板划选
- 矩形框选（marquee）
- 页面上直接圈选区域（方案 B）
- 划选时面板边缘自动滚动
- 修改图片发现、下载、模块分组逻辑

## Decisions

### 1. 划选状态机与阈值

**决策**：在 `.pie-item` 上 `mousedown` 记录起点；`document` 级 `mousemove`/`mouseup` 跟踪；移动 ≥ 4px 进入 `PAINT_SELECTING`，否则 `mouseup` 时走现有单击 toggle。

**理由**：与 `makeFabDraggable` 阈值一致，用户心智统一；document 级监听保证光标移出卡片/面板时仍能继续划选。

**备选**：在 `.pie-grid` 上启动划选——无法明确起始卡片，放弃。

### 2. 命中检测：elementFromPoint

**决策**：`mousemove` 时用 `document.elementFromPoint(clientX, clientY)` 取元素，`.closest('.pie-item')` 得到卡片。

**理由**：实现简单，天然支持跨 section；无需维护卡片坐标缓存。

**备选**：矩形相交或手动坐标表——适合框选，不适合路径划选。

### 3. 卡片与数据绑定

**决策**：渲染时为每个 `.pie-item` 设置 `data-pie-url`（图片绝对 URL），划选时通过 URL 在 `images` 数组中定位 item。

**理由**：不依赖 DOM 引用在 `renderGrid` 后仍有效；与现有 `item.url` 唯一键一致。

**备选**：`WeakMap(card, item)`——重绘后需重新绑定，划选中若 refresh 会失效。

### 4. 同手势去重：visited Set

**决策**：每次划选手势维护 `visitedUrls: Set<string>`，某 URL 已访问则跳过。

**理由**：满足「同一次划选不重复切换」；跨手势重新划选可再次 toggle，满足「再次划选取反」。

### 5. 划选中 DOM 更新策略

**决策**：划选过程中**不调用** `renderGrid()`；改为：

- 更新 `item.selected`
- 同步 checkbox.checked、`.selected` class
- 调用 `updateSelectionBadges(container)` 重算全部选中项序号并增删 badge

**理由**：现有 `renderGrid()` 会销毁节点并移除 document 级监听器，导致划选中断；全量重绘在 mousemove 高频下性能差。

**mouseup** 后可选调用一次 `renderGrid()` 做最终一致性同步，或仅依赖轻量更新（若 badge/checkbox 已同步则省略）。

### 6. 序号 badge 实时更新

**决策**：抽取 `getSelectionOrderMap()` 已有逻辑；每次 toggle 后遍历当前 `.pie-item`，按 order map 创建/更新/移除 `.pie-order-badge`。

**理由**：与下载顺序一致；用户明确要求划选时可见序号。

### 7. 事件冲突处理

**决策**：

- `mousedown` 目标为 `input`、`button` 时不启动划选
- 划选期间在 `.pie-grid` 或 `document.body` 加 `user-select: none` 防止误选文字
- 划选期间阻止卡片原有点击 handler 误触：手势内标记 `paintGestureActive`，卡片 click 忽略

## Risks / Trade-offs

- **[Risk] 快速划过导致跳过中间卡片** → mousemove 频率有限时可能漏选；可接受，与手机相册类似；二期可在相邻点间插值 hit test
- **[Risk] 轻量更新与 renderGrid 逻辑分叉** → 抽取共用的 badge/checkbox 同步函数，mouseup 后可选 full refresh 兜底
- **[Risk] 与全选/模块全选交互** → 全选仍走 renderGrid，划选未进行时无影响；划选中禁用 header 按钮为可选优化，一期不强制
- **[Trade-off] 无边缘自动滚动** → 长列表需手动滚动后再划，实现更简单

## Migration Plan

- 单文件脚本升级，Bump `@version`（如 1.1.1 → 1.2.0）
- 用户更新 Tampermonkey 脚本即可，无配置迁移
- 回滚：恢复上一版 user.js

## Open Questions

- （无）
