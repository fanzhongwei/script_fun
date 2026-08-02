## Context

当前 `price_calculator.user.js` 通过表头语义匹配定位规格列与拼单价列，再按固定 `cells[index]` 提取每行数据。拼多多多规格 SKU 表（如「型号 + 尺寸」）中，第一个规格列（型号）使用 rowspan 合并，导致：

- 第 1 行：`extractStyleFromCells` 优先命中型号列的 `.sku-row-title`，款式误为型号值
- 第 2+ 行：body 行 td 数少于表头（leading cell 被 rowspan 占用），固定 `groupCol` 索引错位，拼单价 input 读不到

用户选定**方案 B**：款式列仍按表头定位（「当前库存」前一列 + rowspan 补偿），拼单价/单买价改按行内 DOM 语义定位。

详见 [proposal.md](./proposal.md)。

## Goals / Non-Goals

**Goals:**

- 多规格 rowspan 表格：每行款式取最后一个规格列（「当前库存」前一列）的文本
- 每行成本初始值取自该行拼单价输入框的当前值（> 0 时填入成本列）
- 拼单价/单买价 input 引用按行内 DOM 顺序获取，供回填一一对应
- 单规格表格行为与修复前一致

**Non-Goals:**

- 不支持拼接多个规格列为款式名（如 `型号_尺寸`）
- 不改动价格计算公式、活动逻辑、弹窗 UI
- 不处理虚拟滚动自动加载（仍依赖用户手动滚动后点「刷新」）

## Decisions

### 1. 款式列：固定为「当前库存」前一列 + rowspan 索引补偿

**选择**：在 `detectHeaderColumns` 中新增 `inventoryCol = texts.findIndex(t => t.includes('当前库存'))`，令 `styleCol = inventoryCol - 1`；提取时按 `offset = headerCellCount - rowCellCount` 计算实际 cell 索引：`actualIndex = headerIndex - offset`。

**理由**：与用户业务语义一致——SKU 粒度由最后一个规格维度决定（尺寸），而非分组用的型号。

**备选**：
- 方案 A 仅用 `styleCols[styleCols.length - 1]`：与「当前库存前一列」在标准 PDD 表等价，但缺少 inventory 锚点，表头异常时不够明确
- 保留 `extractStyleFromCells` 多列拼接：第 1 行仍会错

**Fallback**：若找不到「当前库存」列，回退到 `styleCols[styleCols.length - 1]`（保持与现有 STYLE_HEADER_NAMES 兼容）。

### 2. 拼单价/单买价：按行内 price input DOM 顺序

**选择**：在 `extractSkuRowsFromBody` 中对每行执行：

```javascript
const priceInputs = row.querySelectorAll('.sku-beast-price-input-container input');
const groupInput = priceInputs[0] ?? null;
const singleInput = priceInputs[1] ?? null;
```

**理由**：price input 容器在每行内顺序稳定，不受 rowspan 导致的 td 错位影响。

**Fallback**：若行内 price input 不足 2 个，回退到 offset 补偿后的 `cells[groupCol]` / `cells[singleCol]`（与现有 `findPriceInputInCell` 逻辑一致）。

### 3. 移除多规格时的 `extractStyleFromCells` 优先 title 逻辑

**选择**：统一走 `extractStyleFromCell(cells[actualStyleIndex])`，不再在多规格列中「找第一个 `.sku-row-title`」。

**理由**：该启发式是 bug 直接原因；最后一个规格列已足够表达 SKU 款式。

### 4. 成本初始值逻辑不变

**选择**：仍由 `buildSkuRow` 读取 `groupInput.value`，`> 0` 时写入成本。

**理由**：行为契约未变，仅修正 input 引用来源。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 某行 price input 顺序非 [拼单价, 单买价] | 优先 DOM 顺序；fallback 到 offset 列索引；回填前已有 style 校验 |
| 表头无「当前库存」列 | fallback 到 `styleCols` 最后一项 |
| 多个 leading rowspan 列（offset > 1） | 按 `headerLen - rowLen` 通用计算；若 PDD 仅合并首列则 offset=1 |
| 行内无 `.sku-beast-price-input-container` | fallback 到 `cells` 内 `input` 查找（现有 `findPriceInputInCell`） |

## Migration Plan

1. 修改 `price_calculator.user.js` 扫描逻辑，版本号 `1.3.1` → `1.3.2`
2. 更新 README FAQ（多规格 SKU 说明）
3. 用户在 Tampermonkey 中更新脚本即可，无数据迁移

回滚：恢复上一版本脚本。

## Open Questions

（无——方案 B 已在 explore 阶段与用户确认）
