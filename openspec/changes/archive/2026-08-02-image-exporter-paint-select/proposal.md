## Why

页面图片导出器当前仅支持逐张点击或全选/取消全选，当页面图片数量较多时批量挑选效率低。用户需要类似手机相册的「按下鼠标滑动多选」交互，在导出面板内快速选中或取消一批缩略图，并在划选过程中实时看到选中序号。

## What Changes

- 在导出面板的缩略图网格上新增**鼠标划选**（paint selection）交互：按住左键在卡片上移动，光标经过的缩略图会被处理
- 划选行为：未选中的图片划过后变为选中；已选中的图片再次划过后变为未选中（状态取反）
- 同一次划选手势内，每张卡片仅处理一次，避免来回抖动重复切换
- 划选过程中实时更新选中态与**序号 badge**（与现有下载顺序一致）
- 短距离点击（移动阈值内）仍保留现有单击 toggle 行为，与划选互不干扰
- 本期仅支持鼠标，不包含 touch 与矩形框选
- 更新 `tampermonkey/image_exporter/README.md` 补充划选用法说明

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `page-image-exporter`: 缩略图选择与交互——新增鼠标划选多选/反选及划选时序号 badge 实时展示

## Impact

- 主要修改：`tampermonkey/image_exporter/image_exporter.user.js`（事件处理、轻量 DOM 更新、样式）
- 文档更新：`tampermonkey/image_exporter/README.md`
- 无新增依赖与权限变更
- 不影响图片发现、下载、模块分组等现有能力
