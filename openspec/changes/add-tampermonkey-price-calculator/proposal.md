## Why

在电商平台（如拼多多）商家后台编辑 SKU 时，运营需要根据成本、运费、退货率、目标利润率及各类营销活动，反复计算「拼单价」与「单买价」，并在 Excel 与后台表格之间来回切换，效率低且易出错。需要一个油猴脚本，在商品规格页直接扫描 SKU 列表、按既定公式计算价格，并一键回填到原表格。

## What Changes

- 新增油猴脚本「价格计算器」及使用说明 README，目录 `tampermonkey/price_calculator/`
- 参照 `image_exporter` 的交互与样式，提供可拖动的「价格计算」悬浮按钮
- 点击后扫描页面 SKU 表格（款式、拼单价、单买价等列），生成计算器弹窗列表
- 弹窗尺寸为页面宽高的 80%；左侧三列固定、中间列可横向滚动、右侧活动列固定
- 支持成本列批量粘贴录入、活动叠加计算、拼单价/单买价回填原表格
- 所有「率」类字段（退货率、目标销售利润率、利润率、平台扣点）以百分比展示与输入，范围 0～100

## Capabilities

### New Capabilities

- `price-calculator`: 浏览器用户脚本：悬浮入口、SKU 表格扫描、价格计算弹窗、活动叠加定价、回填原页输入框

### Modified Capabilities

- （无）

## Impact

- 新增目录与文件：`tampermonkey/price_calculator/`（脚本 + README）
- 参考文件：`tampermonkey/price_calculator/兵兵计算净投产表格(1).xlsx`（公式与默认值来源，不纳入脚本运行时依赖）
- 复用 `image_exporter` 的 FAB 拖动、遮罩弹窗、样式隔离等 UI 模式
- 依赖环境：浏览器 + Tampermonkey/Violentmonkey；需申请 `GM_setValue`、`GM_getValue`（FAB 位置持久化）
- `@match` 限定拼多多商家后台 `*://mms.pinduoduo.com/*`
