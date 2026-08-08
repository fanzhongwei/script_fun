## Why

当前价格计算器基于旧版 Excel 反推定价模型，缺少实际成本、实际利润、投产比等运营决策字段，活动配置过于复杂（5 个互斥券），且不支持数据导出/导入与多规格款式展示。商家在 SKU 定价与投放决策时需要更直观的正向加价模型、更完整的指标列，以及可持久化的 Markdown 数据交换能力。

## What Changes

- **BREAKING**：定价公式由反推模型改为正向加价模型（实际拼单价 = 实际成本 × (1 + 目标利润率)）
- **BREAKING**：移除五种互斥优惠券，合并为单一「立减优惠券」+「限时限量购」
- 新增计算列：实际成本、实际利润、净保本投产比、微付费投产比、最佳投产比、实际拼单价
- 重命名「成本（含人工）」为「采购成本」，调整中间可滚动列顺序
- 实际利润公式：`(实际拼单价 × (1 - 平台扣点) - 采购成本 - 运费)`，不含退货率
- 款式列：多规格拼接显示（` / ` 分隔），固定列宽、内容换行
- 右侧价格区新增「实际拼单价」列（拼单价之前）
- 弹窗头部新增【导出】【导入】按钮（蓝色主色），导出同时复制剪贴板并下载 `.md` 文件
- Markdown 导出含标题 `# {goods_id}-{商品标题}`、活动配置节、SKU 定价表；导入按款式匹配，支持文件选择与粘贴

## Capabilities

### New Capabilities

（无新增 capability，均为对现有 price-calculator 的增强）

### Modified Capabilities

- `price-calculator`：更新计算公式、列布局、活动配置、款式扫描、Markdown 导入导出等全部行为需求

## Impact

- **代码**：`tampermonkey/price_calculator/price_calculator.user.js`（计算引擎、UI、扫描、导入导出）
- **文档**：`tampermonkey/price_calculator/README.md`（公式、活动、导入导出 FAQ）
- **规范**：`openspec/specs/price-calculator/spec.md`（通过本变更 delta 同步）
- **兼容性**：旧版导出的数据格式不兼容（活动区结构变更）；用户需重新导出
