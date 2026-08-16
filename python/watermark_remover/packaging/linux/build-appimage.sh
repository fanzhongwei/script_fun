#!/usr/bin/env bash
# 构建 Linux AppImage 前准备 onedir，需先下载模型到 models/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> 准备 models/（若不存在则下载 LaMa）"
mkdir -p models/easyocr
if [ ! -f models/big-lama.pt ]; then
  python3-dev - <<'PY'
from simple_lama_inpainting.utils.util import download_model
import shutil
from pathlib import Path
url = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"
path = Path(download_model(url))
dest = Path("models/big-lama.pt")
shutil.copy2(path, dest)
print("copied", dest)
PY
fi

echo "==> PyInstaller onedir"
python3-dev -m PyInstaller --noconfirm packaging/watermark_remover_gui.spec

DIST="$ROOT/dist/WatermarkRemover"
if [ ! -d "$DIST" ]; then
  echo "构建失败: $DIST 不存在" >&2
  exit 1
fi

echo "==> 构建完成: $DIST"
echo "运行: $DIST/WatermarkRemover"
echo "可选: 使用 appimagetool 将 $DIST 打包为 AppImage"
