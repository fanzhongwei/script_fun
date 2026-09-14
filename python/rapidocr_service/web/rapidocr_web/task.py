# -*- encoding: utf-8 -*-
# 官方 RapidOCRWeb 的 OCRWebUtils 改为转发 rapidocr_api，不再加载 RapidOCR。
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional

import cv2
import numpy as np

try:
    from rapidocr_web.map_result import map_api_result, rec_res_json
except ImportError:
    from map_result import map_api_result, rec_res_json


@dataclass
class OCRWebOutput:
    image: str
    total_elapse: str
    elapse_part: str
    rec_res: str
    det_elapse: str


class OCRWebUtils:
    def __init__(self) -> None:
        self.api_url = os.environ.get("RAPIDOCR_API_URL", "http://ocr-api:9003/ocr")

    def __call__(self, img_content: Optional[str]) -> str:
        if img_content is None:
            raise ValueError("img is None")
        prep_t0 = time.perf_counter()
        img, raw = self.prepare_img(img_content)
        prep_elapse = time.perf_counter() - prep_t0
        return self.get_ocr_res(img, raw, prep_elapse)

    def prepare_img(self, img_str: str) -> tuple:
        payload = img_str.split(",", 1)[1] if "," in img_str else img_str
        image = base64.b64decode(payload + "=" * (-len(payload) % 4))
        nparr = np.frombuffer(image, np.uint8)
        decoded = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if decoded is None:
            raise ValueError("invalid image")
        if decoded.ndim == 2:
            decoded = cv2.cvtColor(decoded, cv2.COLOR_GRAY2BGR)
        return decoded, image

    def get_ocr_res(self, img: np.ndarray, raw: bytes, prep_elapse: float) -> str:
        api_t0 = time.perf_counter()
        api_obj = self._post_ocr(raw)
        api_elapse = time.perf_counter() - api_t0
        rows = map_api_result(api_obj)
        enc_t0 = time.perf_counter()
        image_b64 = self.img_to_base64(img) if rows else ""
        # 官方 Web 的「文本检测」是 RapidOCR elapse_list[0]；9003 不返回分段，左栏用解码+出图。
        det_elapse = prep_elapse + (time.perf_counter() - enc_t0)
        empty = not rows
        result = OCRWebOutput(
            image="" if empty else image_b64,
            total_elapse=f"{api_elapse:.4f}",
            elapse_part="",
            rec_res="" if empty else rec_res_json(rows),
            det_elapse=f"{det_elapse:.4f}",
        )
        return json.dumps(asdict(result))

    def _post_ocr(self, image_bytes: bytes) -> Dict[str, Any]:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        body = urllib.parse.urlencode({"image_data": b64}).encode("utf-8")
        req = urllib.request.Request(self.api_url, data=body, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            raise RuntimeError("ocr api unavailable") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("ocr api bad response")
        return payload

    @staticmethod
    def img_to_base64(img: np.ndarray) -> str:
        encoded = cv2.imencode(".png", img)[1]
        return str(base64.b64encode(encoded))[2:-1]
