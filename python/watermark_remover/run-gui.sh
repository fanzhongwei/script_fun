#!/usr/bin/env bash
# 开发环境启动 GUI：
# 1) 检测 / 安装独立 python3-dev
# 2) 依赖缺失时按本机 GPU（CUDA / ROCm / CPU）安装
# 3) 依赖就绪后再启动界面
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PY_ROOT="${PY_ROOT:-/home/develop/python}"
ENSURE_ENV="${ROOT}/packaging/linux/ensure-dev-env.sh"

export PATH="${PY_ROOT}/bin:${PATH}"
export PIP_CONFIG_FILE="${PIP_CONFIG_FILE:-${PY_ROOT}/pip.conf}"
export QT_QPA_PLATFORMTHEME="${QT_QPA_PLATFORMTHEME:-deepin}"
unset QT_PLUGIN_PATH

cd "$ROOT"

if [ ! -f "${ENSURE_ENV}" ]; then
  echo "错误: 找不到 ${ENSURE_ENV}" >&2
  exit 1
fi
chmod +x "${ENSURE_ENV}" "${ROOT}/packaging/linux/bootstrap-python.sh" 2>/dev/null || true

echo "==> 检查开发环境与依赖..."
bash "${ENSURE_ENV}"

echo "==> 启动 GUI"
exec python3-dev gui_entry.py "$@"
