"""后台处理队列。"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QMutex, QThread, Signal

from export_profile import ExportProfileKind

from .models import ImageTask, TaskStatus
from .pipeline import ProcessingPipeline


class BatchWorker(QThread):
    task_updated = Signal(int)
    queue_progress = Signal(int, int)
    finished_all = Signal()

    def __init__(self, tasks: list[ImageTask], parent=None) -> None:
        super().__init__(parent)
        self.tasks = tasks
        self._pipeline = ProcessingPipeline()
        self._mutex = QMutex()
        self._stop = False

    def stop(self) -> None:
        self._mutex.lock()
        self._stop = True
        self._mutex.unlock()

    def run(self) -> None:
        total = len(self.tasks)
        done = 0
        for index, task in enumerate(self.tasks):
            self._mutex.lock()
            stopped = self._stop
            self._mutex.unlock()
            if stopped:
                break

            task.status = TaskStatus.PROCESSING
            self.task_updated.emit(index)

            try:
                self._pipeline.load_task(task, retain_original=False)
                self._pipeline.process_auto(task)
            except Exception as exc:
                task.status = TaskStatus.FAILED
                task.error = str(exc)
                task.detection_info = f"处理失败: {exc}"

            done += 1
            self.queue_progress.emit(done, total)
            self.task_updated.emit(index)

        self.finished_all.emit()


class ManualWorker(QThread):
    task_updated = Signal(int)
    failed = Signal(int, str)

    def __init__(
        self,
        index: int,
        task: ImageTask,
        rect: tuple[int, int, int, int] | None = None,
        rerun_auto: bool = False,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self.index = index
        self.task = task
        self.rect = rect
        self.rerun_auto = rerun_auto
        self._pipeline = ProcessingPipeline()

    def run(self) -> None:
        try:
            if self.task.thumb_bgr is None:
                self._pipeline.load_task(self.task, retain_original=False)
            if self.rerun_auto:
                self._pipeline.rerun_auto(self.task)
            elif self.rect is not None:
                self._pipeline.process_manual(self.task, self.rect)
            self.task_updated.emit(self.index)
        except Exception as exc:
            self.task.error = str(exc)
            self.failed.emit(self.index, str(exc))


class ExportWorker(QThread):
    progress = Signal(int, int, str)
    finished_ok = Signal(int, list)
    failed = Signal(str)

    def __init__(
        self,
        tasks: list[tuple[ImageTask, Path]],
        pipeline: ProcessingPipeline,
        profile: ExportProfileKind = ExportProfileKind.ORIGINAL,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self.tasks = tasks
        self.pipeline = pipeline
        self.profile = profile

    def run(self) -> None:
        total = len(self.tasks)
        errors: list[str] = []
        success = 0
        for index, (task, output_path) in enumerate(self.tasks, start=1):
            try:
                self.pipeline.export_task(task, output_path, self.profile)
                success += 1
            except Exception as exc:
                errors.append(f"{task.name}: {exc}")
            self.progress.emit(index, total, task.name)
        self.finished_ok.emit(success, errors)
