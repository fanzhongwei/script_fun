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

# CUDA / ROCm wheel 源（TORCH_CUDA_INDEX 有值则不按 Python 版本自动选）
TORCH_CPU_INDEX="${TORCH_CPU_INDEX:-https://download.pytorch.org/whl/cpu}"
TORCH_CPU_MIRROR="${TORCH_CPU_MIRROR:-https://mirrors.aliyun.com/pytorch-wheels/cpu/}"
PYPI_MIRROR="${PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"

export PATH="${PY_ROOT}/bin:${PATH}"
export PIP_CONFIG_FILE="${PIP_CONF}"

_nvidia_smi_ok() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  local out
  out="$(nvidia-smi -L 2>/dev/null || true)"
  [ -n "${out}" ]
}

_nvidia_dev_ok() {
  [ -e /dev/nvidia0 ] || [ -e /dev/nvidiactl ]
}

_nvidia_mod_ok() {
  # 不用 grep -q：提前退出会让 lsmod 收到 SIGPIPE，pipefail 下误判失败
  lsmod 2>/dev/null | grep '^nvidia' >/dev/null
}

_nvidia_lspci_ok() {
  lspci 2>/dev/null | grep -iE 'nvidia|10de:' >/dev/null
}

nvidia_miss_reason() {
  local smi=否 dev=否 mod=否 pci=否
  _nvidia_smi_ok && smi=是
  _nvidia_dev_ok && dev=是
  _nvidia_mod_ok && mod=是
  _nvidia_lspci_ok && pci=是
  echo "未命中 NVIDIA 信号: nvidia-smi=${smi} 设备节点=${dev} lsmod=${mod} lspci=${pci}"
}

detect_accelerator() {
  # 优先 NVIDIA（nvidia-smi / 设备节点 / 模块 / lspci）；其次 AMD ROCm；否则 CPU
  if _nvidia_smi_ok || _nvidia_dev_ok || _nvidia_mod_ok || _nvidia_lspci_ok; then
    echo cuda
    return 0
  fi
  if lspci 2>/dev/null | grep -iE 'vga.*amd|3d.*amd|display.*amd' >/dev/null \
    || [ -e /dev/kfd ]; then
    echo rocm
    return 0
  fi
  echo cpu
}

deps_ready() {
  command -v python3-dev >/dev/null 2>&1 || return 1
  python3-dev - <<'PY' >/dev/null 2>&1 || return 1
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
  local accel
  accel="$(detect_accelerator)"
  if [ "${accel}" = cuda ]; then
    python3-dev - <<'PY' >/dev/null 2>&1 || return 1
import torch
raise SystemExit(0 if torch.version.cuda else 1)
PY
  fi
  return 0
}

pip_install() {
  # 统一走 pip3-dev，并带上清华源做普通包回退
  PIP_CONFIG_FILE="${PIP_CONF}" pip3-dev install "$@"
}

_python_mm() {
  python3-dev -c 'import sys; print("%d.%d" % (sys.version_info.major, sys.version_info.minor))'
}

_python_cp_tag() {
  python3-dev -c 'import sys; print("cp%d%d" % (sys.version_info.major, sys.version_info.minor))'
}

# 同一 CPython 下优先较旧 CUDA，兼顾老卡；3.14 无 cu124 wheel
_cuda_tag_candidates() {
  case "$1" in
    3.14|3.15) echo cu126 cu128 cu130 ;;
    3.13) echo cu126 cu128 cu124 ;;
    *) echo cu124 cu126 cu128 ;;
  esac
}

_index_has_torch_for_cp() {
  local index="$1" cp="$2" arch html
  arch="$(uname -m)"
  html="$(curl -fsSL --connect-timeout 8 --max-time 25 "${index%/}/torch/" 2>/dev/null || true)"
  [ -n "${html}" ] || return 2
  echo "${html}" | grep -E "${cp}-${cp}-[^\"]*${arch}\\.whl" >/dev/null
}

