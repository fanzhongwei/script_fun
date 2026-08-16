"""GUI 数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

import numpy as np


class TaskStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
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
    manual_rect: tuple[int, int, int, int] | None = None
    detection_info: str = ""
    error: str = ""

    @property
    def name(self) -> str:
        return self.path.name

    def is_exportable(self) -> bool:
        return self.status in (TaskStatus.READY, TaskStatus.CONFIRMED)

    def status_label(self) -> str:
        mapping = {
            TaskStatus.QUEUED: "○ 排队中",
            TaskStatus.PROCESSING: "⏳ 处理中",
            TaskStatus.READY: "● 自动完成",
            TaskStatus.FAILED: "⚠ 待手动",
            TaskStatus.MANUAL_PENDING: "✏ 待确认",
            TaskStatus.CONFIRMED: "✅ 已确认",
        }
        return mapping.get(self.status, self.status.value)
