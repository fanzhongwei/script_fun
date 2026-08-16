"""GUI 应用入口。"""

from __future__ import annotations

import os
import sys


def _configure_qt_platform() -> None:
    # Deepin 原生对话框与主题；须在 QApplication 创建前设置
    os.environ.setdefault("QT_QPA_PLATFORMTHEME", "deepin")
    # 避免 opencv 携带的 Qt 插件路径干扰系统主题
    plugin_path = os.environ.get("QT_PLUGIN_PATH", "")
    if "cv2" in plugin_path:
        os.environ.pop("QT_PLUGIN_PATH", None)


_configure_qt_platform()

from PySide6.QtWidgets import QApplication

from .main_window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("WatermarkRemover")
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
