#!/usr/bin/env bash
# 一键打包 Linux onedir + tar.gz（CPU 版，免 ROCm 依赖，适合分发）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

chmod +x packaging/linux/build-appimage.sh
./packaging/linux/build-appimage.sh

DIST="$ROOT/dist/WatermarkRemover"
ARCHIVE="$ROOT/dist/WatermarkRemover-linux-x86_64.tar.gz"

echo "==> 打包 tar.gz"
tar -czf "$ARCHIVE" -C "$ROOT/dist" WatermarkRemover

ls -lh "$DIST/WatermarkRemover" "$ARCHIVE"
echo ""
echo "完成:"
echo "  运行: $DIST/WatermarkRemover"
echo "  分发: $ARCHIVE"
