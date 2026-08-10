## ADDED Requirements

### Requirement: 一键导出写入 manifest.json

在拼多多商家后台执行**一键导出**（轮播图、详情图、预览图及成本表）时，脚本 SHALL 在同一导出根目录 `{商品标题-商品ID}/` 下写入 `manifest.json`（version 为 `1`）。manifest SHALL 包含：

- `source`：`goodsId`、`goodsTitle`、`exportedAt`
- `specDimensions`：按 DOM 顺序的规格维度列表，每项含 `typeLabel`（平台规格类型选择器显示文本）与 `values`（该维度规格值列表）
- `images.carousel`、`images.detail`：相对导出根目录的图片路径数组
- `images.preview`：每项含 `index`（1-based 全局序号）、`file`（相对路径）、`style`（SKU 款式拼接文本）
- `excel`：成本表相对路径（默认 `成本表.xlsx`）
- `previewTotal`：预览图总数

#### Scenario: 一键导出生成 manifest

- **WHEN** 用户在拼多多编辑页触发一键导出且导出成功
- **THEN** 导出根目录下存在有效的 `manifest.json`，且 preview 条目序号与预览图分桶全局序号一致

#### Scenario: preview index 与分桶一致

- **WHEN** 预览图共 25 张且已导出
- **THEN** manifest 中第 15 条 preview 的 `index` 为 15，`file` 指向 `预览图/13-24/15.jpg`（或等价相对路径）

### Requirement: 导出时采集规格类型名

写入 manifest 时，脚本 SHALL 从源页各规格组的 DOM 采集 `typeLabel`，作为导入器精确匹配规格类型的依据；SHALL NOT 仅从 Excel 表头推断类型名。

#### Scenario: 多规格维度 typeLabel

- **WHEN** 源商品有「颜色」「尺码」两个规格组
- **THEN** manifest.specDimensions 按 DOM 顺序包含 typeLabel 为「颜色」与「尺码」的两项及各自 values
