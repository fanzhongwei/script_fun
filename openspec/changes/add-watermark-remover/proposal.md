## Why

电商铺货流程中，商品主图/详情图常来自 AI 生成平台（豆包、即梦等），图片右下角带有「豆包AI生成」等半透明文字水印，无法直接用于拼多多上架。当前仓库已有 `image_exporter` 下载与 `pdd_product_importer` 导入能力，但缺少本地批量去水印环节，用户需借助外部工具手工处理。需要新增一个本机 Python 脚本，针对 AI 图角落水印自动检测并修复，支撑十几张规模的小批量处理。

## What Changes

- 新增 Python 脚本目录 `python/watermark_remover/`，包含 CLI 入口、README、requirements.txt
- 支持单张与目录批量处理（≤20 张），本机 CPU 运行，无需 GPU
- 水印检测：四角 ROI 扫描 + OCR 关键词匹配（`patterns.yaml` 可配置豆包/即梦/通义万相等 AI 平台短语）
- 水印去除：基于 LaMa 模型 inpainting（`simple-lama-inpainting`），复杂纹理背景效果优于 OpenCV 传统修复
- 预览模式：输出 mask 叠加图供用户确认后再修复，降低误删正文风险
- 兜底：OCR 未命中时支持 `--region` 手动指定角落区域（如 `br` 右下）整块修复
- 与现有 Tampermonkey 脚本解耦，作为 `image_exporter` 下载后、`pdd_product_importer` 导入前的本地预处理步骤

## Capabilities

### New Capabilities

- `watermark-remover`：AI 图角落水印检测（OCR + 关键词）与 LaMa 修复，支持单张/批量、预览确认、手动区域兜底

### Modified Capabilities

（无）

## Impact

- 新增目录：`python/watermark_remover/`（`watermark_remover.py`、`requirements.txt`、`README.md`、`patterns.yaml`）
- 新增依赖：opencv-python、easyocr、torch（CPU）、simple-lama-inpainting、Pillow、PyYAML；首次运行需下载 LaMa 模型（约 200MB）
- 不影响现有 `tampermonkey/`、`linux/` 脚本行为
- 运行环境：本机 Python 3.9+，使用 `python3-dev` / `pip3-dev` 执行
