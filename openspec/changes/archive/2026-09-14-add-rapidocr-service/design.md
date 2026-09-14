## Context

仓库 `python/` 下尚无 Dockerfile；现有脚本（含 `watermark_remover`）均为本机进程。OCR HTTP 能力直接使用 PyPI `rapidocr_api`（FastAPI + `RapidOCR()`，`POST /ocr`），不自研路由。官方 `rapidocr_api` Dockerfile 依赖陈旧且仅为 CPU，不能复用。RapidOCR 默认 `EngineConfig.onnxruntime.use_cuda` 为 `false`，仅安装 `onnxruntime-gpu` 不会走 CUDA。构建期允许联网；运行期要求离线。GPU 仅承诺本机 NVIDIA。详见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 一份业务代码零增量：容器 `CMD` 调用 `rapidocr_api`
- CPU / GPU 两套 Dockerfile，依赖与 CUDA 开关在镜像构建中固化
- 构建时预热默认模型，运行可 `--network none`
- 宿主机检测 NVIDIA 后选择 compose profile / 镜像
- 压测为目录内 Python 脚本，打 multipart `/ocr`

**Non-Goals:**

- 自研 FastAPI 或改变 RapidOCRAPI 的 JSON 形态
- 批量接口、鉴权、K8s、TensorRT、Paddle/OpenVINO 引擎
- AMD/ROCm；替换水印工具里的 EasyOCR
- 复用官方 RapidOCR 开发用 docker/ 目录（bind-mount 源码，非服务镜像）

## Decisions

### 1. 接口：官方包，不写路由

- **选择**：镜像内 `pip install rapidocr_api`（钉版本）+ `CMD ["rapidocr_api", "-ip", "0.0.0.0", "-p", "9003", ...]`
- **理由**：单图 `/ocr` 已满足；用户明确不需要自研接口
- **备选**：复制 `main.py` 传入 `use_cuda` —— 拒绝，改用镜像内改配置（见决策 3）

### 2. 双 Dockerfile，不在运行时换包

- **选择**：`docker/Dockerfile.cpu`（`python:3.10-slim-bookworm` + `onnxruntime`）与 `docker/Dockerfile.gpu`（`nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04` 对齐 RapidOCR 官方 GPU 开发镜像 + `onnxruntime-gpu`）
- **理由**：CPU/GPU wheel 互斥；一套镜像无法可靠热切换
- **备选**：build-arg 单文件 —— 可读性差，仍要打两次包
- **GPU 镜像注意**：`rapidocr` 会拉取 CPU `onnxruntime`，GPU Dockerfile MUST 卸载 CPU 包后再装 `onnxruntime-gpu`，避免两套并存

### 3. GPU：构建时改 RapidOCR 默认 `config.yaml`

- **选择**：GPU 镜像 `pip` 完成后，将 `site-packages/rapidocr/config.yaml` 中 `EngineConfig.onnxruntime.use_cuda` 改为 `true`（精确替换该键，避免误改 Paddle/Torch 段）
- **理由**：`rapidocr_api` 只认模型路径环境变量，不接受 CUDA 开关；改默认配置无需自研 API
- **备选**：维护一份入口包装 —— 用户已否决
- **约束**：`rapidocr` / `rapidocr_api` / `onnxruntime(-gpu)` 版本钉死，降低 yaml 路径漂移风险

### 4. 离线：构建期实例化引擎

- **选择**：Dockerfile `RUN python -c "from rapidocr import RapidOCR; RapidOCR()"`（GPU 镜像在改 `use_cuda` 之后执行；构建机无 GPU 时 CUDA EP 可能不可用，预热仍应完成模型文件落地；若 CUDA session 在构建机失败，改为仅触发模型下载的等价步骤，保证 `rapidocr/models/` 内默认 det/cls/rec onnx 存在）
- **理由**：缺模型时 RapidOCR 会访问 ModelScope；预热后运行断网
- **备选**：手工 COPY 模型文件 —— 维护哈希成本更高，作预热失败时的后备即可

