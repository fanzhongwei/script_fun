"""缩略图、图片读取与 mask 坐标映射。"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps


class RegionKind(str, Enum):
    RECT = "rect"
    ELLIPSE = "ellipse"
    POLYGON = "polygon"
    LASSO = "lasso"


@dataclass
class Region:
    kind: RegionKind
    x: int = 0
    y: int = 0
    w: int = 0
    h: int = 0
    points: list[tuple[int, int]] = field(default_factory=list)


def load_image_bgr(path: Path) -> np.ndarray:
    """读取图片并应用 EXIF 方向，避免 JPG 水印角落错位。"""
    with Image.open(path) as pil:
        pil = ImageOps.exif_transpose(pil)
        rgb = np.array(pil.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

THUMB_MAX_SIDE = 1024


def compute_scale(width: int, height: int, max_side: int = THUMB_MAX_SIDE) -> float:
    longest = max(width, height)
    if longest <= max_side:
        return 1.0
    return max_side / longest


def make_thumbnail(image_bgr: np.ndarray, max_side: int = THUMB_MAX_SIDE) -> tuple[np.ndarray, float]:
    height, width = image_bgr.shape[:2]
    scale = compute_scale(width, height, max_side)
    if scale >= 1.0:
        return image_bgr.copy(), 1.0
    thumb = cv2.resize(
        image_bgr,
        (int(round(width * scale)), int(round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )
    return thumb, scale


def scale_rect_to_original(rect: tuple[int, int, int, int], scale: float) -> tuple[int, int, int, int]:
    if scale >= 1.0:
        return rect
    x, y, w, h = rect
    inv = 1.0 / scale
    return (
        int(round(x * inv)),
        int(round(y * inv)),
        max(1, int(round(w * inv))),
        max(1, int(round(h * inv))),
    )


def scale_mask_to_original(thumb_mask: np.ndarray, original_shape: tuple[int, int]) -> np.ndarray:
    orig_h, orig_w = original_shape
    if thumb_mask.shape[0] == orig_h and thumb_mask.shape[1] == orig_w:
        return thumb_mask
    return cv2.resize(thumb_mask, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)


def _clip_rect(x: int, y: int, w: int, h: int, width: int, height: int) -> tuple[int, int, int, int] | None:
    x2 = min(width, x + w)
    y2 = min(height, y + h)
    x = max(0, x)
    y = max(0, y)
    w = x2 - x
    h = y2 - y
    if w <= 0 or h <= 0:
        return None
    return x, y, w, h


def mask_from_regions(image: np.ndarray, regions: list[Region]) -> np.ndarray:
    height, width = image.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    for region in regions:
        if region.kind in (RegionKind.RECT, RegionKind.ELLIPSE):
            clipped = _clip_rect(region.x, region.y, region.w, region.h, width, height)
            if clipped is None:
                continue
            x, y, w, h = clipped
            if region.kind == RegionKind.RECT:
                cv2.rectangle(mask, (x, y), (x + w, y + h), 255, thickness=-1)
            else:
                cx = x + w // 2
                cy = y + h // 2
                ax = max(1, w // 2)
                ay = max(1, h // 2)
                cv2.ellipse(mask, (cx, cy), (ax, ay), 0, 0, 360, 255, thickness=-1)
            continue

        if len(region.points) < 3:
            continue
        pts = np.array(
            [(max(0, min(width - 1, px)), max(0, min(height - 1, py))) for px, py in region.points],
            dtype=np.int32,
        )
        cv2.fillPoly(mask, [pts], 255)
    return mask
