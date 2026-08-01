## Context

仓库 `script_fun` 已有 Tampermonkey 脚本 `image_exporter`，建立了 FAB 悬浮入口、可拖动定位（`GM_setValue`/`GM_getValue`）、遮罩弹窗、样式隔离（`#root-id`）等 UI 模式。本变更新增 `price_calculator`，面向电商平台商家后台 SKU 规格页（如拼多多），在页内完成定价计算与回填。

定价逻辑来源于 `tampermonkey/price_calculator/兵兵计算净投产表格(1).xlsx`，结合用户定义的活动叠加规则实现。Excel 仅作公式参考，运行时不需要加载该文件。

约束：

- 说明文件需包含：环境依赖、脚本参数、使用配置、FAQ
- 变更范围最小化，不影响既有脚本
- 弹窗宽高均为视口 80%；「率」类字段 UI 输入 0～100（百分比），内部换算为小数参与计算

## Goals / Non-Goals

**Goals:**

- 提供可拖动的「价格计算」FAB，交互风格与 `image_exporter` 一致
- 扫描页面 SKU 表格（款式、拼单价、单买价），生成 80vw×80vh 计算器弹窗
- 左 3 列固定 + 中间可滚动 + 右 1 列固定（活动区）的表格布局
- 实现基础定价公式、Excel 各活动公式、互斥取最高拼单价、时限量购叠加
- 支持成本批量粘贴、实时重算、回填原页输入框
- 落盘 `tampermonkey/price_calculator/price_calculator.user.js` + `README.md`

**Non-Goals:**

- 不做 Excel 文件导入/导出
- 不做库存、预览图等其他列的编辑
- 不做服务端 API 或数据持久化（除 FAB 位置外）
- 不保证适配所有电商平台的 DOM 结构（首版以拼多多商家后台为目标，DOM 选择器可配置/调优）

## Decisions

### 1. 目录与命名

- **决策**：`tampermonkey/price_calculator/price_calculator.user.js` + `README.md`
- **理由**：与仓库「一脚本一目录」规范一致；与 `image_exporter` 并列

### 2. 脚本元数据与权限

- **决策**：`@match *://mms.pinduoduo.com/*`（拼多多商家后台 `https://mms.pinduoduo.com/`）；`@grant GM_setValue`、`@grant GM_getValue`；`@run-at document-idle`
- **理由**：脚本仅面向拼多多商家后台，缩小注入范围；FAB 位置持久化与 image_exporter 相同
- **备选**：`*://*/*` 通用匹配 — DOM 结构特化，不采用

### 3. UI 架构（复用 image_exporter 模式）

- **决策**：
  - 根容器 `#pc-root`，样式前缀隔离
  - `createFab()` + `makeFabDraggable()` + `GM_setValue('pc_fab_pos')` — 逻辑照搬 image_exporter
  - 遮罩层 + 面板：`width: 80vw; height: 80vh; max-width: none;`
  - 表格区：`display: flex` 三区布局，中间 `overflow-x: auto`，tbody `overflow-y: auto`
  - 右侧固定列表头分两行：第一行合并单元格放**全局**活动配置区 + 「回填」按钮；第二行表头为「拼单价」「单买价」；数据行仅展示计算结果，无逐行活动控件
- **理由**：用户明确要求参照 image_exporter 的方式和样式；80% 视口由用户确认；活动对所有 SKU 行统一生效

### 4. 页面表格扫描

- **决策**：语义扫描，不绑定具体 CSS class
  1. 遍历 `table` 及常见 div-table 结构
  2. 找表头行：`cellText.includes('款式') && cellText.includes('拼单价')`
  3. 记录列索引：`styleCol`、`groupPriceCol`（拼单价）、`singlePriceCol`（单买价）
  4. 数据行提取：`{ style, groupInput, singleInput, rowIndex }`
  5. 过滤空款式行；多表时取行数最多且含 input 的表
