#!/usr/bin/env bash
# 检测本机 NVIDIA 后选择 cpu/gpu compose profile 并启动 OCR 服务（端口 9003）
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
COMPOSE_FILE="${ROOT}/docker/compose.yml"

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
  lsmod 2>/dev/null | grep '^nvidia' >/dev/null
}

_nvidia_lspci_ok() {
  lspci 2>/dev/null | grep -iE 'nvidia|10de:' >/dev/null
}

has_nvidia() {
  _nvidia_smi_ok || _nvidia_dev_ok || _nvidia_mod_ok || _nvidia_lspci_ok
}

if has_nvidia; then
  PROFILE=gpu
  echo "检测到 NVIDIA，启动 GPU 容器（需已安装 NVIDIA Container Toolkit）"
else
  PROFILE=cpu
  echo "未检测到 NVIDIA，启动 CPU 容器"
fi

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "需要 Docker Compose v2（docker compose 或 docker-compose）" >&2
    exit 1
  fi
}

cd "${ROOT}"
compose -f "${COMPOSE_FILE}" --profile "${PROFILE}" up -d --build
echo "OCR 服务: http://127.0.0.1:9003/ocr  文档: http://127.0.0.1:9003/docs"
