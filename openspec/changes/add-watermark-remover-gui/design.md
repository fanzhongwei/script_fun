## Context

`python/watermark_remover/` 已实现 CLI：四角 OCR + 关键词/正则检测、LaMa inpaint、`--region` 手动区域。动机见 proposal.md。目标用户无需安装 Python，双击桌面程序完成去水印；典型批量规模 ≤20 张，本机 CPU。

## Goals / Non-Goals

**Goals:**

- PySide6 桌面应用，Linux + Windows 双平台
- 选择文件/文件夹后立即后台自动批量处理（单 worker 队列）
- 列表切换：已处理显示缩略预览；未处理/处理中显示 loading
- 自动路径：OCR + patterns；失败时不默认角落 inpaint
- 手动路径：单矩形框选，不依赖关键词，可去除任意区域；需显式「确认」后才可导出
- 自动成功的图无需确认，可直接导出
- 预览用缩略图；导出时对原图全分辨率 inpaint
- PyInstaller onedir 全量离线包（内置模型）

**Non-Goals:**

- 批量模式下拉、多矩形框选、GPU 加速
- macOS 打包（后续可选）
- 修改 Tampermonkey 脚本
- 替换或移除 CLI

## Decisions

### 1. UI 框架与入口

- **决策**：PySide6；入口 `python/watermark_remover/gui/__main__.py`
- **理由**：QGraphicsView 矩形框选、QThread、跨平台文件对话框成熟
- **备选**：CustomTkinter — 框选与图像查看较弱

### 2. 选图即自动批量（无模式选择）

- **决策**：用户选择文件/夹后，所有图片立即入队；Worker 串行处理（detect → 缩略 inpaint → 缓存）
- **理由**：符合「不想逐张点启动」；串行避免 CPU 上多 LaMa 并发卡顿
- **UI**：列表项状态 `queued | processing | ready | failed | manual_pending_confirm | exportable`

### 3. 双路径修复

```
Auto:   detect_auto() → mask → inpaint(缩略) → ready / failed
Manual: 用户矩形 → mask_from_rect() → inpaint(缩略) → manual_pending_confirm
Export: 按 mask（缩略坐标映射回原图）→ inpaint(原图全分辨率)
```

- **自动失败**：`failed`，不调用 `parse_region('br')` 等默认修复
- **手动**：完全跳过 OCR/keywords，矩形即 mask

### 4. 确认与导出规则

| 来源 | 预览后状态 | 导出条件 |
|------|------------|----------|
| 自动成功 | `ready` | 可直接导出 |
| 自动失败 | `failed` | 不可导出，需手动框选 |
| 手动框选 | `manual_pending_confirm` | 用户点「确认」后变为 `exportable` |

- **决策**：仅手动框选路径显示「确认」按钮；自动 `ready` 视为已认可

### 5. 缩略预览 + 全分辨率导出

- **决策**：入队时对原图生成 max 边 1024px 缩略图；自动/手动 inpaint 在缩略图上执行并缓存预览
- **导出**：将 manual_rect / auto mask  bbox 按缩放比例映射到原图坐标，对原图全分辨率 inpaint 后写入用户选择路径
- **理由**：十几张 1024² 预览流畅；导出质量不妥协
- **备选**：全程原图 inpaint — 预览太慢

缩略比例：`scale = min(1.0, 1024 / max(w,h))`；mask 坐标：`orig = thumb / scale`（四舍五入）

### 6. 切换与 loading

- **决策**：`QListWidget` 选项变更时，若当前项 `processing|queued` 显示 overlay loading 并连接 `taskFinished` signal；完成后刷新双栏（原图缩略 | 预览缩略）
- **决策**：已 `ready|failed|exportable` 项切换零等待，读内存缓存

### 7. 模块结构

```
python/watermark_remover/
├── detector.py / inpainter.py / patterns.yaml   # 引擎（小幅扩展）
├── watermark_remover.py                          # CLI 不变
├── resources.py                                  # resource_path() 打包路径
├── gui/
│   ├── __main__.py
│   ├── app.py
│   ├── main_window.py
│   ├── image_canvas.py      # QGraphicsView 单矩形
│   ├── worker.py            # QThread + 队列
│   ├── pipeline.py          # ImageTask 状态机
│   └── models.py
└── packaging/
    ├── watermark_remover_gui.spec
    ├── linux/build-appimage.sh
    └── windows/build-installer.iss
```

### 8. 打包

- **决策**：PyInstaller `--onedir`；`models/` 内置 big-lama.pt 与 EasyOCR 权重；`resources.py` 通过 `sys._MEIPASS` 解析
- **Linux**：AppImage 优先，可选 .deb + .desktop
- **Windows**：onedir 便携 + Inno Setup 安装包
- **构建**：各平台分别构建，不交叉编译

### 9. 引擎层扩展（最小）

- `resources.py`：`get_models_dir()` 供 inpainter/detector 使用
- `pipeline.scale_mask_to_original(thumb_mask, scale)` 或 bbox 映射工具
- `inpainter.inpaint(image, mask)` 接口不变，GUI 传入原图或缩略图

## Risks / Trade-offs

- **[Risk] 缩略 inpaint 预览与全图导出视觉差异** → 导出前可选「导出前预览原图效果」（Phase 2）；MVP 导出说明文档注明
- **[Risk] 包体积 ~2GB** → 用户已接受全量离线
- **[Risk] PyInstaller + torch 打包失败** → spec 文件 collect-all；CI 文档记录 hiddenimports
- **[Risk] 手动框选未确认误导出** → 手动路径必须 confirm 后才 exportable
- **[Trade-off] 单 worker 批量慢** → 可接受（≤20 张）；状态栏显示队列进度

## Migration Plan

- 纯新增 GUI 与 packaging；CLI 行为不变
- 开发环境：`pip install PySide6`；`python -m gui` 启动
- 回滚：删除 `gui/`、`packaging/` 即可

## Open Questions

（无 — 确认规则、失败策略、单矩形、缩略/导出策略已在 explore 阶段对齐）
