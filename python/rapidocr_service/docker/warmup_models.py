#!/usr/bin/env python3
"""构建期用默认 CPU 配置拉取 det/cls/rec 模型，不依赖 CUDA。"""
from pathlib import Path

import rapidocr
from rapidocr import RapidOCR

RapidOCR()
models = Path(rapidocr.__file__).resolve().parent / "models"
onnx = sorted(models.glob("*.onnx"))
if len(onnx) < 3:
    raise SystemExit(f"模型不足 3 个: {models} -> {onnx}")
print("models:")
for p in onnx:
    print(f"  {p.name} ({p.stat().st_size} bytes)")