- **理由**：商家后台 class 名常变，语义匹配更稳

### 5. 百分比字段处理

- **决策**：UI 层统一以 0～100 整数或小数展示；计算前 `rate = input / 100`
- **涉及字段**：目标销售利润率、退货率、平台扣点（可编辑）；利润率（只读展示）
- **默认值（UI 百分比）**：退货率 20、目标销售利润率 20、平台扣点 0.6
- **校验**：`input` 事件钳制到 [0, 100]；非法字符拒绝

### 6. 计算引擎

#### 6.1 符号约定

| 符号 | 含义 |
|------|------|
| `C` | 成本（含人工） |
| `E` | 运费（运费险） |
| `G` | 退货率（小数） |
| `I` | 平台扣点（小数，UI 输入 0.6 表示 0.6%） |
| `J` | 目标销售利润率（小数） |
| `K` | 基础拼单价（无活动） |
| `L` | 单买价 |

#### 6.2 基础公式（无活动，含平台扣点）

平台扣点参与定价与利润核算（对应 Excel 说明：扣除平台扣点）。先求满足目标利润率的顾客实付净价 `N`，再作为基础拼单价 `K`：

```
N = (C + E) / ((1 - I) - J / (1 - G))
K = ROUND(N, 2)
L = ROUND(K × 1.2 + 5, 2)
```

验证（`I=0` 退化为旧公式）：`C=5.94, E=0, J=0.2, G=0.2, I=0` → `K=7.92, L=14.50`

#### 6.3 利润率（只读展示，对应 Excel H 列）

```
实际到手价 N = K（无活动时；有活动时见 6.5）
利润 F = N × (1 - I) - C - E
利润率 H = (F / N) × (1 - G)    // 展示为 H × 100 %
```

有活动时，`N` 取最终拼单价减去有效立减/折扣后的顾客实付（见 6.5）。

#### 6.4 互斥活动公式（参考 Excel，用户输入立减金额 `a` ≥ 0）

各活动独立计算候选 `(pin, single)`，勾选多个时**取 pin 最大**的一组：

| 活动 | 拼单价 pin | 单买价 single | Excel 依据 |
|------|-----------|--------------|------------|
| 订单复购券 | `ROUND((K + a) / 0.6, 2)` | `ROUND(pin × 1.2 + 5, 2)` | 列 N：`M/0.6`，M=K |
| 店铺关注券 | `ROUND((K + a) / 0.6, 2)` | `ROUND(pin × 1.2 + 5, 2)` | 列 P：同复购券 |
| 新客立减券 | `ROUND(K + a, 2)` | `ROUND((K + a) × 1.3 + 15, 2)` | 列 R/Q：`K+15` / `K×1.3+15` |
| 直播券 | `ROUND((K + a + 5) / 0.6, 2)` | `ROUND((L + a + 5) / 0.6, 2)` | 列 S/T：`(M+5)/0.6` / `(L+5)/0.6` |
| 场景券 | `ROUND((K + a + 5) / 0.6, 2)` | `ROUND((L + a + 5) / 0.6, 2)` | 列 U：同直播 |

- `K`、`L` 为基础公式结果；`a` 为对应活动输入框中的立减金额（元）
- Excel 中固定常数 `15`、`5`、`0.6` 保留；用户输入的 `a` 叠加在对应位置上（等价于在 base 上增加立减补偿）
- 若某活动未勾选，不参与候选；若无任何互斥活动勾选，候选即为 `(K, L)`
- 活动配置为**全局**一份，应用于所有 SKU 行的计算

#### 6.5 时限量购叠加（在 6.4 结果 `(pin₀, single₀)` 之上）

设时限量购勾选，类型为 `打折` 或 `立减`，输入值为 `v`：

