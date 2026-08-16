"""系统原生文件对话框（Deepin / GTK）。"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import QFileDialog, QWidget


def _native_options() -> QFileDialog.Option:
    # 显式使用系统对话框，避免 Qt 自带英文文件框
    return QFileDialog.Option(0)


def get_open_files(
    parent: QWidget | None,
    title: str,
    directory: str,
    name_filter: str = "Images (*.png *.jpg *.jpeg *.webp)",
) -> list[str]:
    dialog = QFileDialog(parent, title, directory, name_filter)
    dialog.setFileMode(QFileDialog.FileMode.ExistingFiles)
    dialog.setOption(QFileDialog.Option.DontUseNativeDialog, False)
    dialog.setOptions(_native_options())
    if dialog.exec() == QFileDialog.DialogCode.Accepted:
        return dialog.selectedFiles()
    return []


def get_existing_directory(
    parent: QWidget | None,
    title: str,
    directory: str,
) -> str:
    dialog = QFileDialog(parent, title, directory)
    dialog.setFileMode(QFileDialog.FileMode.Directory)
    dialog.setOption(QFileDialog.Option.ShowDirsOnly, True)
    dialog.setOption(QFileDialog.Option.DontUseNativeDialog, False)
    dialog.setOptions(_native_options())
    if dialog.exec() == QFileDialog.DialogCode.Accepted:
        files = dialog.selectedFiles()
        return files[0] if files else ""
    return ""


def get_save_file(
    parent: QWidget | None,
    title: str,
    directory: str,
    name_filter: str = "Images (*.jpg *.jpeg *.png)",
) -> str:
    dialog = QFileDialog(parent, title, directory, name_filter)
    dialog.setAcceptMode(QFileDialog.AcceptMode.AcceptSave)
    dialog.setOption(QFileDialog.Option.DontUseNativeDialog, False)
    dialog.setOptions(_native_options())
    if dialog.exec() == QFileDialog.DialogCode.Accepted:
        files = dialog.selectedFiles()
        return files[0] if files else ""
    return ""
