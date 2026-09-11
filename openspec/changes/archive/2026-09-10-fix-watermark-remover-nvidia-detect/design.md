## Context

见 `proposal.md`。现有 `detect_accelerator` 先 `lspci | grep nvidia`，命中后才看 `/dev/nvidia*` / `lsmod`；`deps_ready` 只做模块 import。约束：只改 Linux 开发环境安装脚本与 README；Python 仍用 `python3-dev` / `pip3-dev`；CUDA 源按解释器版本探测，不再写死 cu124；不改 GUI/CLI 推理代码、不改 `setup-rocm.sh` 的 AMD 安装细节。

## Goals / Non-Goals

**Goals:**

- 探测顺序与「机器上能不能用 NVIDIA 驱动」对齐，而不是与 `pci.ids` 文本对齐
- 已误装 CPU 版 torch 的开发机，再跑 `ensure-dev-env.sh` / `run-gui.sh` 能自动改成 CUDA 版
- 判定失败时日志可诊断
- CUDA wheel 与当前 python3-dev 的 CPython 标签匹配

**Non-Goals:**

- 不为 1080 Ti / Pascal 单独编译自定义 torch
- 不改 `device_utils.py` 运行时探测
- 不新增强制指定加速器的 CLI 参数（`TORCH_CUDA_INDEX` 环境变量可覆盖源）
- 不改 Windows 打包与 AppImage 内置 torch

## Decisions

### 1. NVIDIA 信号短路，任一命中即 `cuda`

- **决策**：按以下顺序，命中即返回 `cuda`：
  1. `nvidia-smi -L` 成功且输出非空
  2. `/dev/nvidia0` 或 `/dev/nvidiactl` 存在
  3. `lsmod` 有 `^nvidia` 模块行
  4. `lspci` 匹配 `nvidia` **或** 厂商号 `10de`
- **理由**：`nvidia-smi` 与设备节点是驱动可用的直接证据；`lspci` 只作补充，并覆盖 pci.ids 缺失时的数字 ID。
- **备选**：继续只靠 `lspci` — 即当前缺陷。只靠 `nvidia-smi` — PATH/沙箱里可能没有该命令，设备节点更稳。

### 2. 依赖就绪 = 模块可导入 + 加速器与 torch 构建一致

- **决策**：在现有 import 检查之外，若加速器为 `cuda`，则要求 `torch.version.cuda` 非空才视为就绪；否则走 `install_torch_cuda`。
- **理由**：CPU wheel 同样能 `import torch`，这是「装错一次就钉死」的根因。
- **备选**：让用户手动 `pip uninstall` — 不符合「再跑一遍即可纠正」。检查 `torch.cuda.is_available()` — 安装阶段驱动偶发不可用时会误判，用 **构建是否带 CUDA** 更合适。

### 3. AMD 探测仍在 NVIDIA 之后

- **决策**：NVIDIA 未命中再走现有 AMD/`kfd` 分支，否则 CPU。
- **理由**：双显卡本机（核显 AMD + 独显 NVIDIA）应优先独显 CUDA，与现有注释「优先 NVIDIA」一致。不改 `setup-rocm.sh`。

### 4. 日志打印判定结果与依据

- **决策**：`加速器: cuda|rocm|cpu` 行保留；CPU 时额外一行说明「未命中 nvidia-smi / 设备节点 / lsmod / lspci」。
- **理由**：下次再误判时不必读脚本。

### 5. CUDA 源按 python3-dev 版本探测

- **决策**：未设置 `TORCH_CUDA_INDEX` 时，按 CPython 标签探测官方 `cu*` 索引是否含对应 `cpXX` x86_64/aarch64 wheel。3.14/3.15 候选 `cu126 → cu128 → cu130`；3.13 为 `cu126 → cu128 → cu124`；其余先 `cu124`。阿里云镜像用同一 tag。CUDA 安装失败时 **不** 加 PyPI `extra-index-url`，避免装上无 CUDA 的 torch。
- **理由**：cu124 没有 cp314；上次回退清华 PyPI 下到 2.14 通用包。同一解释器优先较旧 CUDA，兼顾 1080 Ti 等老卡。
- **备选**：写死 cu130 — 对 3.12 过新；写死 cu124 — 3.14 无包。

## Risks / Trade-offs

- [仅有 NVIDIA 音频设备、`lspci` 出现 `10de` 但无计算 GPU] → 可能误装 CUDA wheel。缓解：优先 `nvidia-smi` 与 `/dev/nvidia0`；纯音频卡通常没有这些节点。CUDA wheel 在无 GPU 机器上仍可 import，运行时会降级 CPU。
- [沙箱里既无 `lspci` 也无 `/dev/nvidia*`，但宿主机有卡] → 仍会装 CPU。缓解：这是执行环境限制，日志会写明；用户在有设备节点的终端重跑即可纠正（本变更后不会因 CPU torch 已 import 而跳过）。
- [升级 CUDA torch 耗时、占磁盘] → 仅在判定 NVIDIA 且当前为 CPU 构建时发生，可接受。
- [新版 torch 去掉 Pascal sm_61，1080 Ti 上 `is_available()` 仍可能为 false] → 3.14 优先 cu126；若仍不行需换 3.12 + cu124，另开变更。

## Migration Plan

1. 合并后开发者直接 `./run-gui.sh` 或 `./packaging/linux/ensure-dev-env.sh`。
2. 已装 CPU 版且本机有 NVIDIA 的环境会触发一次 CUDA 重装，无需删 venv。
3. 回滚：还原 `ensure-dev-env.sh` 即可；已装的 CUDA torch 可保留。

## Open Questions

（无）
