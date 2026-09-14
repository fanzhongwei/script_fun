## 1. 目录与版本钉死

- [x] 1.1 创建 `python/rapidocr_service/`（`docker/`、`scripts/`、`bench/`），确认无自研 `app/` 路由代码
- [x] 1.2 增加 `versions.env`（或 Dockerfile ARG）钉死 `rapidocr_api`、`rapidocr`、`onnxruntime` / `onnxruntime-gpu` 版本，两份 Dockerfile 引用同一组版本号

## 2. CPU / GPU 镜像

- [x] 2.1 编写 `docker/Dockerfile.cpu`：slim Python 3.10、安装钉死版本的 `rapidocr_api` 与 `onnxruntime`、构建期预热默认模型、`CMD rapidocr_api -ip 0.0.0.0 -p 9003`；构建成功且镜像内存在 det/cls/rec 模型文件
- [x] 2.2 编写 `docker/Dockerfile.gpu`：CUDA 12.4.1 cudnn runtime 基础镜像、Python 3.10、卸载 CPU `onnxruntime` 后安装 `onnxruntime-gpu`、将 `rapidocr` 默认 `config.yaml` 的 `EngineConfig.onnxruntime.use_cuda` 改为 `true`、构建期下载模型（构建机无 GPU 时不得因 CUDA session 失败而缺少模型文件）
- [x] 2.3 编写 `docker/.dockerignore` 与 `docker/compose.yml`（profile `cpu` / `gpu`，端口 9003，GPU 服务带 NVIDIA device 预留，GPU workers 默认 1）

## 3. 本机启动

- [x] 3.1 实现 `scripts/run.sh`：用与水印工具同类的 NVIDIA 信号选择 compose profile，有 NVIDIA 则 `--gpus` 起 GPU，否则起 CPU；无卡机器上执行后容器监听 9003

## 4. 压测

- [x] 4.1 放入 `bench/sample.png`（小幅中英样图）
- [x] 4.2 实现 `bench/bench.py`（宿主机 `python3-dev`）：`--url`、`--image`、`--concurrency`、`--requests`，multipart `POST /ocr`，结束后打印 QPS、avg、p50、p95、p99、失败数

## 5. 文档

- [x] 5.1 编写 `README.md`：环境依赖（Docker、NVIDIA toolkit）、构建/启动参数、compose 配置、压测参数、FAQ（官方 Dockerfile 不用、离线运行、未加 `--gpus` 会静默 CPU、config.yaml 与钉版本）

## 6. 验证

- [x] 6.1 构建 CPU 镜像并启动，对 `bench/sample.png` 调用 `/ocr`，得到含 `rec_txt` 的 JSON；再以无网络启动同一镜像仍能识别
- [x] 6.2 若本机有 NVIDIA：构建并启动 GPU 镜像，确认配置中 `use_cuda` 为 true 且 `/ocr` 成功；无 NVIDIA 时 `run.sh` 走 CPU 且不修改 `watermark_remover`
- [x] 6.3 对运行中服务执行 `bench/bench.py`，终端出现 QPS 与延迟分位
