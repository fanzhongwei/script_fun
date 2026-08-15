## Context

- `pdd_product_importer` 已实现详情图 `deleteDetailImagesExceptFirst`（每轮重查 DOM、删 `slots[1]`、`clickDeleteIconFast`、40ms 间隔）；轮播仍调用通用 `deleteImagesExceptFirst`（静态 boxes、从后往前、`triggerClick`、350ms）。
- `price_calculator` 的 `DEFAULTS.targetMargin = 20`，`createDefaultActivities().coupon.amount = 0`；回填 `fillBackAll` 仅写 SKU 拼单价/单买价并点保存草稿，不涉及 `#market_price`。
- 动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 轮播删图与详情图快删策略对齐，提升多图场景速度与可靠性
- 价格计算器默认目标利润率 30%、立减券 5 元
- 回填成功后自动写商品参考价 = max(单买价) + 2
- 更新两个脚本 README

**Non-Goals:**

- 修改 manifest、image_exporter、spec_paste
- 自动打开 price_calculator 或与 importer 串联
- 改变详情图上传后删首张旧图的既有流程
- 修改 Markdown 导出格式中的默认值说明逻辑（导出仍写当前值）

## Decisions

### 1. 轮播快删：复用详情图模式而非改旧函数

- **决策**：新增 `deleteCarouselImagesExceptFirst()`，内部复用 `clickDeleteIconFast` 与 `DETAIL_DELETE_GAP_MS`（40ms）；`stepCarousel` 改调新函数。保留 `deleteImagesExceptFirst` 供预览图等仍适用的场景，或若无其他调用则标记 deprecated 内联删除。
- **理由**：详情图已验证「始终删 index 1 + 重查 DOM」可应对 React 重排；轮播 DOM 结构同为 `MaterialModalButton_v2_imageWrapper` + `DeleteIcon`。
- **备选**：继续从后往前删但缩短间隔 — 仍受静态快照问题影响，弃用。

### 2. 轮播卡片枚举

- **决策**：继续用现有 `getCarouselImageBoxes()` 返回 `imageBox` / `imageWrapper` 列表；快删循环中每轮重新调用，删 `boxes[1]` 的 DeleteIcon。
- **理由**：选择器已覆盖用户提供的 DOM；与详情 `getDetailImageSlots` 对称。

### 3. 价格默认值

- **决策**：`DEFAULTS.targetMargin = 30`；`createDefaultActivities()` 中 `coupon.amount = 5`。扫描新行时 `buildRowFromScan` 仍读 `DEFAULTS.targetMargin`；活动面板初始化读 `globalActivities`。
- **理由**：最小 diff；Markdown 导入仍覆盖用户保存的配置。
- **备选**：仅 UI 显示默认、计算仍用 20 — 与 spec 不符。

### 4. 商品参考价定位与写入

- **决策**：
  - 定位：`#market_price input[data-testid="beast-core-inputNumber-htmlInput"]`，fallback `#sku\\.market_price input.IPT_input`、`#goods-spec-sku #market_price input`
  - 计算：`round2(Math.max(...targets.map(r => r.singlePrice)) + 2)`，targets 为本次回填有效行
  - 写入：复用现有 `setNativeInputValue` + `input`/`change` 派发（与事件兜底回填同路径）；在 SKU 写入成功之后、点击「保存草稿」之前执行
  - tableList 与事件兜底两条路径均在成功后调用同一 `fillMarketReferencePrice(targets)`  helper
- **理由**：平台 placeholder「应大于商品最大单买价」；+2 满足校验余量；与现有 React 受控输入写法一致。
- **备选**：写 tableList 字段 — 未观测到稳定 API，不采用。

### 5. 参考价失败策略

- **决策**：找不到输入框或 max 单买价无效时静默跳过，不回滚 SKU 回填；汇总提示中可选追加「未更新参考价」仅当 helper 明确失败（实现时 console.warn）。
- **理由**：参考价为辅助字段，不应阻断 SKU 价格回填。

## Risks / Trade-offs

- **[Risk] 轮播 DeleteIcon 层级与详情略有差异** → 删前在 `boxes[1]` 内 `querySelector('[class*="DeleteIcon"]')`，与 `findDetailDeleteInCard` 同构
- **[Risk] 40ms 过快导致平台丢点击** → 与详情/预览已用 40ms 一致；若回归可提取 `CAROUSEL_DELETE_GAP_MS` 常量便于调参
- **[Risk] `#market_price` DOM 变更** → 多选择器 fallback；README FAQ 注明
- **[Trade-off] 默认值变更影响老用户习惯** → README 与 spec 明确；Markdown 导入可恢复旧配置

## Migration Plan

1. 用户更新 Tampermonkey 两个脚本即可，无数据迁移
2. 已在进行中的编辑页：重新打开价格计算器弹窗才应用新默认；已打开弹窗保持内存态
3. 回滚：还原脚本版本

## Open Questions

（无 — 参考价公式固定为 max(单买价)+2，轮播快删对齐详情 40ms，已在 explore 阶段确认。）
