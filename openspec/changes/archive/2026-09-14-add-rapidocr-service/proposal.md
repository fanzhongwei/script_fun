## Why

仓库内现有脚本均为本机 CLI/GUI，缺少可复用的 HTTP OCR 服务。需要基于 RapidOCR 提供容器化识别接口，供其它脚本或工具调用，并同时覆盖 CPU 与本机 NVIDIA GPU 两种运行环境。

## What Changes

- 新增 Python 脚本目录 `python/rapidocr_service/`，内含 Docker 构建、启动脚本、压测脚本与 README（环境依赖、参数、配置、FAQ）
- 使用官方 PyPI 包 `rapidocr_api` 提供单图 `POST /ocr` 接口，不自研 FastAPI 路由
- 提供独立的 `Dockerfile.cpu` 与 `Dockerfile.gpu`；构建阶段允许联网安装依赖并预热默认 ONNX 模型，运行阶段可离线
- GPU 镜像安装 `onnxruntime-gpu`，并在构建时将 RapidOCR 默认配置中的 `EngineConfig.onnxruntime.use_cuda` 设为 `true`；CPU 镜像保持 CPU 推理
- 启动时检测本机 NVIDIA（与水印工具同类信号），有卡则起 GPU 容器，否则起 CPU 容器
- 提供命令行压测脚本：对固定样图调用 `/ocr`，输出 QPS 与延迟分位（p50/p95/p99）
- 不修改 `watermark_remover` 及其它现有脚本；不承诺 AMD/ROCm、批量 OCR、鉴权或 TensorRT

## Capabilities

### New Capabilities

- `rapidocr-service`：基于 RapidOCRAPI 的 Docker OCR HTTP 服务，支持 CPU/GPU 双镜像、离线运行、本机选镜像与命令行压测

### Modified Capabilities

（无）

## Impact

- 新增目录：`python/rapidocr_service/`（Docker、compose、启动脚本、压测、README）
- 新增运行时依赖（容器内）：`rapidocr_api`、`rapidocr`、`onnxruntime` 或 `onnxruntime-gpu`；版本需钉死
- GPU 运行依赖宿主机 NVIDIA 驱动与 NVIDIA Container Toolkit
- 不影响现有 `tampermonkey/`、`python/watermark_remover/`、`python/turnstile_verify/` 行为
- 本仓库首次引入服务向 Dockerfile；调用方使用官方 RapidOCRAPI 协议（默认端口 9003）
