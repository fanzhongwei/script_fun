#!/usr/bin/env bash
# 配置 AMD GPU（ROCm）加速环境
#
# 用法（推荐，不要用 sudo 跑整个脚本）:
#   cd python/watermark_remover
#   ./packaging/linux/setup-rocm.sh
#
# 若阿里云不可用，可改用官方源:
#   TORCH_ROCM_INDEX=https://download.pytorch.org/whl/rocm6.2 ./packaging/linux/setup-rocm.sh --pip-only
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SCRIPT_PATH")/../.." && pwd)"
cd "$ROOT"

# 绝对路径，避免 sudo 时 PATH 不含 /home/develop/python/bin
PYTHON_DEV="${PYTHON_DEV:-/home/develop/python/bin/python3-dev}"
VENV_PYTHON="${VENV_PYTHON:-/home/develop/python/venvs/python-dev/bin/python}"
PIP_CONF="${PIP_CONF:-/home/develop/python/pip.conf}"
# 国内 PyTorch ROCm wheel 镜像（清华无 rocm 目录，阿里云同步官方 wheel）
TORCH_ROCM_INDEX="${TORCH_ROCM_INDEX:-https://mirrors.aliyun.com/pytorch-wheels/rocm6.2/}"
PYPI_MIRROR="${PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"

resolve_python() {
  if [ -x "$VENV_PYTHON" ]; then
    echo "$VENV_PYTHON"
    return 0
  fi
  if [ -x "$PYTHON_DEV" ]; then
    echo "$PYTHON_DEV"
    return 0
  fi
  if command -v python3-dev >/dev/null 2>&1; then
    command -v python3-dev
    return 0
  fi
  echo "未找到 Python 虚拟环境。" >&2
  echo "请确认存在: $VENV_PYTHON" >&2
  echo "或设置: VENV_PYTHON=/path/to/python $0" >&2
  exit 1
}

gui_python() {
  if [ -x "$PYTHON_DEV" ]; then
    echo "$PYTHON_DEV"
  else
    resolve_python
  fi
}

install_system_rocm() {
  echo "==> 安装系统 ROCm 运行时"
  apt-get update
  apt-get install -y rocm-smi rocminfo libamdhip64-6 rocm-device-libs-21
  echo "若 apt 缺少 libamdhip64-6，请参考 Deepin/AMD 文档手动安装 HIP 运行时"
}

