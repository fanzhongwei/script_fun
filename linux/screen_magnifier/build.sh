#!/bin/bash
# 一键构建放大镜。无参数。
set -eu
cd "$(dirname "$0")"

if ! command -v gcc >/dev/null 2>&1; then
  echo "缺少 gcc。请先安装构建工具，例如: sudo apt-get install build-essential" >&2
  exit 1
fi

if ! command -v make >/dev/null 2>&1; then
  echo "缺少 make。请先安装构建工具，例如: sudo apt-get install build-essential" >&2
  exit 1
fi

ft_cflags=""
if pkg-config --exists xft 2>/dev/null; then
  ft_cflags="$(pkg-config --cflags xft)"
elif [ -f /usr/include/freetype2/ft2build.h ]; then
  ft_cflags="-I/usr/include/freetype2"
fi
xft_libs="-lXft -lfontconfig -lfreetype -lXrender -lXcomposite -lX11"

headers="X11/Xlib.h X11/extensions/XShm.h X11/extensions/shape.h X11/extensions/Xfixes.h X11/extensions/Xrandr.h X11/extensions/Xcomposite.h X11/Xft/Xft.h"
for header in $headers; do
  # shellcheck disable=SC2086
  if ! echo "#include <${header}>" | gcc -E $ft_cflags - >/dev/null 2>&1; then
    echo "缺少头文件 ${header}。请安装 X11 开发库，例如: sudo apt-get install libx11-dev libxext-dev libxfixes-dev libxrandr-dev libxcomposite-dev libxft-dev libfreetype6-dev" >&2
    exit 1
  fi
done

link_tmp="$(mktemp)"
# shellcheck disable=SC2086
if ! echo "int main(void){return 0;}" | gcc -x c $ft_cflags - -o "$link_tmp" $xft_libs -lXext -lXfixes -lXrandr >/dev/null 2>&1; then
  rm -f "$link_tmp"
  echo "缺少 X11 链接库。请安装: sudo apt-get install libx11-dev libxext-dev libxfixes-dev libxrandr-dev libxcomposite-dev libxft-dev libfreetype6-dev" >&2
  exit 1
fi
rm -f "$link_tmp"

make
echo "构建完成: $(pwd)/magnifier"
