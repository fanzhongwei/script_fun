"""水印修复：LaMa（默认）与 OpenCV inpaint（降级）。"""

from __future__ import annotations

import os
from enum import Enum
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from device_utils import get_lama_device


class InpaintEngine(str, Enum):
    LAMA = "lama"
    OPENCV = "opencv"


LAMA_MODEL_URL = os.environ.get(
    "LAMA_MODEL_URL",
    "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt",
)


class Inpainter:
    def __init__(self, engine: InpaintEngine = InpaintEngine.LAMA) -> None:
        self.engine = engine
        self._lama_model = None
        self._lama_device = get_lama_device()

    def _get_lama_model(self):
        if self._lama_model is None:
            from resources import configure_model_environment, get_lama_model_path
            from simple_lama_inpainting.utils.util import download_model

            configure_model_environment()
            model_path = get_lama_model_path()
            if model_path is None:
                model_path = Path(download_model(LAMA_MODEL_URL))
            else:
                model_path = Path(model_path)
            self._lama_model = torch.jit.load(str(model_path), map_location=self._lama_device)
            self._lama_model.eval()
            self._lama_model.to(self._lama_device)
        return self._lama_model

    def inpaint(self, image_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
        if self.engine == InpaintEngine.OPENCV:
            return self._inpaint_opencv(image_bgr, mask)
        return self._inpaint_lama(image_bgr, mask)

    def _inpaint_opencv(self, image_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
        if mask.ndim == 3:
            mask_gray = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
        else:
            mask_gray = mask
        _, binary = cv2.threshold(mask_gray, 1, 255, cv2.THRESH_BINARY)
        return cv2.inpaint(image_bgr, binary, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    def _inpaint_lama(self, image_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
        if mask.ndim == 3:
            mask_gray = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
        else:
            mask_gray = mask
        _, binary = cv2.threshold(mask_gray, 1, 255, cv2.THRESH_BINARY)

        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        image_pil = Image.fromarray(image_rgb)
        mask_pil = Image.fromarray(binary).convert("L")

        from simple_lama_inpainting.utils.util import prepare_img_and_mask

        device = self._lama_device
        try:
            return self._run_lama(image_pil, mask_pil, device)
        except RuntimeError:
            if device.type == "cpu":
                raise
            self._lama_device = torch.device("cpu")
            self._lama_model = None
            return self._run_lama(image_pil, mask_pil, self._lama_device)

    def _run_lama(self, image_pil, mask_pil, device: torch.device) -> np.ndarray:
        from simple_lama_inpainting.utils.util import prepare_img_and_mask

        model = self._get_lama_model()
        image_t, mask_t = prepare_img_and_mask(image_pil, mask_pil, device)
        with torch.inference_mode():
            inpainted = model(image_t, mask_t)
            result = inpainted[0].permute(1, 2, 0).detach().cpu().numpy()
            result = np.clip(result * 255, 0, 255).astype(np.uint8)
        return cv2.cvtColor(result, cv2.COLOR_RGB2BGR)


def save_preview(image_bgr: np.ndarray, mask: np.ndarray, overlay_path, mask_path) -> None:
    if mask.ndim == 3:
        mask_gray = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
    else:
        mask_gray = mask

    cv2.imwrite(str(mask_path), mask_gray)

    overlay = image_bgr.copy()
    red = np.zeros_like(image_bgr)
    red[:, :, 2] = 255
    alpha = (mask_gray > 0).astype(np.float32)[..., None] * 0.45
    overlay = (overlay.astype(np.float32) * (1 - alpha) + red.astype(np.float32) * alpha).astype(
        np.uint8
    )
    cv2.imwrite(str(overlay_path), overlay)
