"""打包与开发环境下的资源路径解析。"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def get_app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def get_models_dir() -> Path:
    bundled = get_app_dir() / "models"
    if bundled.is_dir():
        return bundled
    return get_app_dir()


def get_lama_model_path() -> Path | None:
    bundled = get_models_dir() / "big-lama.pt"
    if bundled.is_file():
        return bundled
    env_path = os.environ.get("LAMA_MODEL")
    if env_path and Path(env_path).is_file():
        return Path(env_path)
    return None


def get_easyocr_model_dir() -> Path:
    custom = get_models_dir() / "easyocr"
    custom.mkdir(parents=True, exist_ok=True)
    return custom


def configure_model_environment() -> None:
    lama = get_lama_model_path()
    if lama is not None:
        os.environ.setdefault("LAMA_MODEL", str(lama))
    os.environ.setdefault("EASYOCR_MODULE_PATH", str(get_easyocr_model_dir()))
