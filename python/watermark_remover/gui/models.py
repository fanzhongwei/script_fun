"""GUI 数据模型。"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

import numpy as np

from image_utils import Region


class TaskStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    NEED_MASK = "need_mask"
    READY = "ready"
    FAILED = "failed"
    MANUAL_PENDING = "manual_pending"
    CONFIRMED = "confirmed"


class MaskSource(str, Enum):
    NONE = "none"
    AUTO = "auto"
    MANUAL = "manual"


@dataclass
class ImageTask:
    path: Path
    status: TaskStatus = TaskStatus.QUEUED
    mask_source: MaskSource = MaskSource.NONE
    scale: float = 1.0
    original_bgr: np.ndarray | None = None
    thumb_bgr: np.ndarray | None = None
    thumb_mask: np.ndarray | None = None
    preview_bgr: np.ndarray | None = None
    regions: list[Region] = field(default_factory=list)
    detection_info: str = ""
    error: str = ""
    _undo: list[list[Region]] = field(default_factory=list)
    _redo: list[list[Region]] = field(default_factory=list)

    @property
    def name(self) -> str:
        return self.path.name

    def is_exportable(self) -> bool:
        return self.status == TaskStatus.CONFIRMED

    def has_regions(self) -> bool:
        return bool(self.regions)

    def can_undo(self) -> bool:
        return bool(self._undo)

    def can_redo(self) -> bool:
        return bool(self._redo)

    def status_label(self) -> str:
        if self.status == TaskStatus.QUEUED:
            return "○ 排队中"
        if self.status == TaskStatus.PROCESSING:
            return "⏳ 加载缩略图"
        if self.status == TaskStatus.FAILED:
            return "⚠ 加载失败"
        if self.status == TaskStatus.CONFIRMED:
            return "✅ 已确认"
        if self.status == TaskStatus.MANUAL_PENDING:
            return "✏ 待确认"
        if self.regions:
            return "○ 待预览"
        return "○ 待选区"

    def invalidate_preview(self) -> None:
        self.preview_bgr = None
        self.thumb_mask = None
        if self.status in (TaskStatus.MANUAL_PENDING, TaskStatus.CONFIRMED, TaskStatus.NEED_MASK):
            self.status = TaskStatus.NEED_MASK
        self.mask_source = MaskSource.MANUAL if self.regions else MaskSource.NONE

    def apply_regions(self, new_regions: list[Region]) -> None:
        self._undo.append(deepcopy(self.regions))
        self._redo.clear()
        self.regions = deepcopy(new_regions)
        self.invalidate_preview()

    def add_region(self, region: Region) -> None:
        self.apply_regions([*self.regions, region])

    def clear_regions(self) -> bool:
        if not self.regions:
            return False
        self.apply_regions([])
        return True

    def undo_regions(self) -> bool:
        if not self._undo:
            return False
        self._redo.append(deepcopy(self.regions))
        self.regions = self._undo.pop()
        self.invalidate_preview()
        return True

    def redo_regions(self) -> bool:
        if not self._redo:
            return False
        self._undo.append(deepcopy(self.regions))
        self.regions = self._redo.pop()
        self.invalidate_preview()
        return True
