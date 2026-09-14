#!/usr/bin/env bash
# 按本机 NVIDIA 选择 cpu/gpu profile，停掉旧容器后重新拉起（不重新构建镜像）
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

if has_nvidia; then
  PROFILE=gpu
  echo "检测到 NVIDIA，重启 GPU 容器"
else
  PROFILE=cpu
  echo "未检测到 NVIDIA，重启 CPU 容器"
fi

cd "${ROOT}"
# 两边都停，避免 cpu/gpu 抢 9003
compose -f "${COMPOSE_FILE}" --profile cpu down --remove-orphans || true
compose -f "${COMPOSE_FILE}" --profile gpu down --remove-orphans || true
compose -f "${COMPOSE_FILE}" --profile "${PROFILE}" up -d --force-recreate --no-build
echo "OCR 服务: http://127.0.0.1:9003/ocr  文档: http://127.0.0.1:9003/docs"
