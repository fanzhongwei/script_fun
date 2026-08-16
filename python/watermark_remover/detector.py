"""AI 水印检测：角落 ROI + OCR + 关键词匹配。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import re
import threading

import cv2
import numpy as np
import yaml

from image_utils import load_image_bgr as _load_image_bgr_impl

CORNER_ALIASES = {"br", "bl", "tr", "tl"}


@dataclass
class Patterns:
    width_ratio: float
    height_ratio: float
    padding_px: int
    corner_priority: list[str]
    keywords: list[str]
    keyword_patterns: list[re.Pattern[str]]


@dataclass
class DetectionResult:
    mask: np.ndarray
    matched_keyword: str | None = None
    matched_corner: str | None = None
    matched_text: str | None = None


def default_patterns_path() -> Path:
    return Path(__file__).resolve().parent / "patterns.yaml"


def load_patterns(config_path: Path | None = None) -> Patterns:
    path = config_path or default_patterns_path()
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    roi = data.get("roi", {})
    keywords = data.get("keywords", [])
    raw_patterns = data.get("keyword_patterns", [])
    compiled_patterns = [re.compile(p, re.IGNORECASE) for p in raw_patterns]
    return Patterns(
        width_ratio=float(roi.get("width_ratio", 0.25)),
        height_ratio=float(roi.get("height_ratio", 0.15)),
        padding_px=int(roi.get("padding_px", 5)),
        corner_priority=list(data.get("corner_priority", ["br", "bl", "tr", "tl"])),
        keywords=sorted(keywords, key=len, reverse=True),
        keyword_patterns=compiled_patterns,
    )


def _roi_size(image: np.ndarray, patterns: Patterns) -> tuple[int, int]:
    height, width = image.shape[:2]
    roi_w = max(1, int(width * patterns.width_ratio))
    roi_h = max(1, int(height * patterns.height_ratio))
    return roi_w, roi_h


def corner_rect(image: np.ndarray, corner: str, patterns: Patterns) -> tuple[int, int, int, int]:
    height, width = image.shape[:2]
    roi_w, roi_h = _roi_size(image, patterns)
    corner = corner.lower()
    if corner == "br":
        return width - roi_w, height - roi_h, roi_w, roi_h
    if corner == "bl":
        return 0, height - roi_h, roi_w, roi_h
    if corner == "tr":
        return width - roi_w, 0, roi_w, roi_h
    if corner == "tl":
        return 0, 0, roi_w, roi_h
    raise ValueError(f"未知角落标识: {corner}")


def ratio_rect(image: np.ndarray, x1: float, y1: float, x2: float, y2: float) -> tuple[int, int, int, int]:
    height, width = image.shape[:2]
    left = int(min(x1, x2) * width)
    top = int(min(y1, y2) * height)
    right = int(max(x1, x2) * width)
    bottom = int(max(y1, y2) * height)
    left = max(0, min(left, width - 1))
    top = max(0, min(top, height - 1))
    right = max(left + 1, min(right, width))
    bottom = max(top + 1, min(bottom, height))
    return left, top, right - left, bottom - top


def parse_region(region: str, image: np.ndarray, patterns: Patterns) -> tuple[int, int, int, int]:
    region = region.strip().lower()
    if region in CORNER_ALIASES:
        return corner_rect(image, region, patterns)
    parts = [p.strip() for p in region.split(",")]
    if len(parts) != 4:
        raise ValueError(
            f"无效的 --region 值: {region!r}，请使用 br/bl/tr/tl 或 x1,y1,x2,y2（0~1 比例坐标）"
        )
    coords = tuple(float(p) for p in parts)
    for value in coords:
        if value < 0 or value > 1:
            raise ValueError(f"比例坐标必须在 0~1 之间: {region}")
    return ratio_rect(image, *coords)


def mask_from_rect(image: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    x, y, w, h = rect
    mask[y : y + h, x : x + w] = 255
    return mask


def _expand_bbox(
    bbox: list[list[float]],
    offset_x: int,
    offset_y: int,
    image_shape: tuple[int, int],
    padding_px: int,
) -> tuple[int, int, int, int]:
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    x1 = int(min(xs)) + offset_x - padding_px
    y1 = int(min(ys)) + offset_y - padding_px
    x2 = int(max(xs)) + offset_x + padding_px
    y2 = int(max(ys)) + offset_y + padding_px
    height, width = image_shape
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(width, x2)
    y2 = min(height, y2)
    return x1, y1, max(1, x2 - x1), max(1, y2 - y1)


def _match_keyword(text: str, patterns: Patterns) -> str | None:
    normalized = text.replace(" ", "").strip()
    if len(normalized) < 2:
        return None
    for keyword in patterns.keywords:
        key = keyword.replace(" ", "")
        if key in normalized:
            return keyword
        if len(normalized) >= 3 and normalized in key:
            return keyword
    for pattern in patterns.keyword_patterns:
        if pattern.search(normalized):
            return pattern.pattern
    return None


def _corner_score(corner: str) -> int:
    order = {"br": 4, "bl": 3, "tr": 2, "tl": 1}
    return order.get(corner, 0)


def _preprocess_variants(roi: np.ndarray) -> list[tuple[np.ndarray, float]]:
    variants: list[tuple[np.ndarray, float]] = []
    base, base_scale = _preprocess_roi(roi)
    variants.append((base, base_scale))
    h, w = roi.shape[:2]
    upscaled = cv2.resize(roi, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    up, up_scale = _preprocess_roi(upscaled)
    variants.append((up, base_scale * 2.0 * up_scale))
    return variants


_reader_lock = threading.Lock()
_shared_reader: Any | None = None


def _preprocess_roi(roi: np.ndarray) -> tuple[np.ndarray, float]:
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    h, w = enhanced.shape[:2]
    scale = 1.0
    if max(h, w) < 120:
        scale = 120 / max(h, w)
        enhanced = cv2.resize(
            enhanced,
            (int(round(w * scale)), int(round(h * scale))),
            interpolation=cv2.INTER_CUBIC,
        )
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR), scale


def _get_shared_reader() -> Any:
    global _shared_reader
    with _reader_lock:
        if _shared_reader is None:
            import easyocr

            from device_utils import ocr_use_gpu
            from resources import configure_model_environment, get_easyocr_model_dir

            configure_model_environment()
            _shared_reader = easyocr.Reader(
                ["ch_sim", "en"],
                gpu=ocr_use_gpu(),
                verbose=False,
                model_storage_directory=str(get_easyocr_model_dir()),
            )
        return _shared_reader


class WatermarkDetector:
    def _get_reader(self) -> Any:
        return _get_shared_reader()

    def detect_manual(
        self,
        image: np.ndarray,
        region: str,
        patterns: Patterns,
    ) -> DetectionResult:
        rect = parse_region(region, image, patterns)
        return DetectionResult(
            mask=mask_from_rect(image, rect),
            matched_corner=region if region.lower() in CORNER_ALIASES else None,
        )

    def detect_auto(self, image: np.ndarray, patterns: Patterns) -> DetectionResult | None:
        reader = self._get_reader()
        height, width = image.shape[:2]
        best: tuple[int, float, str, list, str, str, str, float] | None = None

        for corner in patterns.corner_priority:
            x, y, w, h = corner_rect(image, corner, patterns)
            roi = image[y : y + h, x : x + w]
            if roi.size == 0:
                continue

            for ocr_input, roi_scale in _preprocess_variants(roi):
                try:
                    with _reader_lock:
                        ocr_results = reader.readtext(ocr_input)
                except Exception:
                    continue

                for bbox, text, confidence in ocr_results:
                    keyword = _match_keyword(text, patterns)
                    if keyword is None:
                        continue
                    score = _corner_score(corner) * 100 + confidence
                    if "豆" in text or "AI" in text.upper() or "生成" in text:
                        score += 50
                    if best is None or score > best[0]:
                        best = (score, confidence, corner, bbox, text, keyword, x, y, roi_scale)

        if best is None:
            return None

        _, _, corner, bbox, text, keyword, x, y, roi_scale = best
        if roi_scale != 1.0:
            inv = 1.0 / roi_scale
            bbox = [[p[0] * inv, p[1] * inv] for p in bbox]
        rect = _expand_bbox(bbox, int(x), int(y), (height, width), patterns.padding_px)
        return DetectionResult(
            mask=mask_from_rect(image, rect),
            matched_keyword=keyword,
            matched_corner=corner,
            matched_text=text,
        )


def load_image_bgr(path: Path) -> np.ndarray:
    try:
        return _load_image_bgr_impl(path)
    except OSError as exc:
        raise ValueError(f"无法读取图片: {path}") from exc
