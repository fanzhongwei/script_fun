"""推理设备检测：CUDA / ROCm / CPU。"""

from __future__ import annotations

import os

import torch

# RX 6500 XT 等 gfx1034 显卡在 ROCm 6.2 下需映射到 gfx1030 才能运行 HIP kernel
if getattr(torch.version, "hip", None):
    os.environ.setdefault("HSA_OVERRIDE_GFX_VERSION", "10.3.0")

_gpu_checked = False
_gpu_usable = False


def _probe_gpu() -> bool:
    if not torch.cuda.is_available():
        return False
    try:
        x = torch.randn(2, 2, device="cuda")
        _ = x @ x
        torch.cuda.synchronize()
        return True
    except RuntimeError:
        return False


def _ensure_gpu_checked() -> None:
    global _gpu_checked, _gpu_usable
    if _gpu_checked:
        return
    _gpu_usable = _probe_gpu()
    _gpu_checked = True


def get_lama_device() -> torch.device:
    """LaMa 为 TorchScript 模型，ROCm 上全分辨率推理不稳定，固定走 CPU。"""
    if getattr(torch.version, "hip", None):
        return torch.device("cpu")
    _ensure_gpu_checked()
    if _gpu_usable:
        return torch.device("cuda")
    return torch.device("cpu")


def get_torch_device() -> torch.device:
    return get_lama_device()


def ocr_use_gpu() -> bool:
    _ensure_gpu_checked()
    return _gpu_usable


def accelerator_summary() -> str:
    _ensure_gpu_checked()
    if not torch.cuda.is_available():
        return "CPU（未检测到 CUDA/ROCm 加速）"
    name = torch.cuda.get_device_name(0)
    backend = "ROCm" if getattr(torch.version, "hip", None) else "CUDA"
    override = os.environ.get("HSA_OVERRIDE_GFX_VERSION")
    gfx = f"（gfx 映射 {override}）" if override and backend == "ROCm" else ""
    if getattr(torch.version, "hip", None):
        if _gpu_usable:
            return f"{backend} · {name}{gfx} · OCR GPU / LaMa CPU"
        return f"CPU · OCR/LaMa 降级（GPU 已识别但不可用）"
    if _gpu_usable:
        return f"{backend} · {name} · 全 GPU"
    return "CPU（GPU 已识别但 HIP/CUDA 不可用，已降级 CPU）"
