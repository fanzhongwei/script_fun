#!/usr/bin/env bash
# 在 /home/develop/python 安装独立 CPython，并创建 python3-dev / pip3-dev
set -euo pipefail

PY_ROOT="${PY_ROOT:-/home/develop/python}"
CPYTHON_DIR="${PY_ROOT}/cpython"
VENV_DIR="${PY_ROOT}/venvs/python-dev"
CACHE_DIR="${PY_ROOT}/cache"
# astral python-build-standalone（install_only）
PY_VERSION="${PY_VERSION:-3.12.9}"
PY_TAG="${PY_TAG:-20250317}"
TARBALL_NAME="cpython-${PY_VERSION}+${PY_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz"
TARBALL_URL="${TARBALL_URL:-https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}/${TARBALL_NAME}}"

need_bootstrap() {
  [ ! -x "${PY_ROOT}/bin/python3-dev" ] && return 0
  [ ! -x "${VENV_DIR}/bin/python" ] && return 0
  [ ! -x "${CPYTHON_DIR}/bin/python3" ] && return 0
  return 1
}

write_wrappers() {
  mkdir -p "${PY_ROOT}/bin"
  cat > "${PY_ROOT}/bin/python3-dev" <<EOF
#!/usr/bin/env bash
exec "${VENV_DIR}/bin/python" "\$@"
EOF
  cat > "${PY_ROOT}/bin/pip3-dev" <<EOF
#!/usr/bin/env bash
exec "${VENV_DIR}/bin/pip" "\$@"
EOF
  chmod +x "${PY_ROOT}/bin/python3-dev" "${PY_ROOT}/bin/pip3-dev"
}

write_pip_conf() {
  cat > "${PY_ROOT}/pip.conf" <<'EOF'
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn

[install]
trusted-host = pypi.tuna.tsinghua.edu.cn
EOF
  mkdir -p "${HOME}/.pip"
  # 与 README 约定一致：开发机默认走清华源
  cp "${PY_ROOT}/pip.conf" "${HOME}/.pip/pip.conf"
}

download_tarball() {
  mkdir -p "${CACHE_DIR}"
  local dest="${CACHE_DIR}/${TARBALL_NAME}"
  if [ -f "${dest}" ] && [ -s "${dest}" ]; then
    echo "==> 使用缓存: ${dest}"
    echo "${dest}"
    return 0
  fi
  echo "==> 下载独立 Python ${PY_VERSION} ..."
  local mirror="https://mirror.ghproxy.com/${TARBALL_URL}"
  if curl -fL --connect-timeout 20 --max-time 600 -o "${dest}.partial" "${TARBALL_URL}"; then
    mv "${dest}.partial" "${dest}"
  elif curl -fL --connect-timeout 20 --max-time 600 -o "${dest}.partial" "${mirror}"; then
    mv "${dest}.partial" "${dest}"
  else
    rm -f "${dest}.partial"
    echo "错误: 无法下载 ${TARBALL_URL}" >&2
    exit 1
  fi
  echo "${dest}"
}

bootstrap() {
  if ! need_bootstrap; then
    echo "==> python3-dev 已就绪: $("${PY_ROOT}/bin/python3-dev" --version 2>/dev/null || true)"
    return 0
  fi

  echo "==> Bootstrap 独立 Python → ${PY_ROOT}"
  mkdir -p "${PY_ROOT}"
  local tarball
  tarball="$(download_tarball)"

  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/py-bootstrap.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" RETURN
  tar -xzf "${tarball}" -C "${tmp}"

  rm -rf "${CPYTHON_DIR}"
  if [ -d "${tmp}/python" ]; then
    mv "${tmp}/python" "${CPYTHON_DIR}"
  else
    echo "错误: 压缩包结构异常，未找到 python/" >&2
    exit 1
  fi

  "${CPYTHON_DIR}/bin/python3" -m ensurepip --upgrade
  rm -rf "${VENV_DIR}"
  "${CPYTHON_DIR}/bin/python3" -m venv "${VENV_DIR}"

  write_wrappers
  write_pip_conf

  export PATH="${PY_ROOT}/bin:${PATH}"
  export PIP_CONFIG_FILE="${PY_ROOT}/pip.conf"
  pip3-dev install -U pip setuptools wheel

  echo "==> Bootstrap 完成: $(python3-dev --version)"
}

bootstrap "$@"
