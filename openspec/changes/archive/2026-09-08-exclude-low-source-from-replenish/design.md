## Context

判定集中在 `classifySku`，顺序与 `1688-stock-checker` spec 一致。`LOW_STOCK_THRESHOLD` 仍为 20。动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 仅调整已关联分支中 `补充库存` 与 `库存告急` 的条件，使货源 ≤ 阈值不再落入补货

**Non-Goals:**

- 不改扫描、导出、着色、阈值常量名与默认值
- 不新增检查结果取值

## Decisions

### 1. 店零且货源不足既不补充也不报告急

- **决策**：`补充库存` 改为 `shopStock === 0 && sourceStock > LOW_STOCK_THRESHOLD`。`库存告急` 仍要求 `shopStock > 0` 且 `sourceStock <= LOW_STOCK_THRESHOLD`。店零且货源 ≤ 阈值落入 `库存正常`。
- **理由**：店库存已为 0，无超卖风险，告急货源也不该补店；待处理只保留真正要处理的补货与告急（店仍有货）。
- **备选**：店零 + 货源 ≤ 阈值记 `库存告急` — 用户明确不要报告急，不采用。

## Risks / Trade-offs

- [店零且货源告急不再出现在待处理] → 符合「不补货、不报告急」；接受。

## Migration Plan

油猴脚本随版本号递增发布；无数据迁移。
