# -*- encoding: utf-8 -*-
"""把 rapidocr_api 的 JSON 转成官方 Web 的 rec_res 列表。仅标准库。"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Sequence, Tuple

# 序号, 文本, 置信度, "x,y,w,h", 四边形点
RecRow = Tuple[int, str, str, str, List[List[float]]]


def _points(dt_boxes: Any) -> List[List[float]]:
    if not dt_boxes:
        return []
    first = dt_boxes[0]
    if isinstance(first, (int, float)):
        flat = [float(v) for v in dt_boxes]
        return [[flat[i], flat[i + 1]] for i in range(0, len(flat) - 1, 2)]
    return [[float(p[0]), float(p[1])] for p in dt_boxes]


def _xywh(pts: List[List[float]]) -> str:
    if not pts:
        return "0,0,0,0"
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x, y = int(min(xs)), int(min(ys))
    w, h = int(max(xs) - x), int(max(ys) - y)
    return f"{x},{y},{w},{h}"


def map_api_result(api_obj: Dict[str, Any]) -> List[RecRow]:
    if not api_obj:
        return []
    keys = sorted(api_obj.keys(), key=lambda x: int(x) if str(x).isdigit() else 0)
    rows: List[RecRow] = []
    for i, key in enumerate(keys):
        item = api_obj[key]
        pts = _points(item.get("dt_boxes"))
        rows.append((i + 1, str(item["rec_txt"]), f"{float(item['score']):.4f}", _xywh(pts), pts))
    return rows


def rec_res_json(rows: Sequence[RecRow]) -> str:
    if not rows:
        return ""
    return json.dumps(list(rows), indent=2, ensure_ascii=False)
