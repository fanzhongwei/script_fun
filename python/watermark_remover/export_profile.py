"""电商平台导出规格：尺寸、格式与体积控制。"""

from __future__ import annotations

from enum import Enum
from pathlib import Path

import cv2
import numpy as np


class ExportProfileKind(str, Enum):
    CAROUSEL = "carousel"
    DETAIL = "detail"
    SKU = "sku"
    ORIGINAL = "original"


MAX_BYTES = 1_000_000
MIN_SIDE = 480


def profile_label(kind: ExportProfileKind) -> str:
    labels = {
        ExportProfileKind.CAROUSEL: "轮播图 800×800 ≤1MB",
        ExportProfileKind.DETAIL: "详情图 宽750 ≤1MB",
        ExportProfileKind.SKU: "预览图 800×800 ≤1MB",
        ExportProfileKind.ORIGINAL: "原尺寸（仅压缩）",
    }
    return labels[kind]


def _ensure_min_side(image_bgr: np.ndarray, min_side: int = MIN_SIDE) -> np.ndarray:
    h, w = image_bgr.shape[:2]
    shortest = min(h, w)
    if shortest >= min_side:
        return image_bgr
    scale = min_side / shortest
    return cv2.resize(
        image_bgr,
        (int(round(w * scale)), int(round(h * scale))),
        interpolation=cv2.INTER_CUBIC,
    )


def _pad_square_white(image_bgr: np.ndarray, size: int) -> np.ndarray:
    image_bgr = _ensure_min_side(image_bgr)
    h, w = image_bgr.shape[:2]
    side = max(h, w, size, MIN_SIDE)
    canvas = np.full((side, side, 3), 255, dtype=np.uint8)
    y0 = (side - h) // 2
    x0 = (side - w) // 2
    canvas[y0 : y0 + h, x0 : x0 + w] = image_bgr
    if side != size:
        canvas = cv2.resize(canvas, (size, size), interpolation=cv2.INTER_AREA)
    return canvas


def _fit_detail(image_bgr: np.ndarray, target_width: int = 750, max_height: int = 1200) -> np.ndarray:
    image_bgr = _ensure_min_side(image_bgr)
    h, w = image_bgr.shape[:2]
    width = max(MIN_SIDE, min(1200, target_width))
    scale = width / w
    new_h = int(round(h * scale))
    if new_h > max_height:
        scale = max_height / h
        width = max(MIN_SIDE, int(round(w * scale)))
        new_h = max_height
    return cv2.resize(image_bgr, (width, new_h), interpolation=cv2.INTER_AREA)


def apply_export_profile(image_bgr: np.ndarray, kind: ExportProfileKind) -> np.ndarray:
    if kind == ExportProfileKind.CAROUSEL:
        return _pad_square_white(image_bgr, 800)
    if kind == ExportProfileKind.SKU:
        return _pad_square_white(image_bgr, 800)
    if kind == ExportProfileKind.DETAIL:
        return _fit_detail(image_bgr)
    return _ensure_min_side(image_bgr)


def _encode_jpeg(image_bgr: np.ndarray, quality: int) -> bytes:
    ok, buf = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("JPEG 编码失败")
    return buf.tobytes()


def _shrink_until_fit(image_bgr: np.ndarray, max_bytes: int) -> np.ndarray:
    current = image_bgr
    for _ in range(6):
        for quality in range(92, 44, -6):
            if len(_encode_jpeg(current, quality)) <= max_bytes:
                return current
        h, w = current.shape[:2]
        current = cv2.resize(
            current,
            (max(MIN_SIDE, int(w * 0.9)), max(MIN_SIDE, int(h * 0.9))),
            interpolation=cv2.INTER_AREA,
        )
    return current


def save_export_image(
    image_bgr: np.ndarray,
    output_path: Path,
    kind: ExportProfileKind,
    *,
    max_bytes: int = MAX_BYTES,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    processed = apply_export_profile(image_bgr, kind)

    if kind == ExportProfileKind.ORIGINAL and output_path.suffix.lower() in {".png", ".jpg", ".jpeg"}:
        ext = output_path.suffix.lower()
    else:
        ext = ".jpg"
        output_path = output_path.with_suffix(".jpg")

    if ext == ".png":
        ok, buf = cv2.imencode(".png", processed, [cv2.IMWRITE_PNG_COMPRESSION, 6])
        if not ok:
            raise ValueError("PNG 编码失败")
        data = buf.tobytes()
        if len(data) > max_bytes:
            processed = _shrink_until_fit(processed, max_bytes)
            output_path = output_path.with_suffix(".jpg")
            ext = ".jpg"
        else:
            output_path.write_bytes(data)
            return

    processed = _shrink_until_fit(processed, max_bytes)
    quality = 92
    data = _encode_jpeg(processed, quality)
    while len(data) > max_bytes and quality > 40:
        quality -= 6
        data = _encode_jpeg(processed, quality)
    output_path.write_bytes(data)
