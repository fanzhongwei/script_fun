"""主窗口。"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PySide6.QtCore import Qt
from PySide6.QtGui import QImage, QKeySequence, QPixmap, QShortcut, QShowEvent
from PySide6.QtWidgets import (
    QButtonGroup,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QProgressDialog,
    QPushButton,
    QSplitter,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)

from device_utils import accelerator_summary
from export_profile import ExportProfileKind, profile_label
from image_utils import Region, RegionKind

from .file_dialog import get_existing_directory, get_open_files, get_save_file
from .image_canvas import ImageCanvas
from .models import ImageTask, TaskStatus
from .pipeline import ProcessingPipeline
from .worker import BatchWorker, ExportWorker, ManualWorker


def _bgr_to_pixmap(image_bgr: np.ndarray | None, max_side: int = 512) -> QPixmap:
    if image_bgr is None:
        return QPixmap()
    h, w = image_bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        image_bgr = cv2.resize(
            image_bgr,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA,
        )
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    ih, iw, ch = rgb.shape
    qimage = QImage(rgb.data, iw, ih, ch * iw, QImage.Format.Format_RGB888).copy()
    return QPixmap.fromImage(qimage)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("AI 图片水印去除")
        self.resize(1200, 720)

        self.tasks: list[ImageTask] = []
        self.current_index: int | None = None
        self.batch_worker: BatchWorker | None = None
        self.manual_worker: ManualWorker | None = None
        self.export_worker: ExportWorker | None = None
        self.export_pipeline = ProcessingPipeline()
        self._preview_busy_text: str | None = None
        self._last_open_dir = str(Path.home())
        self._canvas_key: tuple | None = None

        self._build_ui()
        self._wire_signals()
        self._refresh_actions()
        self.statusBar().showMessage(f"就绪 · {accelerator_summary()}")

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QHBoxLayout(root)

        left = QVBoxLayout()
        btn_row = QHBoxLayout()
        self.btn_open_files = QPushButton("选择文件")
        self.btn_open_dir = QPushButton("选择文件夹")
        btn_row.addWidget(self.btn_open_files)
        btn_row.addWidget(self.btn_open_dir)
        left.addLayout(btn_row)

        self.list_widget = QListWidget()
        self.list_widget.setWordWrap(True)
        self.list_widget.setUniformItemSizes(False)
        left.addWidget(self.list_widget, stretch=1)

        right = QVBoxLayout()
        shape_row = QHBoxLayout()
        shape_row.addWidget(QLabel("选区:"))
        self.tool_group = QButtonGroup(self)
        self.btn_tool_rect = QPushButton("矩形")
        self.btn_tool_ellipse = QPushButton("椭圆")
        self.btn_tool_polygon = QPushButton("多边形")
        self.btn_tool_lasso = QPushButton("套索")
        for i, btn in enumerate(
            (self.btn_tool_rect, self.btn_tool_ellipse, self.btn_tool_polygon, self.btn_tool_lasso)
        ):
            btn.setCheckable(True)
            self.tool_group.addButton(btn, i)
            shape_row.addWidget(btn)
        self.btn_tool_rect.setChecked(True)
        shape_row.addStretch(1)
        right.addLayout(shape_row)

        tool_row = QHBoxLayout()
        self.btn_preview = QPushButton("生成预览")
        self.btn_undo = QPushButton("撤销")
        self.btn_redo = QPushButton("恢复")
        self.btn_clear = QPushButton("清除全部")
        self.btn_confirm = QPushButton("确认")
        tool_row.addWidget(self.btn_preview)
        tool_row.addWidget(self.btn_undo)
        tool_row.addWidget(self.btn_redo)
        tool_row.addWidget(self.btn_clear)
        tool_row.addWidget(self.btn_confirm)
        right.addLayout(tool_row)

        self.info_label = QLabel("请选择图片或文件夹")
        self.info_label.setWordWrap(True)
        right.addWidget(self.info_label)

        self.preview_split = QSplitter(Qt.Orientation.Horizontal)
        self.canvas = ImageCanvas()
        self.canvas.setMinimumWidth(320)
        self.preview_label = QLabel("修复预览")
        self.preview_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview_label.setMinimumWidth(320)
        self.preview_label.setStyleSheet("background:#222; color:#ccc;")
        self.preview_split.addWidget(self.canvas)
        self.preview_split.addWidget(self.preview_label)
        self.preview_split.setStretchFactor(0, 1)
        self.preview_split.setStretchFactor(1, 1)
        right.addWidget(self.preview_split, stretch=1)

        export_opts = QHBoxLayout()
        export_opts.addWidget(QLabel("导出规格:"))
        self.export_profile_combo = QComboBox()
        for kind in ExportProfileKind:
            self.export_profile_combo.addItem(profile_label(kind), kind)
        original_index = self.export_profile_combo.findData(ExportProfileKind.ORIGINAL)
        if original_index >= 0:
            self.export_profile_combo.setCurrentIndex(original_index)
        export_opts.addWidget(self.export_profile_combo, stretch=1)
        right.addLayout(export_opts)

        export_row = QHBoxLayout()
        self.btn_export_one = QPushButton("导出当前")
        self.btn_export_all = QPushButton("导出全部")
        export_row.addWidget(self.btn_export_one)
        export_row.addWidget(self.btn_export_all)
        right.addLayout(export_row)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        left_widget = QWidget()
        left_widget.setLayout(left)
        right_widget = QWidget()
        right_widget.setLayout(right)
        splitter.addWidget(left_widget)
        splitter.addWidget(right_widget)
        splitter.setStretchFactor(1, 1)
        layout.addWidget(splitter)

        self.setStatusBar(QStatusBar())

    def showEvent(self, event: QShowEvent) -> None:
        super().showEvent(event)
        width = self.preview_split.width()
        if width > 0:
            half = width // 2
            self.preview_split.setSizes([half, half])

    def _wire_signals(self) -> None:
        self.btn_open_files.clicked.connect(self._open_files)
        self.btn_open_dir.clicked.connect(self._open_dir)
        self.list_widget.currentRowChanged.connect(self._on_row_changed)
        self.btn_preview.clicked.connect(self._generate_manual_preview)
        self.btn_undo.clicked.connect(self._undo_regions)
        self.btn_redo.clicked.connect(self._redo_regions)
        self.btn_clear.clicked.connect(self._clear_selection)
        self.btn_confirm.clicked.connect(self._confirm_manual)
        self.btn_export_one.clicked.connect(self._export_current)
        self.btn_export_all.clicked.connect(self._export_all)
        self.canvas.region_committed.connect(self._on_region_committed)
        self.tool_group.buttonClicked.connect(self._on_tool_button)

        undo = QShortcut(QKeySequence.StandardKey.Undo, self)
        undo.setContext(Qt.ShortcutContext.WindowShortcut)
        undo.activated.connect(self._undo_regions)
        redo_y = QShortcut(QKeySequence("Ctrl+Y"), self)
        redo_y.setContext(Qt.ShortcutContext.WindowShortcut)
        redo_y.activated.connect(self._redo_regions)
        redo_shift = QShortcut(QKeySequence("Ctrl+Shift+Z"), self)
        redo_shift.setContext(Qt.ShortcutContext.WindowShortcut)
        redo_shift.activated.connect(self._redo_regions)

    def _on_tool_button(self, button: QPushButton) -> None:
        mapping = {
            self.btn_tool_rect: RegionKind.RECT,
            self.btn_tool_ellipse: RegionKind.ELLIPSE,
            self.btn_tool_polygon: RegionKind.POLYGON,
            self.btn_tool_lasso: RegionKind.LASSO,
        }
        self.canvas.set_tool(mapping.get(button, RegionKind.RECT))

    def _task_list_label(self, task: ImageTask) -> str:
        return f"{task.name}  {task.status_label()}"

    def _open_files(self) -> None:
        paths = get_open_files(
            self,
            "选择图片",
            self._last_open_dir,
            "Images (*.png *.jpg *.jpeg *.webp)",
        )
        if paths:
            self._last_open_dir = str(Path(paths[0]).parent)
            self._load_tasks([Path(p) for p in paths])

    def _open_dir(self) -> None:
        directory = get_existing_directory(self, "选择文件夹", self._last_open_dir)
        if directory:
            self._last_open_dir = directory
            paths = ProcessingPipeline.list_images(Path(directory))
            if not paths:
                QMessageBox.warning(self, "提示", "文件夹中没有支持的图片")
                return
            self._load_tasks(paths)

    def _load_tasks(self, paths: list[Path]) -> None:
        if self.batch_worker and self.batch_worker.isRunning():
            self.batch_worker.stop()
            self.batch_worker.wait(3000)

        self.tasks = [ImageTask(path=p) for p in paths]
        self._canvas_key = None
        self.list_widget.clear()
        for task in self.tasks:
            self.list_widget.addItem(QListWidgetItem(self._task_list_label(task)))
        if self.tasks:
            self.list_widget.setCurrentRow(0)

        self.batch_worker = BatchWorker(self.tasks, self)
        self.batch_worker.task_updated.connect(self._on_task_updated)
        self.batch_worker.queue_progress.connect(self._on_queue_progress)
        self.batch_worker.finished_all.connect(self._on_batch_finished)
        self.batch_worker.start()
        self.statusBar().showMessage(f"已加入 {len(self.tasks)} 张，正在加载缩略图…")

    def _on_queue_progress(self, done: int, total: int) -> None:
        self.statusBar().showMessage(f"缩略图 {done}/{total}")

    def _on_batch_finished(self) -> None:
        for index, task in enumerate(self.tasks):
            item = self.list_widget.item(index)
            if item is not None:
                item.setText(self._task_list_label(task))
        self.statusBar().showMessage(f"缩略图已加载 · {accelerator_summary()}")
        self._refresh_actions()

    def _on_task_updated(self, index: int) -> None:
        if 0 <= index < len(self.tasks):
            item = self.list_widget.item(index)
            if item is not None:
                item.setText(self._task_list_label(self.tasks[index]))
        if index == self.current_index:
            self._render_current()

    def _on_row_changed(self, row: int) -> None:
        if row < 0:
            self.current_index = None
            return
        self.canvas.cancel_in_progress()
        self.current_index = row
        self._canvas_key = None
        self._render_current()

    def _current_task(self) -> ImageTask | None:
        if self.current_index is None or self.current_index >= len(self.tasks):
            return None
        return self.tasks[self.current_index]

    def _set_preview_message(self, text: str) -> None:
        self.preview_label.setPixmap(QPixmap())
        self.preview_label.setText(text)

    def _sync_canvas(self, task: ImageTask) -> None:
        key = (str(task.path), id(task.thumb_bgr) if task.thumb_bgr is not None else 0)
        if key != self._canvas_key:
            self._canvas_key = key
            self.canvas.set_image_bgr(task.thumb_bgr)
        self.canvas.set_regions(task.regions)

    def _render_current(self) -> None:
        task = self._current_task()
        if task is None:
            return

        self._update_list_item(task)
        self.info_label.setText(task.detection_info or task.error or "请框选水印区域")
        self._sync_canvas(task)

        if self._preview_busy_text:
            self._set_preview_message(self._preview_busy_text)
            self._refresh_actions()
            return

        if task.status in (TaskStatus.QUEUED, TaskStatus.PROCESSING):
            hint = "排队加载…" if task.status == TaskStatus.QUEUED else "正在加载缩略图…"
            self._set_preview_message(hint)
            self._refresh_actions()
            return

        if task.preview_bgr is not None and task.status in (
            TaskStatus.MANUAL_PENDING,
            TaskStatus.CONFIRMED,
        ):
            self.preview_label.setPixmap(_bgr_to_pixmap(task.preview_bgr))
            self.preview_label.setText("")
        elif task.status == TaskStatus.FAILED:
            self._set_preview_message("图片加载失败")
        else:
            self._set_preview_message("尚未生成预览\n请框选后点击「生成预览」")

        self._refresh_actions()

    def _update_list_item(self, task: ImageTask) -> None:
        if self.current_index is None:
            return
        item = self.list_widget.item(self.current_index)
        if item is not None:
            item.setText(self._task_list_label(task))

    def _is_busy(self) -> bool:
        return any(
            worker is not None and worker.isRunning()
            for worker in (self.batch_worker, self.manual_worker, self.export_worker)
        )

    def _refresh_actions(self) -> None:
        task = self._current_task()
        busy = self._is_busy()
        has_task = task is not None
        loaded = has_task and task.status not in (TaskStatus.QUEUED, TaskStatus.PROCESSING)
        self.btn_preview.setEnabled(loaded and task.has_regions() and not busy)
        self.btn_clear.setEnabled(loaded and task.has_regions() and not busy)
        self.btn_undo.setEnabled(loaded and not busy)
        self.btn_redo.setEnabled(has_task and task.can_redo() and not busy)
        pending = has_task and task.status == TaskStatus.MANUAL_PENDING and task.preview_bgr is not None
        self.btn_confirm.setEnabled(pending and not busy)
        self.btn_confirm.setVisible(pending)
        self.btn_export_one.setEnabled(has_task and task.is_exportable() and not busy)
        exportable = sum(1 for t in self.tasks if t.is_exportable())
        self.btn_export_all.setEnabled(exportable > 0 and not busy)
        for btn in (
            self.btn_tool_rect,
            self.btn_tool_ellipse,
            self.btn_tool_polygon,
            self.btn_tool_lasso,
        ):
            btn.setEnabled(loaded and not busy)

    def _on_region_committed(self, region: Region) -> None:
        task = self._current_task()
        if task is None or self._is_busy():
            return
        if task.status in (TaskStatus.QUEUED, TaskStatus.PROCESSING, TaskStatus.FAILED):
            return
        task.add_region(region)
        task.detection_info = f"已选 {len(task.regions)} 块，点击「生成预览」"
        self._sync_canvas(task)
        self._render_current()

    def _undo_regions(self) -> None:
        if self._is_busy():
            return
        if self.canvas.undo_in_progress():
            return
        task = self._current_task()
        if task is None:
            return
        if not task.undo_regions():
            return
        task.detection_info = f"已选 {len(task.regions)} 块" if task.regions else "请框选水印区域"
        self._sync_canvas(task)
        self._render_current()

    def _redo_regions(self) -> None:
        if self._is_busy():
            return
        task = self._current_task()
        if task is None or not task.redo_regions():
            return
        task.detection_info = f"已选 {len(task.regions)} 块" if task.regions else "请框选水印区域"
        self._sync_canvas(task)
        self._render_current()

    def _generate_manual_preview(self) -> None:
        task = self._current_task()
        if task is None or self.current_index is None:
            return
        if not task.has_regions():
            QMessageBox.information(self, "提示", "请先在原图上框选至少一个区域")
            return
        self._preview_busy_text = "正在生成预览…"
        self._render_current()
        self.manual_worker = ManualWorker(self.current_index, task, parent=self)
        self.manual_worker.task_updated.connect(self._on_manual_finished)
        self.manual_worker.failed.connect(self._on_manual_failed)
        self.manual_worker.start()
        self._refresh_actions()

    def _on_manual_finished(self, index: int) -> None:
        self._preview_busy_text = None
        if index == self.current_index:
            self._render_current()
        else:
            self._refresh_actions()
            if 0 <= index < len(self.tasks):
                item = self.list_widget.item(index)
                if item is not None:
                    item.setText(self._task_list_label(self.tasks[index]))

    def _on_manual_failed(self, index: int, message: str) -> None:
        self._preview_busy_text = None
        QMessageBox.warning(self, "处理失败", message)
        if index == self.current_index:
            self._render_current()
        self._refresh_actions()

    def _clear_selection(self) -> None:
        task = self._current_task()
        if task is None:
            return
        self.canvas.cancel_in_progress()
        if not task.clear_regions():
            return
        task.detection_info = "请框选水印区域"
        self._sync_canvas(task)
        self._render_current()

    def _confirm_manual(self) -> None:
        task = self._current_task()
        if task is None:
            return
        if task.status != TaskStatus.MANUAL_PENDING or task.preview_bgr is None:
            return
        self.export_pipeline.confirm_manual(task)
        self._update_list_item(task)
        self._refresh_actions()

    def _current_export_profile(self) -> ExportProfileKind:
        return self.export_profile_combo.currentData()

    def _start_export(self, items: list[tuple[ImageTask, Path]], title: str) -> None:
        if not items:
            return
        if self.export_worker and self.export_worker.isRunning():
            QMessageBox.information(self, "提示", "正在导出，请稍候")
            return

        progress = QProgressDialog(title, "取消", 0, len(items), self)
        progress.setWindowTitle("导出进度")
        progress.setWindowModality(Qt.WindowModality.WindowModal)
        progress.setMinimumDuration(0)
        progress.setValue(0)

        self.export_worker = ExportWorker(
            items, self.export_pipeline, self._current_export_profile(), self
        )

        def on_progress(done: int, total: int, name: str) -> None:
            progress.setMaximum(total)
            progress.setValue(done)
            progress.setLabelText(f"导出进度 {done}/{total}\n{name}")

        def on_finished(success: int, errors: list[str]) -> None:
            progress.setValue(len(items))
            progress.close()
            msg = f"成功导出 {success} 张"
            if errors:
                msg += "\n失败:\n" + "\n".join(errors)
            QMessageBox.information(self, "导出完成", msg)
            self._refresh_actions()

        def on_cancel() -> None:
            if self.export_worker and self.export_worker.isRunning():
                self.export_worker.terminate()
                self.export_worker.wait(2000)

        progress.canceled.connect(on_cancel)
        self.export_worker.progress.connect(on_progress)
        self.export_worker.finished_ok.connect(on_finished)
        self.export_worker.start()
        self._refresh_actions()

    def _export_current(self) -> None:
        task = self._current_task()
        if task is None or not task.is_exportable():
            return
        profile = self._current_export_profile()
        default_name = task.path.stem + (".jpg" if profile != ExportProfileKind.ORIGINAL else task.path.suffix)
        path = get_save_file(
            self,
            "导出当前",
            str(task.path.with_name(f"clean_{default_name}")),
            "Images (*.jpg *.jpeg *.png)",
        )
        if not path:
            return
        self._start_export([(task, Path(path))], "正在导出当前图片…")

    def _export_all(self) -> None:
        exportable = [t for t in self.tasks if t.is_exportable()]
        skipped = len(self.tasks) - len(exportable)
        if not exportable:
            QMessageBox.information(self, "提示", "没有可导出的图片")
            return
        directory = get_existing_directory(self, "选择导出文件夹", self._last_open_dir)
        if not directory:
            return
        self._last_open_dir = directory
        out_dir = Path(directory)
        profile = self._current_export_profile()
        ext = ".jpg" if profile != ExportProfileKind.ORIGINAL else None
        items = [
            (task, out_dir / (task.path.stem + (ext or task.path.suffix)))
            for task in exportable
        ]
        title = f"正在导出 {len(items)} 张"
        if skipped:
            title += f"（跳过 {skipped} 张未确认）"
        self._start_export(items, title)
