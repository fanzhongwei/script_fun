## Why

在浏览网页时，经常需要批量保存页面中的图片，但浏览器原生能力只能逐张另存，且难以发现 CSS 背景图。需要一个通用的 Tampermonkey 用户脚本，在任意页面上快速发现、勾选并批量下载图片到本地下载目录的指定子文件夹中。

## What Changes

- 新增 `tampermonkey/` 分类目录（仓库 README 已预留，此前未落地）
- 新增油猴脚本「页面图片导出器」及其使用说明 README
- 脚本在页面右侧提供「导出图片」悬浮按钮
- 点击后扫描当前页 `<img>` 与 CSS `background-image`，以 200×200 平铺展示并支持复选
- 用户手动输入本地文件夹名，通过 `GM_download` 将选中图片下载到浏览器默认下载目录下的该子文件夹中

## Capabilities

### New Capabilities

- `page-image-exporter`: 浏览器用户脚本：悬浮入口、图片发现与预览选择、按用户指定文件夹名批量下载

### Modified Capabilities

- （无）

## Impact

- 新增目录与文件：`tampermonkey/image_exporter/`（脚本 + README）
- 可能更新根 `README.md` 中 Tampermonkey 分类的脚本列表说明
- 依赖环境：浏览器 + Tampermonkey/Violentmonkey；脚本需申请 `GM_download`、`GM_xmlhttpRequest` 等权限
- 不影响现有 `linux/`、`python/` 脚本功能
