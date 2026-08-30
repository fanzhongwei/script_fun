## Why

拼多多商家后台详情图已切到 V2 快捷编辑（`#detail_pic` 内 `quick-decoration-container-v2`），导出器仍只认旧版 `img[el_preview_business_details]`，页面已上传 12 张时面板往往只列出几张，一键导出与后续导入都会缺图。同时规格值常带「赠 / 送 / 赠品」等字样，直接导出的成本表会把违规词带到目标商品；需要在导出前先清洗页面规格值。

## What Changes

- **修正详情图采集**：在 `#detail_pic` 按 V2 槽位（含「预览」「更换」的卡片）枚举，同时取 `<img>` 与 CSS 背景图；尽量还原缩略 URL 后再做短边 480 过滤；占位判断只看本卡片。面板「详情图」数量应与页面「已上传 N/50」一致（合法图范围内）。
- **一键导出前清洗规格值**：仅改 `#spec` / `.goods-sku-box.goods-spec` 内规格值输入框（`请输入规格名称`），不改规格类型下拉、不直接改 SKU 表单元格。
- **替换规则**：长词优先替换 `赠送`、`赠品`、`附赠`，再替换单字 `赠`、`送`，一律换成 `-`；连续 `-` 合并为一个；清洗后等 SKU 表按新名重生，再导出成本表并写 `manifest`。
- **撞名中断**：同一规格类型下清洗后出现重复规格值时，中断本次一键导出（含成本表），提示用户手动处理后重试；不自动改名消歧。
- 不改导入器流水线语义；不新增依赖。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `page-image-exporter`: 详情图按 V2 槽位采全；一键导出前清洗规格值（赠品词 → `-`），撞名则中断导出。

## Impact

- 代码：`tampermonkey/image_exporter/image_exporter.user.js`（采集 + 一键导出时序）。
- 文档：`tampermonkey/image_exporter/README.md`（详情图选择器、规格清洗与撞名中断）。
- 行为：打开导出面板时详情图应与页面已上传张数一致；一键导出会改源页规格值（不点保存草稿则不落库）；撞名时不写出残缺成本表。
- 依赖：无新依赖；规格写入复用现有 React 友好 input 方式（与 `spec_paste` 同类）。