resolve_torch_cuda_urls() {
  if [ -n "${TORCH_CUDA_INDEX:-}" ]; then
    echo "==> 使用指定 CUDA 源: ${TORCH_CUDA_INDEX}"
    return 0
  fi
  local py cp tag official st saw_empty=0 fetch_fail=0
  py="$(_python_mm)"
  cp="$(_python_cp_tag)"
  echo "==> Python ${py}（${cp}），按解释器选择 CUDA wheel"
  for tag in $(_cuda_tag_candidates "${py}"); do
    official="https://download.pytorch.org/whl/${tag}"
    st=0
    _index_has_torch_for_cp "${official}" "${cp}" || st=$?
    if [ "${st}" -eq 0 ]; then
      TORCH_CUDA_INDEX="${official}"
      TORCH_CUDA_MIRROR="${TORCH_CUDA_MIRROR:-https://mirrors.aliyun.com/pytorch-wheels/${tag}/}"
      echo "==> 选用 ${tag}（索引含 ${cp} / $(uname -m) wheel）"
      return 0
    fi
    if [ "${st}" -eq 2 ]; then
      fetch_fail=1
      echo "    ${tag} 索引探测失败"
    else
      saw_empty=1
      echo "    ${tag} 无 ${cp} wheel，换下一个"
    fi
  done
  if [ "${saw_empty}" = 1 ] && [ "${fetch_fail}" = 0 ]; then
    echo "错误: Python ${py} 在候选 CUDA 源中均无对应 torch wheel" >&2
    return 1
  fi
  tag="$(_cuda_tag_candidates "${py}" | awk '{print $1}')"
  TORCH_CUDA_INDEX="https://download.pytorch.org/whl/${tag}"
  TORCH_CUDA_MIRROR="${TORCH_CUDA_MIRROR:-https://mirrors.aliyun.com/pytorch-wheels/${tag}/}"
  echo "==> 无法完整探测索引，回退 ${tag}"
}

install_torch_cuda() {
  resolve_torch_cuda_urls
  echo "==> 检测到 NVIDIA，安装 PyTorch CUDA 版"
  echo "    主源: ${TORCH_CUDA_INDEX}"
  if ! PIP_CONFIG_FILE=/dev/null pip3-dev install --upgrade torch torchvision \
    --index-url "${TORCH_CUDA_INDEX}"; then
    echo "    官方源失败，尝试阿里云镜像: ${TORCH_CUDA_MIRROR}"
    PIP_CONFIG_FILE=/dev/null pip3-dev install --upgrade torch torchvision \
      --index-url "${TORCH_CUDA_MIRROR}" \
      --trusted-host mirrors.aliyun.com
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
  local py
  py="$(python3-dev -c 'import sys; print("%d.%d" % (sys.version_info.major, sys.version_info.minor))')"
  case "${py}" in
    3.13|3.14|3.15)
      # simple-lama-inpainting 声明 numpy<2，会强迫源码编 1.26（3.14 无 wheel，即使有 g++ 也常编不过）
      echo "==> Python ${py}：使用 NumPy 2.x 官方 wheel，lama 以 --no-deps 安装"
      pip_install "numpy>=2.0.0,<3.0.0" --only-binary=numpy
      local tmp_req
      tmp_req="$(mktemp)"
      grep -v '^simple-lama-inpainting' "${REQ_FILE}" > "${tmp_req}"
      pip_install -r "${tmp_req}"
      rm -f "${tmp_req}"
      pip_install "fire>=0.5.0,<0.6.0"
      pip_install "simple-lama-inpainting>=0.1.0,<0.2.0" --no-deps
      ;;
    *)
      pip_install -r "${REQ_FILE}"
      ;;
  esac
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
  if [ "${accel}" = cpu ]; then
    echo "==> $(nvidia_miss_reason)"
  fi

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

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
