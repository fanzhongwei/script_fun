# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec：在 python/watermark_remover 目录下执行
# pyinstaller packaging/watermark_remover_gui.spec

import sys
from pathlib import Path

block_cipher = None
root = Path(SPECPATH).parent

a = Analysis(
    [str(root / "gui_entry.py")],
    pathex=[str(root)],
    binaries=[],
    datas=[
        (str(root / "patterns.yaml"), "."),
    ] + ([(str(root / "models"), "models")] if (root / "models").is_dir() else []),
    hiddenimports=[
        "easyocr",
        "cv2",
        "torch",
        "torchvision",
        "simple_lama_inpainting",
        "yaml",
        "PySide6",
        "PySide6.QtCore",
        "PySide6.QtGui",
        "PySide6.QtWidgets",
        "detector",
        "inpainter",
        "image_utils",
        "resources",
        "device_utils",
        "export_profile",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="WatermarkRemover",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="WatermarkRemover",
)
