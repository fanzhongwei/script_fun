# 打包说明

## 前置

- Python 3.9+，`pip install pyinstaller PySide6` 及 `requirements.txt` 全部依赖
- PyTorch CPU 版
- 磁盘空间 ≥ 3GB（构建中间产物 + 输出）

## 模型文件（全量离线）

构建前将 LaMa 权重放入 `models/big-lama.pt`（约 196MB）。可运行：

```bash
cd python/watermark_remover
bash packaging/linux/build-appimage.sh
```

脚本会在 `models/` 缺失时自动下载 LaMa。EasyOCR 模型可在首次开发运行后复制到 `models/easyocr/`，或构建后在目标机首次启动下载。

## Linux

```bash
cd python/watermark_remover
chmod +x packaging/linux/build-appimage.sh
./packaging/linux/build-appimage.sh
# 输出: dist/WatermarkRemover/WatermarkRemover
```

可选：使用 `appimagetool` 将 onedir 封装为 AppImage。

## Windows

在 Windows 机器上：

```bat
cd python\watermark_remover
pyinstaller --noconfirm packaging\watermark_remover_gui.spec
```

使用 Inno Setup 打开 `packaging/windows/build-installer.iss` 生成安装包。

## 忽略项

`dist/`、`build/`、`models/*.pt` 已加入 gitignore，勿提交构建产物与权重。
