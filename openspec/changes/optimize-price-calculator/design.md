## Context

`price_calculator.user.js`（v1.3.2）已实现 SKU 扫描、反推定价、5 种互斥优惠券、回填等功能。本次变更在单文件 IIFE 内重构计算引擎与 UI，不引入新依赖。详见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 实现正向加价定价模型及扩展指标（实际成本、实际利润、三种投产比、实际拼单价）
- 简化活动配置为「立减优惠券 + 限时限量购」
- 多规格款式拼接扫描、列布局重构、Markdown 导入导出（剪贴板 + 文件下载）
- 更新 spec delta 与 README

**Non-Goals:**

- 修改 `@match` 范围或 FAB 交互
- 支持旧版 5 券活动配置的导入兼容
- 实际利润中纳入退货率（后续迭代再议）
- 单买价公式变更（仍用 ×1.1 + 券 + 限时加价 + 随机偏移）

## Decisions

### 1. 计算流水线以「实际拼单价」为锚点

**决策**：先算 `actualGroupPrice = (C+E)×(1+j)`，再叠加活动得 `groupPrice`；利润与 ROI 基于 `actualGroupPrice`，不受挂牌价抬高影响。

**备选**：继续反推分母含扣点/退货率 — 与用户确认的运营模型不符，弃用。

### 2. 实际利润不含退货率，ROI 含退货率

**决策**：

```
actualProfit = actualGroupPrice × (1-i) - C - E
actualMarginRate = actualProfit / actualGroupPrice × 100
netBreakEvenRoi = (actualGroupPrice / actualProfit) / (1-g)
microPaidRoi = netBreakEvenRoi / 2 + 0.5
optimalRoi = netBreakEvenRoi × (actualMarginRate > 50 ? 1.4 : 2)
```

**最佳投产比分档**（按**实际利润率**）：

| 档位 | 条件 | 系数 |
|------|------|------|
| 高利率 | 实际利润率 > 50% | × 1.4 |
| 低利率 | 实际利润率 ≤ 50% | × 2 |

**备选**：利润乘 `(1-g)` — 用户明确要求先不考虑退货率进入利润。

### 3. 活动引擎简化

**决策**：删除 `pickExclusiveResult` 及 5 券 keys；`globalActivities = { coupon: { amount }, timeLimit: { type, value } }`。

叠加逻辑：

```
pin₀ = actualGroupPrice + coupon.amount
groupPrice = applyTimeLimit(pin₀, timeLimit)
activityMarkup = groupPrice - actualGroupPrice
```

限时加价用于单买价：`timeLimitAdd = groupPrice - pin₀`。

### 4. 多规格款式 carry-forward

**决策**：遍历 `detectHeaderColumns` 返回的全部 `styleCols`；每列维护 `carry[colIndex]`，空 cell 沿用上次非空值；`parts.join(' / ')`。

**备选**：仅取最后一列 — 多规格无法区分 SKU，弃用。

### 5. 列布局与 sticky

**决策**：

- 左 sticky-1：仅款式（width ~160px，`word-break: break-all`）
- 中间 11 列可滚动
- 右 sticky-r3/r2/r1：实际拼单价、拼单价、单买价

打开弹窗后 `requestAnimationFrame` 重算 sticky offset（现有模式扩展）。

### 6. 商品元信息提取

**决策**：`getGoodsMeta()` 返回 `{ goodsId, goodsTitle }`：

| 优先级 | goods_id 来源 |
|--------|--------------|
| 1 | URL `searchParams`: goods_id, id, goodsId |
| 2 | URL path 数字段 |
| 3 | `#basic.goods_name input[data-tracking-params]` 解析 `goods_id_page` |
| 4 | `'unknown'` |

标题：`document.querySelector('#basic\\.goods_name input[type="text"]')?.value`。

文件名：`sanitizeFilename(\`${goodsId}-${goodsTitle}\`)`，替换 `/\\:*?"<>|` 为 `-`，超长截断（80 字符）。

### 7. Markdown 导入导出

**决策**：

- 格式版本：`<!-- price-calculator-export v1 -->`
- 导出：`exportMarkdown()` → `clipboard.writeText` + `<a download>` Blob
- 导入：弹窗含 file input + textarea；`parseMarkdownExport(text)` 分段解析
- 表头 fuzzy：`normalizeHeader` 去括号/空格后映射到字段 key
- 款式匹配：`trim` 全等；未匹配计入 toast

**备选**：JSON 导出 — 用户要求 Markdown 表格，弃用。

### 8. 头部按钮

**决策**：`[导出(pc-primary)] [导入(pc-primary)] [刷新] [关闭]`，复用已有 `.pc-primary` 样式。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| **BREAKING** 定价结果变化 | README 说明新公式；自检用例更新 |
| 款式拼接变化导致导入匹配失败 | 导出/导入均用新拼接规则；提示未匹配数 |
| goods_id 提取失败 | 降级 `unknown`；标题仍可用 |
| 中间列增多，小屏体验差 | 保持横向滚动；左/右 sticky |
| 剪贴板 API 需 HTTPS/权限 | 失败时仍保留下载；toast 提示 |

## Migration Plan

1. 发布新版本脚本（version bump 1.4.0）
2. README 更新公式与 FAQ
3. 无服务端迁移；用户重新填写或导入新格式 Markdown

## Open Questions

（无 — 探索阶段已确认）
