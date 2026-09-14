#!/usr/bin/env python3
"""API JSON → rec_res 映射自检（无 Flask、无真实 API）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rapidocr_web.map_result import map_api_result, rec_res_json

sample = {
    "1": {"rec_txt": "World", "dt_boxes": [[0, 0], [1, 0], [1, 1], [0, 1]], "score": 0.8},
    "0": {"rec_txt": "你好", "dt_boxes": [[2, 2], [3, 2], [3, 3], [2, 3]], "score": 0.98765},
}
rows = map_api_result(sample)
text = rec_res_json(rows)
assert rows[0][0] == 1, rows[0]
assert "你好" in text, text
assert "World" in text, text
assert "0.9877" in text, text
assert "2,2,1,1" in text, text
assert rec_res_json(map_api_result({})) == ""
print("ok")