### 5. 编排与本机检测

- **选择**：`docker-compose.yml` 两个 profile（`cpu` / `gpu`）；`scripts/run.sh` 复用与 `watermark_remover` 同类的 NVIDIA 信号（`nvidia-smi -L`、`/dev/nvidia0` 或 `nvidiactl`、内核模块 `nvidia`、`lspci` nvidia/`10de`），有则 `--profile gpu`（`--gpus` / compose `deploy.resources.reservations.devices`），否则 cpu
- **理由**：检测发生在宿主机，与「选哪张镜像」一致
- **端口**：宿主机 `9003:9003`（官方默认）
- **workers**：CPU 默认 1 或 2（与官方示例接近）；GPU 默认 1，避免多进程抢卡。可用 compose 环境变量覆盖，不作为第一期必做 UI

### 6. 压测

- **选择**：`bench/bench.py`，标准库 + `urllib` 或已随镜像/本机的 `python3-dev` + `httpx`/`requests` 择一；优先少依赖：`python3-dev` + 标准库 `concurrent.futures` + `urllib` 上传 multipart
- **参数**：`--url`（默认 `http://127.0.0.1:9003/ocr`）、`--image`、`--concurrency`、`--requests`
- **输出**：总耗时、成功数、失败数、QPS、avg、p50、p95、p99（毫秒）
- **样图**：`bench/sample.png`（小幅中英数字样图，可从 RapidOCR 测试图取得并纳入仓库，注意许可证 Apache-2.0）
- **备选**：locust —— 超出「只要命令行」

### 7. 目录结构

```
python/rapidocr_service/
  README.md
  docker/Dockerfile.cpu
  docker/Dockerfile.gpu
  docker/compose.yml
  docker/.dockerignore
  scripts/run.sh
  bench/bench.py
  bench/sample.png
  versions.env          # 钉死的包版本，构建 ARG 引用（可选，避免两处 Dockerfile 漂移）
```

不新增应用 Python 包目录（无自研 `app/`）。

### 8. 基础镜像与 Python

- CPU：官方 slim Python 3.10，与 RapidOCRAPI 文档一致
- GPU：CUDA 12.4.1 + 自行安装 Python 3.10，或 `nvidia/cuda` 上 apt 装 python3.10；需在 README FAQ 写明驱动与 toolkit 要求
- 容器内不必使用宿主机 `python3-dev`；压测脚本在宿主机用 `python3-dev` 即可

## Risks / Trade-offs

- [RapidOCR 升级导致 config.yaml 结构变化，sed/补丁失效] → 钉版本；构建后可用日志或一次 OCR 后确认 provider；README 写明升级需回归 `use_cuda`
- [GPU 构建机无 GPU，预热 `RapidOCR()` 因 CUDA 失败] → 预热与「启用 CUDA」解耦：先下载模型，use_cuda 仅影响运行时 session
- [GPU 容器未加 `--gpus`，静默跑 CPU] → README FAQ；启动脚本在选 gpu profile 时强制 `--gpus all`；文档要求看 RapidOCR 启动日志中的 provider
- [官方 Dockerfile 与当前 `rapidocr_api` 代码不一致误导实现者] → 禁止复制官方 Dockerfile，只信 PyPI 包 API
- [多 worker + GPU 变慢] → GPU 默认 workers=1
- [镜像体积因模型与 CUDA runtime 变大] → 接受；换 volume 会破坏离线默认路径

## Migration Plan

- 纯新增目录，无需迁移数据
- 回滚：删除 `python/rapidocr_service/` 与对应镜像/容器即可
- 不发布到现有脚本的默认依赖图

## Open Questions

（无。CUDA 基础镜像小版本、workers 默认值可在实现时按构建可行性微调，不改变规格中的可观察行为。）
