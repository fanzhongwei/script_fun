## 1. 项目骨架

- [x] 1.1 创建 `python/watermark_remover/` 目录结构
- [x] 1.2 编写 `requirements.txt`（opencv-python、easyocr、torch CPU、simple-lama-inpainting、Pillow、PyYAML）
- [x] 1.3 编写默认 `patterns.yaml`（ROI 参数、corner_priority、AI 水印关键词）

## 2. 水印检测模块

- [x] 2.1 实现 `patterns.yaml` 加载（默认路径 + `--config` 覆盖）
- [x] 2.2 实现四角 ROI 裁剪（br/bl/tr/tl 及比例坐标）
- [x] 2.3 集成 EasyOCR，对 ROI 识别中文/英文文本
- [x] 2.4 实现关键词子串匹配，生成 OCR bbox 外扩 mask
- [x] 2.5 实现 `--region` 手动区域（预设角落 + 比例坐标），跳过 OCR

## 3. 修复模块

- [x] 3.1 封装 LaMa inpainting（simple-lama-inpainting，CPU 推理，map_location=cpu）
- [x] 3.2 实现 `--engine opencv` 降级（Telea/NS inpaint）
- [x] 3.3 实现 mask 叠加预览图与纯 mask 输出（`--preview` 模式）

## 4. CLI 入口

- [x] 4.1 实现 argparse：`-i`、`-o`、`--preview`、`--region`、`--config`、`--engine`、`--force`
- [x] 4.2 实现单张处理流程（检测 → 预览或修复 → 写文件）
- [x] 4.3 实现目录批量处理（过滤图片扩展名、跳过已存在、统计摘要）
- [x] 4.4 实现检测失败时的错误提示（建议使用 `--region`）

## 5. 文档与验证

- [x] 5.1 编写 `README.md`（环境依赖、参数说明、patterns.yaml 配置、FAQ）
- [x] 5.2 使用豆包 AI 样例图验证：自动检测 + LaMa 修复
- [x] 5.3 验证 `--preview` 输出 mask 预览图
- [x] 5.4 验证 `--region br` 手动兜底路径
- [x] 5.5 验证目录批量处理与 skip/force 行为
