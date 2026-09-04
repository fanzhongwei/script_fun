## Why

开发机已有可用的 `python3-dev`，但 `run-gui.sh` 因硬编码 `cpython/` 目录判定失败，每次启动仍尝试重新安装 Python。同时 GUI 选图后立刻 OCR 自动修复，手动只能画一个矩形，无法贴合不规则水印、也无法一次处理多块区域；选区误操作后缺少键盘撤销/恢复。需要改为「能跑就跳过安装 + 纯手动多选区预览确认」。

## What Changes

- 修正 Linux 开发启动：`python3-dev` 可执行且能跑通版本检测时，**跳过**独立 CPython bootstrap；仅在解释器缺失时才安装；依赖仍按现有 `deps_ready` 按需安装
- **BREAKING（GUI 交互）**：选入图片后 **不再** 自动 OCR/修复；后台最多只加载缩略图
- 去掉 GUI「自动检测」入队路径；导出前必须手动选区 → 生成预览 → 确认（CLI 自动检测保持不变）
- 手动选区支持用户选择形状：矩形、椭圆、多边形、套索；支持同一张图上 **多个选区**（并集为 mask）
- 选区支持撤销与恢复，且 **必须支持键盘**（Ctrl+Z / Ctrl+Y 或 Ctrl+Shift+Z，与按钮一致）
- 改选区后作废旧预览，须重新生成预览才能确认

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `watermark-remover-gui`：开发启动不再误装 Python；去掉选图即自动处理；手动不规则多选区、预览确认；选区键盘撤销/恢复

## Impact

- 脚本：`python/watermark_remover/run-gui.sh`、`packaging/linux/bootstrap-python.sh`、`packaging/linux/ensure-dev-env.sh`
- GUI：`gui/image_canvas.py`、`gui/models.py`、`gui/pipeline.py`、`gui/worker.py`、`gui/main_window.py`
- 说明：`python/watermark_remover/README.md`（启动判定、手动多选区与快捷键）
- CLI `watermark_remover.py` 自动检测行为不变；不新增运行时依赖
- 打包产物交互与 GUI 一致（无入队自动修复）
