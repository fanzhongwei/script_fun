"""图片处理流水线：缩略预览与原图导出。"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from detector import WatermarkDetector, load_patterns, mask_from_rect
from export_profile import ExportProfileKind, save_export_image
from image_utils import load_image_bgr, make_thumbnail, scale_mask_to_original
from inpainter import InpaintEngine, Inpainter
from resources import configure_model_environment

from .models import ImageTask, MaskSource, TaskStatus

SUPPORTED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class ProcessingPipeline:
    def __init__(self) -> None:
        configure_model_environment()
        self.patterns = load_patterns()
        self.detector = WatermarkDetector()
        self.inpainter = Inpainter(engine=InpaintEngine.LAMA)

    @staticmethod
    def list_images(path: Path) -> list[Path]:
        if path.is_file():
            return [path] if path.suffix.lower() in SUPPORTED_SUFFIXES else []
        if not path.is_dir():
            return []
        return sorted(
            p for p in path.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES
        )

    def load_task(self, task: ImageTask, *, retain_original: bool = False) -> None:
        image = load_image_bgr(task.path)
        task.thumb_bgr, task.scale = make_thumbnail(image)
        task.original_bgr = image if retain_original else None

    def process_auto(self, task: ImageTask) -> None:
        if task.thumb_bgr is None:
            self.load_task(task)
        assert task.thumb_bgr is not None

        detection = self.detector.detect_auto(task.thumb_bgr, self.patterns)
        if detection is None:
            task.status = TaskStatus.FAILED
            task.mask_source = MaskSource.NONE
            task.thumb_mask = None
            task.preview_bgr = None
            task.detection_info = "未识别到已知 AI 水印，请手动框选区域"
            return

        task.thumb_mask = detection.mask
        task.mask_source = MaskSource.AUTO
        task.preview_bgr = self.inpainter.inpaint(task.thumb_bgr, task.thumb_mask)
        task.status = TaskStatus.READY
        parts = []
        if detection.matched_keyword:
            parts.append(f"关键词={detection.matched_keyword}")
        if detection.matched_text:
            parts.append(f"OCR={detection.matched_text}")
        task.detection_info = " · ".join(parts) or "自动检测"

    def rerun_auto(self, task: ImageTask) -> None:
        task.manual_rect = None
        self.process_auto(task)

    def process_manual(self, task: ImageTask, rect: tuple[int, int, int, int]) -> None:
        if task.thumb_bgr is None:
            self.load_task(task)
        assert task.thumb_bgr is not None

        task.manual_rect = rect
        task.thumb_mask = mask_from_rect(task.thumb_bgr, rect)
        task.mask_source = MaskSource.MANUAL
        task.preview_bgr = self.inpainter.inpaint(task.thumb_bgr, task.thumb_mask)
        task.status = TaskStatus.MANUAL_PENDING
        x, y, w, h = rect
        task.detection_info = f"手动选区 ({x},{y}) {w}×{h}px"

    def confirm_manual(self, task: ImageTask) -> None:
        if task.status == TaskStatus.MANUAL_PENDING:
            task.status = TaskStatus.CONFIRMED

    def export_task(
        self,
        task: ImageTask,
        output_path: Path,
        profile: ExportProfileKind = ExportProfileKind.ORIGINAL,
    ) -> None:
        if not task.is_exportable():
            raise ValueError(f"图片不可导出: {task.path.name}")
        if task.original_bgr is None:
            task.original_bgr = load_image_bgr(task.path)
        if task.thumb_mask is None:
            raise ValueError(f"缺少 mask: {task.path.name}")

        assert task.original_bgr is not None
        orig_h, orig_w = task.original_bgr.shape[:2]
        full_mask = scale_mask_to_original(task.thumb_mask, (orig_h, orig_w))

        # 在适中分辨率下修复（≤1024），再按电商规格缩放，避免全图 LaMa 卡顿
        work_bgr, _ = make_thumbnail(task.original_bgr, max_side=1024)
        work_h, work_w = work_bgr.shape[:2]
        work_mask = cv2.resize(full_mask, (work_w, work_h), interpolation=cv2.INTER_NEAREST)
        result = self.inpainter.inpaint(work_bgr, work_mask)
        save_export_image(result, output_path, profile)
