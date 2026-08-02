## 1. 扫描逻辑重构

- [x] 1.1 在 `detectHeaderColumns` 中新增 `inventoryCol` 检测，设置 `styleCol = inventoryCol - 1`（fallback：`styleCols` 最后一项），并在返回值中携带 `headerCellCount`
- [x] 1.2 新增 `getRowColumnOffset(headerCellCount, rowCellCount)` 与 `getCellAt(cells, headerIndex, offset)` 辅助函数，用于 rowspan 列索引补偿
- [x] 1.3 新增 `findPriceInputsInRow(row)`：优先取行内 `.sku-beast-price-input-container input` 列表 `[拼单价, 单买价]`，不足时 fallback 到 offset 补偿后的列索引 + `findPriceInputInCell`
- [x] 1.4 重构 `extractSkuRowsFromBody`：款式统一从 offset 补偿后的 `styleCol` 提取（调用 `extractStyleFromCell`），移除多规格时 `extractStyleFromCells` 的优先 title 逻辑
- [x] 1.5 删除或简化不再使用的 `extractStyleFromCells`（若单规格路径不再需要则移除）

## 2. 验证与版本

- [x] 2.1 自检：单规格表格扫描结果与修复前一致（款式、成本、input 引用）
- [x] 2.2 自检：多规格 rowspan 场景——第 1 行款式取最后规格列、所有行成本取自拼单价 input
- [x] 2.3 脚本版本号递增（`1.3.1` → `1.3.2`）

## 3. 文档

- [x] 3.1 更新 `README.md` FAQ：补充多规格 SKU（型号+尺寸等）扫描规则说明
