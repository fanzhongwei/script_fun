#!/usr/bin/env bash
# 停掉 cpu/gpu 两个 profile 的容器（含 web），避免漏停抢 9003/9004 的一侧
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
COMPOSE_FILE="${ROOT}/docker/compose.yml"

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
compose -f "${COMPOSE_FILE}" --profile cpu down --remove-orphans || true
compose -f "${COMPOSE_FILE}" --profile gpu down --remove-orphans || true
echo "已停止 OCR API（9003）与页面（9004）"
