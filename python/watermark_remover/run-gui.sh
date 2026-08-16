#!/usr/bin/env bash
# 开发环境启动 GUI（需已配置 python3-dev）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/home/develop/python/bin:${PATH}"
export QT_QPA_PLATFORMTHEME="${QT_QPA_PLATFORMTHEME:-deepin}"
unset QT_PLUGIN_PATH

cd "$ROOT"
exec python3-dev gui_entry.py "$@"
