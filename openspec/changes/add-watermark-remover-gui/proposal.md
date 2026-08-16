## Why

已有 CLI 工具 `python/watermark_remover/` 可去除 AI 图角落水印，但需要用户安装 Python 及 torch 等依赖，且 `--preview` / `--region` 交互不直观。电商用户（如拼多多铺货）更适合双击运行的桌面程序：选图后自动批量处理、切换查看预览、手动框选任意区域重试、确认后导出，无需命令行。

## What Changes

- 新增 PySide6 桌面 GUI（`python/watermark_remover/gui/`），复用现有 `detector.py` / `inpainter.py` 引擎
- 支持选择文件或文件夹，选入后立即后台自动批量处理（无批量模式下拉）
- 图片列表展示处理状态；切换已处理项显示缩略预览，切换未处理项显示 loading
- 双路径修复：**自动**（OCR + 关键词，仅猜 AI 水印位置）与 **手动**（单矩形框选，不依赖内置关键词，可去除任意区域）
- 自动检测失败时不做默认角落 inpaint，等待用户框选
- 手动框选后需显式「确认」；自动成功的图可直接导出
- 预览区使用缩略图缓存；导出时对原图全分辨率 inpaint
- 打包为 Linux（AppImage/deb）与 Windows（便携目录 + 安装包）全量离线分发（内置 Python、依赖与模型，约 1.5–2GB）
- CLI 入口保留；必要时小幅扩展引擎层（如 `resource_path`、矩形 mask 辅助）以支持打包与 GUI

## Capabilities

### New Capabilities

- `watermark-remover-gui`：跨平台桌面 GUI，自动队列批量处理、缩略预览、手动矩形框选、条件确认、全分辨率导出与离线打包

### Modified Capabilities

（无 — CLI `watermark-remover` 行为不变，GUI 为独立能力）

## Impact

- 新增：`python/watermark_remover/gui/`、`python/watermark_remover/packaging/`
- 可能小幅修改：`detector.py` / `inpainter.py`（资源路径、全分辨率 inpaint 接口），`requirements.txt` 增加 PySide6
- 新增依赖：PySide6；打包工具 PyInstaller（构建时）
- 不影响 Tampermonkey 脚本；CLI 仍可用于开发/自动化
- 构建：Linux 与 Windows 分别在本机或 CI 构建，不支持交叉编译
