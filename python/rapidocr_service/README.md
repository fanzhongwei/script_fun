# RapidOCR HTTP 服务

基于 [RapidOCR](https://github.com/RapidAI/RapidOCR) 与官方 PyPI 包 [`rapidocr_api`](https://github.com/RapidAI/RapidOCRAPI) 的 Docker OCR 服务：单图 `POST /ocr`，CPU / GPU 双镜像，构建后可离线运行。

**不要使用 RapidOCRAPI 仓库里的官方 Dockerfile**（依赖陈旧，仅为 CPU）。本目录自行维护 `docker/Dockerfile.cpu` 与 `docker/Dockerfile.gpu`。

## 环境依赖说明

- **操作系统**：Linux（构建与运行 Docker）；GPU 仅支持 NVIDIA
- **Docker**：Docker 20.10+，Docker Compose v2（本机若无 `docker compose` 插件，可用 `docker-compose`）
- **CPU 基础镜像**：`python:3.12-bookworm`（`rapidocr_api` 支持 3.10–3.13）
- **GPU 基础镜像**：`nvcr.io/nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`（与 RapidOCR 官方 GPU 开发镜像同一 CUDA/cuDNN 版本，从 NGC 拉取以避免部分 Docker Hub 镜像源证书问题）
- **构建网络**：构建镜像时需要访问互联网。Python 包默认走国内源：阿里云 `mirrors.aliyun.com` 优先，清华为备用（`docker/pip.conf` 与 `PIP_INDEX_URL`）
- **运行网络**：运行期不需要外网（模型已打进镜像）
- **CPU 镜像**：无 GPU 即可
- **GPU 镜像**：本机 NVIDIA 驱动 + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)；CUDA 基础镜像为 `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`
- **压测**：宿主机 `python3-dev`（标准库即可，无需再装 pip 包）
- **包版本**：见同目录 `versions.env`（`rapidocr_api` / `rapidocr` / `onnxruntime` / `onnxruntime-gpu` 钉死）

## 脚本参数说明

### 启动 `scripts/run.sh`

无参数。自动检测本机 NVIDIA（`nvidia-smi -L`、`/dev/nvidia0` 或 `/dev/nvidiactl`、内核模块 `nvidia`、`lspci` 含 nvidia 或 `10de`），有则起 GPU 容器，否则起 CPU 容器。监听 **9003**。

```bash
cd python/rapidocr_service
./scripts/run.sh
```

### 重启 `scripts/restart.sh`

无参数。检测逻辑与 `run.sh` 相同。先停掉 cpu/gpu 两个 profile 的容器（避免抢 9003），再按检测结果 `up -d --force-recreate --no-build`，**不重新构建镜像**。`OCR_WORKERS` 等环境变量在重启时生效。

```bash
cd python/rapidocr_service
./scripts/restart.sh
# 例如改 worker 后重启 GPU
OCR_WORKERS=1 ./scripts/restart.sh
```

### 压测 `bench/bench.py`

| 参数 | 说明 | 默认 |
|------|------|------|
| `--url` | OCR 接口 | `http://127.0.0.1:9003/ocr` |
| `--image` | 样图路径 | `bench/sample.png` |
| `--concurrency` | 并发数 | `4` |
| `--requests` | 总请求次数 | `20` |
| `--timeout` | 单次超时（秒） | `60` |

```bash
python3-dev bench/bench.py --concurrency 4 --requests 20
```

输出含：QPS、avg_ms、p50/p95/p99、success、failures。

### HTTP 调用（官方 RapidOCRAPI）

```bash
curl -F image_file=@bench/sample.png http://127.0.0.1:9003/ocr
```

也可用表单 `image_data` 传图片 base64。Swagger：`http://127.0.0.1:9003/docs`。

## 使用配置说明

包版本在 `versions.env`，两份 Dockerfile 构建时 `source` 该文件。升级版本后须重新构建，并确认 GPU 镜像仍将 `EngineConfig.onnxruntime.use_cuda` 设为 `true`。

手动指定 profile（不走本机检测）：

```bash
# CPU
docker-compose -f docker/compose.yml --profile cpu up -d --build

# GPU（必须能访问 NVIDIA 设备）
docker-compose -f docker/compose.yml --profile gpu up -d --build
```

仅构建：

```bash
docker-compose -f docker/compose.yml --profile cpu build
docker-compose -f docker/compose.yml --profile gpu build
```

Compose 端口映射：`9003:9003`。CPU / GPU 均用官方命令 `rapidocr_api`。CPU 默认 **4** 个 worker（`OCR_WORKERS`）；GPU 默认 **1**，减少多进程抢同一张卡。GPU 高并发时官方入口会在同一进程的线程池里并行推理，吞吐更高，但可能触发 CUDA 显存分配失败，可把 `OCR_WORKERS` 保持为 1 或调低客户端并发。构建 pip 默认国内源；临时换源覆盖 `PIP_INDEX_URL`。

GPU 镜像在构建时先按 CPU 配置下载模型，再改 RapidOCR 自带 `config.yaml` 的 `use_cuda`，这样无 GPU 的构建机也能完成预热。

## FAQ说明

**Q: 为什么不用官方 RapidOCRAPI Dockerfile？**  
A: 其仍安装旧包 `rapidocr-onnxruntime`，与当前 `from rapidocr import RapidOCR` 不一致，且没有 GPU。本目录只用 PyPI 的 `rapidocr_api` 命令。

**Q: 运行时可以断网吗？**  
A: 可以。构建阶段已执行 `RapidOCR()` 把默认 det/cls/rec 模型写入镜像。可用 `docker run --network none` 验证。

**Q: GPU 容器实际还在用 CPU？**  
A: 常见原因是未加 GPU 设备（compose 的 `deploy.resources.reservations.devices`）。没有 NVIDIA Container Toolkit 时，CUDA EP 不可用，RapidOCR 会打日志并退回 CPU。请看容器启动日志中的 provider。

**Q: 只装 `onnxruntime-gpu` 不够吗？**  
A: 不够。RapidOCR 默认 `use_cuda: false`。GPU Dockerfile 用 `docker/enable_ort_cuda.py` 只改 `EngineConfig.onnxruntime.use_cuda`，避免误改 Paddle/Torch 段。

**Q: 如何确认 GPU 配置已打开？**  
A: 进入 GPU 容器查看 `site-packages/rapidocr/config.yaml` 中 `onnxruntime` 段的 `use_cuda: true`。

**Q: GPU 高并发报 CUDA / onnxruntime 显存错误？**  
A: 官方 `rapidocr_api` 同一进程内会多线程推理。保持 `OCR_WORKERS=1`，或降低压测 `--concurrency`。不要用自研 uvicorn 包装。

**Q: AMD 显卡怎么办？**  
A: 本服务不支持 ROCm。无 NVIDIA 时 `run.sh` 走 CPU 镜像。

**Q: 会改水印去除脚本吗？**  
A: 不会。本目录独立，不修改 `python/watermark_remover/`。
