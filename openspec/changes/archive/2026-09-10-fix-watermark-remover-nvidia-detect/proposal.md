## Why

Linux 开发机通过 `run-gui.sh` 补依赖时，加速器探测只靠 `lspci` 文本是否含 `nvidia`。本机已有 NVIDIA 驱动且 `nvidia-smi`、`/dev/nvidia0` 均可用时，仍可能被判为 CPU，从而安装 PyTorch CPU 版。一旦 `import torch` 成功，后续启动会跳过安装，GPU 永久用不上。

## What Changes

- 调整 Linux 开发环境 NVIDIA 探测：不以 `lspci` 厂商名为唯一门槛；优先采信 `nvidia-smi`、NVIDIA 设备节点、内核模块，并兼容 `lspci` 仅显示厂商号 `10de` 的情况
- 依赖就绪判定区分 CPU / CUDA 版 torch：本机已判定为 NVIDIA 但当前 torch 无 CUDA 时，SHALL 重装 CUDA 版，而不是因模块能导入就跳过
- 探测失败时打印依据（缺 `lspci`、无设备节点等），避免静默装 CPU
- 按当前 `python3-dev` 版本选择有对应 wheel 的 CUDA 源（3.14 不走 cu124）；CUDA 回退不再误用 PyPI 通用 torch
- 更新 `watermark_remover` README 中 GPU 检测说明
- 不改 GUI 交互、CLI 去水印语义、ROCm 安装脚本的 AMD 流程（除非与 NVIDIA 探测顺序冲突时保持「NVIDIA 优先」）
- 不引入新 Python 依赖

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `watermark-remover-gui`：Linux 开发启动在按 GPU 安装 PyTorch 时，NVIDIA 探测与「已装 CPU torch 仍应升级 CUDA」的行为

## Impact

- 修改：`python/watermark_remover/packaging/linux/ensure-dev-env.sh`（探测、安装分支、依赖就绪）
- 可能小幅修改：`python/watermark_remover/run-gui.sh`（仅透传日志，无新入口）
- 文档：`python/watermark_remover/README.md` 环境依赖 / 首次安装说明
- 运行时 `device_utils.py` 逻辑不变；CUDA 版装对后现有 `torch.cuda.is_available()` 即可用 GPU
- 不影响 Tampermonkey、打包产物默认内容；已误装 CPU 的开发机在下次 `ensure-dev-env.sh` 时应自动纠正
