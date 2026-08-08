## Context

图片导出器面板 `.pie-header` 使用 `overflow-x: auto`，在 CSS 规范下 `overflow-y` 会计算为 `auto`，控件总高度略超容器时出现竖向滚动条。预览图在拼多多 SKU 页可达数百张，当前全部保存为 `预览图/1.jpg` … `预览图/N.jpg`。

## Goals / Non-Goals

**Goals:**

- 标题栏禁止竖向滚动
- 预览图 >12 张时按 `1-12`、`13-24` 区间分子目录，文件名全局连续

**Non-Goals:**

- 不改标题栏为双行布局
- 不改轮播图/详情图路径规则
- 不改采集与 UI 展示逻辑

## Decisions

### 1. 标题栏：`overflow-y: hidden`

保留 `overflow-x: auto`，仅禁止竖向滚动条（方案 D）。

### 2. 分桶常量 `PREVIEW_CHUNK_SIZE = 12`

与业务约定一致；仅当**预览图类目总数** `> 12` 时启用区间子文件夹。

### 3. 路径规则

- 全局序号：预览图在 `images` 中 `moduleKey === 'category:preview'` 的 DOM 顺序，1-based
- 子文件夹名：`{chunkStart}-{chunkEnd}`，如 `13-24`；末组不足 12 张时 `chunkEnd = totalPreview`
- 文件名：`{globalIndex}{ext}`，跨文件夹连续编号
- 部分选中：序号与区间仍按完整预览列表中的位置计算

### 4. 实现位置

新增 `buildPreviewDownloadTasks`，在 `buildDownloadTasksFromBatches` 中对预览图批次单独处理；「下载全部」与「下载选中」共用该路径。

## Risks / Trade-offs

- [GM_download 多级子路径] → README 已有 FAQ；路径形如 `预览图/13-24/15.jpg`
- [区间文件夹名含 `-] → 非 Windows 非法字符，无需额外清洗
