## 1. 基础结构与工具函数

- [x] 1.1 在 `createImageCard` 渲染时为 `.pie-item` 添加 `data-pie-url` 属性
- [x] 1.2 抽取 `findItemByUrl(url)` 与 `syncCardSelectionState(card, item, orderMap)` 轻量同步函数（checkbox、`.selected` class）
- [x] 1.3 抽取 `updateSelectionBadges(container)`：基于 `getSelectionOrderMap()` 为所有选中卡片增删/更新 `.pie-order-badge`

## 2. 鼠标划选核心逻辑

- [x] 2.1 实现 `makePaintSelection(grid, images)`：mousedown 于 `.pie-item` 记录起点，document 级 mousemove/mouseup
- [x] 2.2 移动 ≥ 4px 进入划选模式；`elementFromPoint` + `.closest('.pie-item')` 命中卡片
- [x] 2.3 维护 `visitedUrls` Set，每张卡片同手势内 toggle 一次 `item.selected`
- [x] 2.4 划选中调用轻量同步与 `updateSelectionBadges`，禁止调用 `renderGrid()`
- [x] 2.5 mouseup 结束划选；移动 < 4px 时保留现有单击 toggle，不进入划选
- [x] 2.6 划选期间忽略 checkbox/button 上的 mousedown；划选时加 `user-select: none` 并抑制卡片 click 误触

## 3. 集成与样式

- [x] 3.1 在 `openPanel()` 创建 `.pie-grid` 后调用 `makePaintSelection(grid, images)`
- [x] 3.2 调整 `createImageCard` 单击 handler：与划选手势共存（短点击 toggle，划选后不重复 toggle）
- [x] 3.3 必要时补充划选相关 CSS（如 `.pie-grid.painting { user-select: none; }`）
- [x] 3.4 升级脚本 `@version`（如 1.2.0）

## 4. 文档与验证

- [x] 4.1 更新 `README.md`：补充鼠标划选用法、与单击/checkbox 的关系、FAQ
- [x] 4.2 手动验证：划选未选中→选中、划选已选中→取消、同手势不重复切换、短点击 toggle、跨模块划选、序号 badge 实时更新
