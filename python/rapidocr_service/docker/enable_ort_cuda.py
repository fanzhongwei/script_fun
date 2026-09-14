#!/usr/bin/env python3
"""仅将 RapidOCR 默认配置里 EngineConfig.onnxruntime.use_cuda 设为 true。"""
from pathlib import Path

import rapidocr


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def patch(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    in_engine = False
    engine_indent = -1
    in_ort = False
    ort_indent = -1
    changed = False
    out = []
    for line in lines:
        stripped = line.strip()
        indent = _indent(line)
        if stripped == "EngineConfig:":
            in_engine = True
            engine_indent = indent
            in_ort = False
            out.append(line)
            continue
        if in_engine and stripped.endswith(":") and indent <= engine_indent and stripped != "EngineConfig:":
            in_engine = False
            in_ort = False
        if in_engine and stripped == "onnxruntime:":
            in_ort = True
            ort_indent = indent
            out.append(line)
            continue
        if in_ort and stripped.endswith(":") and indent <= ort_indent and stripped != "onnxruntime:":
            in_ort = False
        if in_ort and stripped.startswith("use_cuda:") and indent > ort_indent:
            prefix = line[: line.find("use_cuda:")]
            out.append(f"{prefix}use_cuda: true")
            changed = True
            continue
        out.append(line)
    if not changed:
        raise SystemExit(f"未能修改 onnxruntime.use_cuda: {path}")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"patched {path}")


if __name__ == "__main__":
    patch(Path(rapidocr.__file__).resolve().parent / "config.yaml")
