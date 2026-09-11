## 1. NVIDIA 探测

- [x] 1.1 重写 `packaging/linux/ensure-dev-env.sh` 中 `detect_accelerator`：按 `nvidia-smi -L`、`/dev/nvidia0|nvidiactl`、`lsmod ^nvidia`、`lspci`（`nvidia` 或 `10de`）短路判定 `cuda`，再 AMD，再 CPU；用 `bash -c 'source` 或抽出函数后在本机执行，确认输出为 `cuda`（本机 `nvidia-smi` 可用）
- [x] 1.2 CPU 分支打印未命中依据（nvidia-smi / 设备节点 / lsmod / lspci）；人为阻断上述信号后跑探测，日志含原因且结果为 `cpu` 或 `rocm`（视本机 AMD 而定）

## 2. 依赖就绪与重装

- [x] 2.1 扩展 `deps_ready`：加速器为 `cuda` 时要求 `torch.version.cuda` 非空；在当前若为 CPU 版 torch 的环境下跑 `ensure-dev-env.sh`，确认进入 `install_torch_cuda` 而非「依赖已就绪，跳过安装」
- [x] 2.2 按 `python3-dev` 版本探测 CUDA 源（3.14→cu126 等），官方失败只回退同 tag 阿里云、不加 PyPI extra-index；本机 source 后 `resolve_torch_cuda_urls` 输出 cu126
- [x] 2.3 安装结束后 `python3-dev -c "import torch; print(torch.version.cuda)"` 打印非空版本号

## 3. 文档与自检

- [x] 3.1 更新 `python/watermark_remover/README.md`：写明 NVIDIA 探测依据及「已装 CPU 版会自动改装 CUDA」；通读与规格场景一致
- [x] 3.2 本机执行 `./packaging/linux/ensure-dev-env.sh`，日志为 `加速器: cuda`，`verify_runtime` 中 `cuda available: True`（若驱动可用）；不改 GUI/CLI 业务代码
