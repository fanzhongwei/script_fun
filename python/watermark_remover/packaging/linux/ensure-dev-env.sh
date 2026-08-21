#!/usr/bin/env bash
# 确保 python3-dev 与 watermark_remover 依赖就绪（按本机 GPU 选择 torch）
# 由 run-gui.sh 调用；也可单独执行: ./packaging/linux/ensure-dev-env.sh
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PACKAGING_LINUX="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
ROOT="$(cd "${PACKAGING_LINUX}/../.." && pwd)"
PY_ROOT="${PY_ROOT:-/home/develop/python}"
PIP_CONF="${PIP_CONF:-${PY_ROOT}/pip.conf}"
REQ_FILE="${ROOT}/requirements.txt"

# CUDA / ROCm wheel 源（可按环境覆盖）
TORCH_CUDA_INDEX="${TORCH_CUDA_INDEX:-https://download.pytorch.org/whl/cu124}"
TORCH_CUDA_MIRROR="${TORCH_CUDA_MIRROR:-https://mirrors.aliyun.com/pytorch-wheels/cu124/}"
TORCH_CPU_INDEX="${TORCH_CPU_INDEX:-https://download.pytorch.org/whl/cpu}"
TORCH_CPU_MIRROR="${TORCH_CPU_MIRROR:-https://mirrors.aliyun.com/pytorch-wheels/cpu/}"
PYPI_MIRROR="${PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"

export PATH="${PY_ROOT}/bin:${PATH}"
export PIP_CONFIG_FILE="${PIP_CONF}"

detect_accelerator() {
  # 优先 NVIDIA（本机 MX250）；其次 AMD ROCm；否则 CPU
  if lspci 2>/dev/null | grep -qiE 'nvidia'; then
    if [ -e /dev/nvidia0 ] || [ -e /dev/nvidiactl ] || lsmod 2>/dev/null | grep -q '^nvidia'; then
      echo cuda
      return 0
    fi
    # 有 NVIDIA 卡但驱动未就绪时仍尝试 CUDA wheel（安装后可能可用）
    echo cuda
    return 0
  fi
  if lspci 2>/dev/null | grep -qiE 'vga.*amd|3d.*amd|display.*amd' \
    || [ -e /dev/kfd ]; then
    echo rocm
    return 0
  fi
  echo cpu
}

deps_ready() {
  command -v python3-dev >/dev/null 2>&1 || return 1
  python3-dev - <<'PY' >/dev/null 2>&1
import importlib
mods = [
    "torch",
    "torchvision",
    "cv2",
    "easyocr",
    "PIL",
    "yaml",
    "numpy",
    "simple_lama_inpainting",
    "PySide6",
]
for m in mods:
    importlib.import_module(m)
PY
}

pip_install() {
  # 统一走 pip3-dev，并带上清华源做普通包回退
  PIP_CONFIG_FILE="${PIP_CONF}" pip3-dev install "$@"
}

install_torch_cuda() {
  echo "==> 检测到 NVIDIA，安装 PyTorch CUDA 版"
  echo "    主源: ${TORCH_CUDA_INDEX}"
  if ! PIP_CONFIG_FILE=/dev/null pip3-dev install --upgrade torch torchvision \
    --index-url "${TORCH_CUDA_INDEX}"; then
    echo "    官方源失败，尝试阿里云镜像: ${TORCH_CUDA_MIRROR}"
    PIP_CONFIG_FILE=/dev/null pip3-dev install --upgrade torch torchvision \
      --index-url "${TORCH_CUDA_MIRROR}" \
      --trusted-host mirrors.aliyun.com \
      --extra-index-url "${PYPI_MIRROR}" \
      --trusted-host pypi.tuna.tsinghua.edu.cn
  fi
}

install_torch_cpu() {
  echo "==> 未检测到可用独显加速，安装 PyTorch CPU 版"
  if ! PIP_CONFIG_FILE=/dev/null pip3-dev install --upgrade torch torchvision \
    --index-url "${TORCH_CPU_INDEX}"; then
    echo "    官方源失败，尝试阿里云镜像: ${TORCH_CPU_MIRROR}"
    PIP_CONFIG_FILE=/dev/null pip3-dev install --upgrade torch torchvision \
      --index-url "${TORCH_CPU_MIRROR}" \
      --trusted-host mirrors.aliyun.com \
      --extra-index-url "${PYPI_MIRROR}" \
      --trusted-host pypi.tuna.tsinghua.edu.cn
  fi
}

install_torch_rocm() {
  echo "==> 检测到 AMD，委托 setup-rocm.sh 安装 PyTorch ROCm 版"
  local rocm_script="${PACKAGING_LINUX}/setup-rocm.sh"
  if [ ! -x "${rocm_script}" ]; then
    chmod +x "${rocm_script}" 2>/dev/null || true
  fi
  if [ -x "${rocm_script}" ]; then
    "${rocm_script}" --pip-only
  else
    echo "警告: 找不到 setup-rocm.sh，回退 CPU 版 torch" >&2
    install_torch_cpu
  fi
}

install_requirements() {
  echo "==> 安装 requirements.txt（含 PySide6）"
  pip_install -r "${REQ_FILE}"
}

verify_runtime() {
  echo "==> 验证运行环境"
  cd "${ROOT}"
  python3-dev - <<'PY'
import sys
sys.path.insert(0, ".")
import torch
from device_utils import accelerator_summary
print("python:", sys.version.split()[0])
print("torch:", torch.__version__)
print("cuda available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
print(accelerator_summary())
import PySide6
print("PySide6:", PySide6.__version__)
PY
}

ensure_python() {
  local bootstrap="${PACKAGING_LINUX}/bootstrap-python.sh"
  if [ ! -x "${bootstrap}" ]; then
    chmod +x "${bootstrap}"
  fi
  # shellcheck disable=SC1090
  bash "${bootstrap}"
  export PATH="${PY_ROOT}/bin:${PATH}"
  if ! command -v python3-dev >/dev/null 2>&1; then
    echo "错误: bootstrap 后仍找不到 python3-dev" >&2
    exit 1
  fi
}

ensure_deps() {
  if deps_ready; then
    echo "==> 依赖已就绪，跳过安装"
    return 0
  fi

  echo "==> 依赖未齐，开始按 GPU 类型安装"
  local accel
  accel="$(detect_accelerator)"
  echo "==> 加速器: ${accel}"

  case "${accel}" in
    cuda) install_torch_cuda ;;
    rocm) install_torch_rocm ;;
    *) install_torch_cpu ;;
  esac

  install_requirements

  if ! deps_ready; then
    echo "错误: 依赖安装后仍无法导入必要模块" >&2
    exit 1
  fi
  verify_runtime
}

main() {
  ensure_python
  ensure_deps
}

main "$@"
