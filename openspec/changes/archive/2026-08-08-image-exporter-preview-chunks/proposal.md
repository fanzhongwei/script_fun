## Why

导出面板标题栏在控件较多时出现竖向滚动条，影响观感；预览图 SKU 数量大（如 288 张）时全部平铺在单一文件夹中不便管理。

## What Changes

- 标题栏 CSS 显式设置 `overflow-y: hidden`，消除竖向滚动条（保留必要时横向滚动）
- 预览图总数超过 12 张时，按全局序号每 12 张一组下载到区间子文件夹（`1-12`、`13-24` …）
- 子文件夹内文件名保持全局连续序号（`1.jpg` … `12.jpg`、`13.jpg` …）
- 不超过 12 张预览图时仍使用扁平路径 `预览图/N.jpg`

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `page-image-exporter`: 面板标题栏不可竖向滚动；拼多多预览图大批量下载时分区间子文件夹且文件名全局连续编号

## Impact

- 影响文件：`tampermonkey/image_exporter/image_exporter.user.js`、`tampermonkey/image_exporter/README.md`
- 无新增依赖；轮播图/详情图下载路径不变
