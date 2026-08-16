#!/usr/bin/env python3
"""AI 图片角落水印检测与去除 CLI。"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2

from detector import DetectionResult, WatermarkDetector, default_patterns_path, load_image_bgr, load_patterns
from inpainter import InpaintEngine, Inpainter, save_preview

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


@dataclass
class ProcessStats:
    success: int = 0
    failed: int = 0
    skipped: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="检测并去除 AI 生成图片角落水印（OCR + LaMa inpainting）"
    )
    parser.add_argument("-i", "--input", required=True, help="输入图片或目录")
    parser.add_argument("-o", "--output", required=True, help="输出文件或目录")
    parser.add_argument("--preview", action="store_true", help="仅输出 mask 预览，不修复")
    parser.add_argument(
        "--region",
        help="手动指定区域：br/bl/tr/tl 或 x1,y1,x2,y2（0~1 比例坐标），跳过 OCR",
    )
    parser.add_argument(
        "--config",
        type=Path,
        help=f"patterns.yaml 路径（默认: {default_patterns_path()}）",
    )
    parser.add_argument(
        "--engine",
        choices=[e.value for e in InpaintEngine],
        default=InpaintEngine.LAMA.value,
        help="修复引擎（默认: lama）",
    )
    parser.add_argument("--force", action="store_true", help="批量模式下覆盖已存在的输出文件")
    return parser.parse_args()


def collect_images(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    if not input_path.is_dir():
        raise ValueError(f"输入路径不存在: {input_path}")

    files = [
        p
        for p in sorted(input_path.iterdir())
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]
    return files


def resolve_output_path(input_file: Path, output: Path, batch: bool) -> Path:
    if batch:
        output.mkdir(parents=True, exist_ok=True)
        return output / input_file.name
    return output


def resolve_preview_paths(input_file: Path, output: Path) -> tuple[Path, Path]:
    if output.suffix:
        parent = output.parent
        stem = input_file.stem
    else:
        parent = output
        stem = input_file.stem
    parent.mkdir(parents=True, exist_ok=True)
    overlay = parent / f"{stem}.mask.png"
    mask = parent / f"{stem}.mask.bin.png"
    return overlay, mask


def detect_watermark(
    detector: WatermarkDetector,
    image,
    patterns,
    region: str | None,
) -> DetectionResult | None:
    if region:
        return detector.detect_manual(image, region, patterns)
    return detector.detect_auto(image, patterns)


def format_detection_info(result: DetectionResult) -> str:
    parts = []
    if result.matched_keyword:
        parts.append(f"关键词={result.matched_keyword!r}")
    if result.matched_corner:
        parts.append(f"角落={result.matched_corner}")
    if result.matched_text:
        parts.append(f"OCR={result.matched_text!r}")
    return ", ".join(parts) if parts else "手动区域"


def process_one(
    input_file: Path,
    output_path: Path,
    detector: WatermarkDetector,
    inpainter: Inpainter | None,
    patterns,
    region: str | None,
    preview: bool,
    force: bool,
    stats: ProcessStats,
) -> None:
    if output_path.exists() and not preview and not force:
        print(f"[跳过] {input_file.name} -> 输出已存在: {output_path}")
        stats.skipped += 1
        return

    try:
        image = load_image_bgr(input_file)
        detection = detect_watermark(detector, image, patterns, region)
        if detection is None:
            print(
                f"[失败] {input_file.name}: 未检测到 AI 水印，"
                f"请尝试 --region br 或 --region x1,y1,x2,y2 手动指定区域"
            )
            stats.failed += 1
            return

        info = format_detection_info(detection)
        if preview:
            overlay_path, mask_path = resolve_preview_paths(input_file, output_path)
            save_preview(image, detection.mask, overlay_path, mask_path)
            print(f"[预览] {input_file.name} ({info})")
            print(f"       叠加: {overlay_path}")
            print(f"       mask: {mask_path}")
            stats.success += 1
            return

        if inpainter is None:
            raise RuntimeError("修复模式下 inpainter 未初始化")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        result = inpainter.inpaint(image, detection.mask)
        cv2.imwrite(str(output_path), result)
        print(f"[成功] {input_file.name} -> {output_path} ({info})")
        stats.success += 1
    except Exception as exc:
        print(f"[失败] {input_file.name}: {exc}")
        stats.failed += 1


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    patterns = load_patterns(args.config)

    try:
        images = collect_images(input_path)
    except ValueError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1

    if not images:
        print("错误: 未找到可处理的图片文件", file=sys.stderr)
        return 1

    batch = input_path.is_dir()
    if not batch and not args.preview and output_path.suffix == "":
        print("错误: 单张修复模式下 -o 必须是文件路径（含扩展名）", file=sys.stderr)
        return 1
    if batch and not args.preview and output_path.suffix:
        print("错误: 批量修复模式下 -o 必须是目录", file=sys.stderr)
        return 1

    detector = WatermarkDetector()
    inpainter = None if args.preview else Inpainter(engine=InpaintEngine(args.engine))
    stats = ProcessStats()

    for image_file in images:
        out = resolve_output_path(image_file, output_path, batch)
        process_one(
            input_file=image_file,
            output_path=out if not args.preview else output_path,
            detector=detector,
            inpainter=inpainter,
            patterns=patterns,
            region=args.region,
            preview=args.preview,
            force=args.force,
            stats=stats,
        )

    print(
        f"\n完成: 成功 {stats.success}, 失败 {stats.failed}, 跳过 {stats.skipped}, "
        f"合计 {len(images)}"
    )
    return 0 if stats.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