| 类型 | 拼单价 | 单买价 |
|------|--------|--------|
| 立减 | `pin = ROUND(pin₀ + v, 2)` | `single = ROUND(pin × 1.2 + 5, 2)` |
| 打折 | `pin = ROUND(pin₀ / (1 - v/100), 2)` | `single = ROUND(pin × 1.2 + 5, 2)` |

- 参考 Excel 列 R/Q 中立减 15 元的叠加模式；打折按净价反推挂牌价
- 时限量购未勾选时，输出即为 6.4 结果

#### 6.6 计算流水线（纯函数）

```
calcRow(row):
  1. 百分比 → 小数
  2. 若 C 为空或非正数 → 返回空价格，利润率置「—」
  3. 计算 K, L
  4. 对勾选的互斥活动各算 (pinᵢ, singleᵢ)，取 pin 最大者 → (pin₀, single₀)
  5. 若时限量购勾选 → 叠加得 (pin, single)
  6. 回算 N、F、H 更新利润率列
  7. 返回 { pin, single, marginRate }
```

- **理由**：用户确认基础公式；「参考 Excel 结合叠加规则」落实为分活动 Excel 公式 + 互斥取最高 + 限时叠加

### 7. 成本批量粘贴

- **决策**：监听成本列 `paste` 事件，`preventDefault`，按 `/[\s,;，；\t\n\r]+/` 拆分，`parseFloat` 过滤 NaN，从当前行向下填充；超出时 toast 提示
- **理由**：满足用户批量录入场景

### 8. 回填机制

- **决策**：
  - 右侧固定列表头活动区下方放置**唯一**「回填」按钮，不支持逐行单独回填
  - 点击后将**所有 SKU 行**已计算的拼单价、单买价一次性写入原页面表格
  - 写入方式：
    ```javascript
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    ```
  - 按扫描时保存的 `groupInput`/`singleInput` 引用逐行写入，以 `style` 文本二次校验；汇总成功/失败数量并 toast
- **理由**：用户确认统一回填；商家后台多为 React/Vue 受控组件，需触发框架感知

### 9. 模块划分（单文件 IIFE）

```
price_calculator.user.js
├── constants & defaults
├── injectStyles / ensureRoot
├── createFab / makeFabDraggable（复用 image_exporter 模式）
├── scanSkuTable()
├── parsePasteValues()
├── calcBasePrices()
├── calcActivityPrices()   // 互斥 + 限时叠加
├── calcRow()
├── renderPanel()
├── bindEvents()
├── fillBackAll()
└── showToast()
```

## Risks / Trade-offs

- [DOM 结构变化导致扫描失败] → 语义匹配 + 首版限定 `@match`；README FAQ 说明支持页面类型；预留选择器常量便于调整
- [虚拟滚动只渲染部分行] → 首版扫描可见 DOM 行；弹窗展示已扫描行数；后续可加「刷新」按钮
- [Excel 活动公式与后台实际活动机制不完全一致] → README 说明计算为参考定价；以 xlsx 为基准，运营自行核对
- [互斥取最高拼单价的业务含义] → 文档说明：同时勾选多个券时按最保守（最高挂牌价）定价，确保任一券生效均可满足目标利润率
- [80vw×80vh 小屏体验] → 中间列滚动 + tbody 纵向滚动；活动列宽度固定约 220px

## Migration Plan

- 新建 `tampermonkey/price_calculator/` 脚本与 README
- 无数据迁移；卸载油猴脚本即可回滚
- 可选更新根 README 的 Tampermonkey 脚本列表

## Resolved Decisions（原 Open Questions）

| 问题 | 决策 |
|------|------|
| `@match` 范围 | 限定 `*://mms.pinduoduo.com/*`（`https://mms.pinduoduo.com/`） |
| 平台扣点 | 纳入计算：`N = (C+E)/((1-I)-J/(1-G))`，利润 `F = N×(1-I)-C-E` |
| 回填交互 | 活动区下方唯一「回填」按钮，点击后全部 SKU 行一次性回填，不支持逐行回填 |
