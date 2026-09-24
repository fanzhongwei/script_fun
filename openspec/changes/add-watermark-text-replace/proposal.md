# Proposal

## Why

去水印 GUI 只能把选区擦掉，不能把图里的文案换成新句子。商品图经常要改标题，又要保住原来的位置、大小和颜色。这次只做离线、可预期的重绘：用内置黑体/宋体画回去，不引入文字生成模型，安装包不因新模型变大。

## What Changes

- GUI 增加独立的「替换文案」模式，与现有「擦除水印」选区分开；擦除模式的形状工具、多选区、预览确认与导出行为保持不变
- 替换模式下用户用矩形框住一段文字；同一张图可以有多块替换框，每块对应一段新文案
- 对替换框运行已有 EasyOCR，把识别结果填进可编辑文本；识别失败时仍允许手填文案
- 预览与导出时：只擦掉框内字形（复用 LaMa），再按原文字的位置、字号和颜色，用内置黑体或宋体把新文案画回去
- 字体仅黑体、宋体两档，由用户选择；不追求与原图同一款字体文件，不处理花字、渐变、投影的风格迁移
- 字体文件随工具离线附带（开源可再分发的子集），不新增 pip 依赖，不下载新模型
- CLI `watermark_remover.py` 不增加文案替换

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `watermark-remover-gui`：增加替换文案模式（矩形多框、OCR 预填、黑体/宋体离线重绘、预览确认与全分辨率导出）；擦除水印的既有要求保持不变

## Impact

- GUI：`python/watermark_remover/gui/main_window.py`、`gui/models.py`、`gui/pipeline.py`、`gui/worker.py`、`gui/image_canvas.py`
- 新增替换流水线模块（框内 OCR、字形 mask、样式估计、Pillow 重绘）及两份内置子集字体
- 说明：`python/watermark_remover/README.md` 补充替换文案的操作、字体与限制
- 复用现有 EasyOCR、LaMa、Pillow、PySide6；不修改 CLI 检测与修复入口
- 打包需把字体文件打进现有 Linux / Windows 发布物；不增加模型体积
