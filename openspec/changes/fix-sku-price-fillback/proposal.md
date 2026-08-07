## Why

SKU 数量较多时，同步回填会在主线程连续派发大量 `input`/`change` 事件，导致页面卡死；同时回填结果统计存在「成功与失败双计」缺陷，出现价格已写入却提示失败的情况。

## What Changes

- 将「回填」改为异步分批写入页面拼单价/单买价输入框，批次间让出主线程
- 回填过程中展示进度提示（如「回填中 m/n」），完成后展示成功/跳过/失败汇总
- 回填进行中禁用「回填」按钮，防止重复点击
- 修正统计逻辑：同一行不得同时计入成功与失败；款式校验失败时跳过写入并仅计失败

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `price-calculator`: 回填原页面表格由同步一次性写入改为分批异步回填，并要求进度提示与正确的结果统计

## Impact

- 影响文件：`tampermonkey/price_calculator/price_calculator.user.js`、`tampermonkey/price_calculator/README.md`
- 无新增依赖；仅改动回填交互与统计行为
