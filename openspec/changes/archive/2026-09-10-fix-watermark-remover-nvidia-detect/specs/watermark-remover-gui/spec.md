## MODIFIED Requirements

### Requirement: 开发启动跳过已有 python3-dev

通过 `run-gui.sh` 在 Linux 开发环境启动时，若系统 PATH 上已有可执行的 `python3-dev` 且能成功打印版本，脚本 SHALL NOT 下载或重装独立 CPython，SHALL NOT 因缺少 `PY_ROOT/cpython/bin/python3` 而判定需要 bootstrap。仅当找不到可用的 `python3-dev` 时 SHALL 执行 bootstrap。Python 包在必要模块无法导入、或加速器判定为 NVIDIA 但当前 PyTorch 不含 CUDA 时 SHALL 安装或重装；SHALL NOT 仅因 `import torch` 成功就跳过 CUDA 版安装。

#### Scenario: 已有 python3-dev 不重装解释器

- **WHEN** 本机已能执行 `python3-dev --version` 且用户运行 `run-gui.sh`
- **THEN** 不下载独立 CPython 压缩包，也不重建 venv

#### Scenario: 无 python3-dev 才 bootstrap

- **WHEN** PATH 上找不到可运行的 `python3-dev`
- **THEN** 脚本安装独立 Python 并创建 `python3-dev` 包装后再继续依赖检查

#### Scenario: 已装 CPU 版 torch 仍安装 CUDA 版

- **WHEN** 加速器判定为 NVIDIA，且当前环境能导入 torch 但 `torch.version.cuda` 为空
- **THEN** 脚本安装 CUDA 版 PyTorch，而不是跳过依赖安装

## ADDED Requirements

### Requirement: Linux 开发环境按可用 NVIDIA 安装 CUDA 版 PyTorch

通过 `run-gui.sh` 或 `ensure-dev-env.sh` 在 Linux 上补齐依赖时，脚本 SHALL 将本机判定为 NVIDIA，当且仅当下列任一成立：`nvidia-smi` 能列出 GPU；存在 NVIDIA 设备节点（如 `/dev/nvidia0` 或 `/dev/nvidiactl`）；内核已加载 `nvidia` 模块；`lspci` 输出含 `nvidia` 或 PCI 厂商号 `10de`。SHALL NOT 仅因 `lspci` 文本不含单词 `nvidia` 就判定为 CPU。NVIDIA 与 AMD 同时可探测时 SHALL 优先 NVIDIA。判定为 NVIDIA 时 SHALL 安装与当前 `python3-dev` 版本匹配的 CUDA 版 PyTorch（探测官方索引中含该 CPython 标签的 wheel，例如 3.14 选用 cu126 而非无包的 cu124）。未设置 `TORCH_CUDA_INDEX` 时 SHALL NOT 固定使用单一 cu124 源。判定为 CPU 时 SHALL 在日志中说明未命中的探测依据。

#### Scenario: nvidia-smi 可用即走 CUDA

- **WHEN** 用户本机 `nvidia-smi` 能列出 NVIDIA GPU，即使 `lspci` 不可用或未打印 `nvidia` 字样
- **THEN** 脚本将加速器记为 NVIDIA 并安装 CUDA 版 PyTorch

#### Scenario: 仅有设备节点也走 CUDA

- **WHEN** 存在 `/dev/nvidia0` 或 `/dev/nvidiactl`，且用户触发依赖安装
- **THEN** 脚本将加速器记为 NVIDIA 并安装 CUDA 版 PyTorch

#### Scenario: lspci 仅显示 10de 也走 CUDA

- **WHEN** `lspci` 输出含 `10de` 但不含 `nvidia` 字样，且用户触发依赖安装
- **THEN** 脚本将加速器记为 NVIDIA 并安装 CUDA 版 PyTorch

#### Scenario: 无 NVIDIA 信号才装 CPU

- **WHEN** 上述 NVIDIA 信号均不成立，且也未判定为 AMD
- **THEN** 脚本安装 CPU 版 PyTorch，并打印未检测到独显加速的原因

#### Scenario: Python 3.14 选用有 wheel 的 CUDA 源

- **WHEN** 当前 `python3-dev` 为 3.14 且加速器为 NVIDIA，用户未设置 `TORCH_CUDA_INDEX`
- **THEN** 脚本从含 cp314 的官方 CUDA 索引安装 torch（如 cu126），而不是从无对应包的 cu124 安装
