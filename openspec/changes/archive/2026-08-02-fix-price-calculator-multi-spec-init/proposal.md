## Why

价格计算器在拼多多商家后台存在**多个规格类型**（如「型号 + 尺寸」）的 SKU 表格时，初始化扫描结果错误：第一行款式被误识别为第一个规格列（型号）的值，且第 2 行及以后行的拼单价无法提取为成本。根因是固定列索引未处理 rowspan 合并单元格，以及款式提取策略优先匹配第一个规格列的 `.sku-row-title`。该 bug 导致多规格商品无法正确初始化计算器，用户需手动逐行填写成本。

## What Changes

- 修正 SKU 扫描逻辑：**款式固定取「当前库存」前一列**（即最后一个规格列），并对 rowspan 导致的 td 错位做索引补偿
- 修正成本初始值提取：**按行内 DOM 语义定位拼单价输入框**（`.sku-beast-price-input-container input` 第一个），不依赖固定列索引，避免 rowspan 行错位
- 单买价输入框引用同步改为按行内 DOM 顺序取第二个 price input
- 更新 README FAQ，补充多规格 SKU 场景的扫描说明
- 脚本版本号递增

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `price-calculator`：修改「扫描页面 SKU 表格」需求，明确多规格场景下的款式列与拼单价提取规则，并新增对应场景

## Impact

- **代码**：`tampermonkey/price_calculator/price_calculator.user.js`（`detectHeaderColumns`、`extractSkuRowsFromBody` 及相关辅助函数）
- **文档**：`tampermonkey/price_calculator/README.md`（FAQ 补充）
- **依赖**：无新增依赖
- **兼容性**：单规格 SKU 表格行为保持不变；多规格 rowspan 表格修复初始化错误