install_pytorch_rocm() {
  local py
  py="$(resolve_python)"
  echo "==> 使用 Python: $py"

  if [ ! -e /dev/kfd ]; then
    echo "错误: /dev/kfd 不存在，内核未启用 ROCm（amdgpu + kfd）" >&2
    exit 1
  fi

  local py_tag cp_tag pip_tmp
  py_tag="$("$py" -c 'import sys; print(f"cp{sys.version_info.major}{sys.version_info.minor}")')"
  cp_tag="${py_tag}-${py_tag}-linux_x86_64"
  pip_tmp="${PIP_TMPDIR:-/home/${USER}/.cache/pip-tmp-rocm}"
  mkdir -p "$pip_tmp"

  local torch_wheel="${TORCH_ROCM_INDEX}torch-2.5.1%2Brocm6.2-${cp_tag}.whl"
  local vision_wheel="${TORCH_ROCM_INDEX}torchvision-0.20.1%2Brocm6.2-${cp_tag}.whl"
  local triton_wheel="https://download.pytorch.org/whl/pytorch_triton_rocm-3.1.0-${cp_tag}.whl"

  echo "==> 安装 PyTorch ROCm 版"
  echo "    torch/torchvision: 阿里云镜像"
  echo "    triton-rocm: PyTorch 官方 CDN（国内镜像未同步）"
  echo "    其他依赖: $PYPI_MIRROR"
  echo "    临时目录: $pip_tmp"

  env PIP_CONFIG_FILE=/dev/null TMPDIR="$pip_tmp" "$py" -m pip install --upgrade --force-reinstall \
    --no-cache-dir --no-deps \
    "$torch_wheel" "$vision_wheel"
  env PIP_CONFIG_FILE=/dev/null TMPDIR="$pip_tmp" "$py" -m pip install --upgrade --force-reinstall \
    --no-cache-dir \
    "$triton_wheel" \
    --extra-index-url "$PYPI_MIRROR" \
    --trusted-host download.pytorch.org \
    --trusted-host pypi.tuna.tsinghua.edu.cn
  env PIP_CONFIG_FILE=/dev/null TMPDIR="$pip_tmp" "$py" -m pip install --no-cache-dir \
    "sympy==1.13.1" filelock typing-extensions networkx jinja2 fsspec numpy pillow \
    --extra-index-url "$PYPI_MIRROR" \
    --trusted-host pypi.tuna.tsinghua.edu.cn

  if ! id -nG "${SUDO_USER:-$USER}" | tr ' ' '\n' | rg -qx 'render'; then
    echo ""
    echo "警告: 当前用户不在 render 组，PyTorch 可能无法访问 GPU。"
    echo "请执行后重新登录:"
    echo "  sudo usermod -aG render,video ${SUDO_USER:-$USER}"
  fi

  echo "==> 验证"
  env HSA_OVERRIDE_GFX_VERSION="${HSA_OVERRIDE_GFX_VERSION:-10.3.0}" "$py" <<PY
import sys
sys.path.insert(0, "$ROOT")
import torch
from device_utils import accelerator_summary
print("torch:", torch.__version__)
print("cuda available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
print(accelerator_summary())
if not torch.cuda.is_available():
    print("提示: 若 rocm-smi 正常但此处为 False，请确认用户在 render 组并重新登录")
PY

  echo ""
  echo "RX 6500 XT 等 gfx1034 显卡需设置（程序已自动处理，也可写入 ~/.bashrc）:"
  echo "  export HSA_OVERRIDE_GFX_VERSION=10.3.0"
  echo ""
  echo "配置完成。开发运行:"
  echo "  cd $ROOT && $(gui_python) gui_entry.py"
  echo ""
  echo "注意: 分发包建议仍用 CPU 版 PyTorch 打包（./packaging/linux/build-release.sh）"
}

run_pip_as_user() {
  local target_user="${1:-}"
  if [ -n "$target_user" ] && [ "$(id -u)" -eq 0 ]; then
    sudo -u "$target_user" \
      env PYTHON_DEV="$PYTHON_DEV" VENV_PYTHON="$VENV_PYTHON" PIP_CONF="$PIP_CONF" \
      TORCH_ROCM_INDEX="$TORCH_ROCM_INDEX" PYPI_MIRROR="$PYPI_MIRROR" \
      HOME="/home/$target_user" \
      "$SCRIPT_PATH" --pip-only
  else
    install_pytorch_rocm
  fi
}

main() {
  case "${1:-}" in
    --pip-only)
      install_pytorch_rocm
      return
      ;;
    --system-only)
      install_system_rocm
      return
      ;;
  esac

  echo "==> 检查 GPU"
  if ! lspci | grep -qi 'vga.*amd\|3d.*amd'; then
    echo "警告: 未检测到 AMD 显卡，继续安装可能无效"
  fi

  if [ "$(id -u)" -eq 0 ]; then
    install_system_rocm
    if [ -n "${SUDO_USER:-}" ]; then
      echo ""
      echo "==> 系统包已装好，切换为用户 $SUDO_USER 安装 PyTorch"
      run_pip_as_user "$SUDO_USER"
    else
      echo ""
      echo "警告: 当前为 root 且无 SUDO_USER，请用普通用户执行:"
      echo "  $SCRIPT_PATH --pip-only"
    fi
    return
  fi

  echo "==> 安装系统 ROCm 运行时（需要 sudo 密码）"
  sudo "$SCRIPT_PATH" --system-only
  echo ""
  install_pytorch_rocm
}

main "$@"
