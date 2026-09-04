## Purpose

本机 Python CLI 工具：针对 AI 生成图片角落半透明文字水印，自动检测（OCR + 关键词）并用 LaMa 修复，支持单张/小批量、预览确认与手动区域兜底，供 `image_exporter` 下载后、`pdd_product_importer` 导入前的本地预处理。

## ADDED Requirements

### Requirement: CLI 单张与目录批量处理

脚本 SHALL 提供命令行入口，接受 `-i` 输入路径（单张图片或目录）与 `-o` 输出路径（单张文件或目录）。当输入为目录时，脚本 SHALL 递归或平铺处理其中 `.png`、`.jpg`、`.jpeg`、`.webp` 文件。批量处理结束时 SHALL 打印成功、失败、跳过数量统计。

#### Scenario: 单张图片处理成功

- **WHEN** 用户提供有效图片路径 `-i photo.png` 与输出路径 `-o clean.png`
- **THEN** 系统检测水印、修复并写入 `clean.png`

#### Scenario: 目录批量处理

- **WHEN** 用户提供含 5 张图片的目录 `-i ./ai_images/` 与输出目录 `-o ./clean/`
- **THEN** 系统逐张处理并在 `./clean/` 下生成对应修复图，最后打印统计摘要

#### Scenario: 跳过已存在输出

- **WHEN** 批量模式下输出目录已存在同名修复图且未指定 `--force`
- **THEN** 系统跳过该文件并在统计中计入 skipped

### Requirement: AI 水印自动检测

脚本 SHALL 按配置文件中的角落优先级（默认右下、左下、右上、左上）依次裁剪 ROI 区域，对 ROI 运行 OCR，并将识别文本与关键词列表（如「豆包AI生成」「即梦」「AI生成」等）做子串匹配。首次命中 SHALL 生成覆盖该文字区域的二值 mask（bbox 外扩可配置像素）。

#### Scenario: 右下 OCR 命中豆包水印

- **WHEN** 图片右下角 ROI 内 OCR 识别到「豆包AI生成」
- **THEN** 系统生成覆盖该文字及外扩边距的 mask，并停止扫描其他角落

#### Scenario: 多角落均未命中

- **WHEN** 四个角落 ROI 均未匹配任何关键词
- **THEN** 系统标记该图为检测失败，不执行修复，并在统计中计入 failed，提示用户使用 `--region` 手动指定

#### Scenario: 自定义配置文件

- **WHEN** 用户通过 `--config` 指定自定义 patterns 文件且其中含额外关键词
- **THEN** 系统使用该文件中的 ROI 参数与关键词进行检测

### Requirement: LaMa 修复输出

检测到有效 mask 后，脚本 SHALL 使用 LaMa inpainting 模型对 mask 区域进行修复，并将结果写入输出路径。默认引擎 SHALL 为 LaMa；SHALL 支持 `--engine opencv` 作为可选降级。

#### Scenario: 默认 LaMa 修复

- **WHEN** 检测成功且未指定 `--engine`
- **THEN** 系统使用 LaMa 修复并输出无 mask 覆盖的完整图片

#### Scenario: OpenCV 降级修复

- **WHEN** 用户指定 `--engine opencv` 且检测成功
- **THEN** 系统使用 OpenCV inpaint 修复并输出结果

### Requirement: 预览模式

脚本 SHALL 支持 `--preview` 模式：执行检测并输出 mask 预览图（mask 叠加原图 + 纯 mask），但不写入修复结果。预览文件 SHALL 写入 `-o` 指定目录。

#### Scenario: 预览不修复

- **WHEN** 用户指定 `--preview -i photo.png -o ./preview/`
- **THEN** 系统在 `./preview/` 下输出 `photo.mask.png`（叠加预览）与 `photo.mask.bin.png`（纯 mask），不生成修复图

### Requirement: 手动区域兜底

脚本 SHALL 支持 `--region` 参数：可指定预设角落（`br`、`bl`、`tr`、`tl`）或四个 0~1 比例坐标（`x1,y1,x2,y2`）。指定后 SHALL 跳过 OCR，直接将该区域作为 mask 进行修复。

#### Scenario: 预设右下角落

- **WHEN** 用户指定 `--region br`
- **THEN** 系统按配置文件 ROI 比例裁剪右下区域为 mask 并执行修复

#### Scenario: 自定义比例坐标

- **WHEN** 用户指定 `--region 0.75,0.85,1.0,1.0`
- **THEN** 系统将该矩形区域作为 mask 并执行修复

### Requirement: 使用说明文档

脚本目录 SHALL 包含 README.md，涵盖：环境依赖说明（Python 版本、pip 依赖、首次模型下载）、脚本参数说明、patterns.yaml 配置说明、FAQ（OCR 漏检、修复留痕、耗时预期等）。

#### Scenario: README 完整性

- **WHEN** 用户阅读 `python/watermark_remover/README.md`
- **THEN** 文档包含上述四类说明，足以在无额外上下文下完成安装与首次运行
