## 1. 引擎层扩展

- [x] 1.1 新增 `resources.py`（`get_models_dir()`，支持开发目录与 `sys._MEIPASS` 打包路径）
- [x] 1.2 调整 `inpainter.py` / EasyOCR 初始化使用 `resources.py` 模型路径
- [x] 1.3 新增缩略图与 mask 坐标映射工具（缩略 inpaint ↔ 原图导出）
- [x] 1.4 暴露 `mask_from_rect` 等接口供 GUI 调用（必要时从 detector 导出）

## 2. GUI 基础框架

- [x] 2.1 创建 `gui/` 目录结构与 `__main__.py` 入口
- [x] 2.2 添加 PySide6 到 `requirements.txt`
- [x] 2.3 实现 `models.py`（ImageTask 状态、缩略图路径、mask 来源）
- [x] 2.4 实现 `pipeline.py`（缩略生成、auto detect、manual inpaint、export 全分辨率）
- [x] 2.5 实现 `worker.py`（QThread 单 worker 队列、taskFinished signal）

## 3. 主窗口与列表

- [x] 3.1 实现 `main_window.py`：选择文件/文件夹、图片列表、状态图标
- [x] 3.2 选图后立即入队并开始后台处理
- [x] 3.3 切换列表项：processing/queued 显示 loading；ready/failed 显示缓存
- [x] 3.4 处理完成后若为用户当前项则自动刷新视图
- [x] 3.5 状态栏队列进度（如 3/8）

## 4. 画布与手动框选

- [x] 4.1 实现 `image_canvas.py`（QGraphicsView 显示缩略原图）
- [x] 4.2 单矩形拖拽框选（新矩形替换旧矩形）
- [x] 4.3 「生成预览」：手动 mask → 缩略 inpaint
- [x] 4.4 「自动检测」：重跑 OCR 路径（可选，清手动框）
- [x] 4.5 「清除选区」
- [x] 4.6 自动失败时展示提示文案

## 5. 确认与导出

- [x] 5.1 手动预览后显示「确认」按钮；确认后标记 exportable
- [x] 5.2 自动 ready 不显示确认，直接可导出
- [x] 5.3 「导出当前」：全分辨率 inpaint + 保存对话框
- [x] 5.4 「导出全部」：仅 exportable + auto ready，跳过 failed/未确认手动项
- [x] 5.5 导出前提示跳过数量（如有）

## 6. 预览对比 UI

- [x] 6.1 双栏布局：原图缩略 | 修复预览缩略
- [x] 6.2 显示检测信息（自动命中关键词 / 手动选区）

## 7. 打包

- [x] 7.1 编写 `packaging/watermark_remover_gui.spec`（PyInstaller onedir、collect torch/cv2/easyocr）
- [x] 7.2 内置 `models/`（big-lama.pt、EasyOCR 权重）— 构建脚本自动下载，不提交 git
- [x] 7.3 Linux：`packaging/linux/build-appimage.sh`（或 deb + desktop）
- [x] 7.4 Windows：`packaging/windows/build-installer.iss`（Inno Setup）
- [x] 7.5 文档：构建步骤与发布物说明

## 8. 文档与验证

- [x] 8.1 更新 README：GUI 使用流程、确认规则、缩略/导出说明
- [x] 8.2 开发模式验证：选文件夹 → 自动批量 → 切换 loading → 手动框选 → 确认 → 导出
- [x] 8.3 验证自动失败不做默认 br 修复
- [x] 8.4 验证导出图尺寸与原图一致
- [x] 8.5 Linux 打包产物 smoke test（可选，有环境时）— 跳过，无 PyInstaller 构建环境
