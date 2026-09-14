## Purpose

提供可 Docker 部署的 RapidOCR HTTP 服务：官方单图 OCR 接口、CPU/GPU 双镜像、构建后离线运行、按本机 NVIDIA 选镜像，以及命令行压测。

## ADDED Requirements

### Requirement: 独立脚本目录与说明

仓库 SHALL 在 `python/rapidocr_service/` 提供本能力的全部交付物。该目录 MUST 包含使用说明，且说明 MUST 覆盖环境依赖、脚本参数、使用配置与 FAQ。

#### Scenario: 目录可独立使用

- **WHEN** 使用者进入 `python/rapidocr_service/`
- **THEN** 可通过该目录内的说明完成构建、启动、调用与压测，无需阅读其它脚本目录

### Requirement: 官方单图 OCR 接口

服务 MUST 通过官方 `rapidocr_api` 暴露 HTTP 接口，不得自研替代路由。服务 MUST 接受单张图片的 `POST /ocr`：multipart 字段 `image_file`，或表单字段 `image_data`（图片 base64）。有文字时响应 MUST 为以文本块序号为键的对象，每项包含识别文本、检测框与置信度；无文字时 MUST 返回空对象。

#### Scenario: 上传文件识别成功

- **WHEN** 调用方对运行中的服务 `POST /ocr` 并附带含中文或英文的图片文件 `image_file`
- **THEN** 响应成功且 JSON 中至少含一个文本块，字段包含 `rec_txt`、`dt_boxes` 与 `score`

#### Scenario: 无文字图片

- **WHEN** 调用方上传一张无可检测文字的图片
- **THEN** 响应 JSON 为空对象 `{}`

#### Scenario: 缺少图片字段

- **WHEN** 调用方 `POST /ocr` 且既无 `image_file` 也无 `image_data`
- **THEN** 请求失败且不返回成功识别结果

### Requirement: CPU 与 GPU 独立镜像

项目 MUST 提供两个独立 Dockerfile：CPU 镜像与 GPU 镜像。CPU 镜像 MUST 能在无 NVIDIA GPU 的宿主机上启动并完成 OCR。GPU 镜像 MUST 在具备 NVIDIA 驱动与 NVIDIA Container Toolkit 的宿主机上使用 CUDA 推理。构建镜像时允许访问互联网。

#### Scenario: 构建 CPU 镜像

- **WHEN** 使用者按说明构建 CPU 镜像
- **THEN** 得到可独立运行的 CPU 镜像，启动后可响应 `POST /ocr`

#### Scenario: 构建 GPU 镜像

- **WHEN** 使用者按说明构建 GPU 镜像
- **THEN** 得到基于 CUDA 运行时的镜像，且默认启用 ONNX Runtime CUDA（`use_cuda` 为真）

#### Scenario: CPU 镜像无 GPU 也可识别

- **WHEN** 在无 NVIDIA GPU 的机器上启动 CPU 容器并对样图调用 `/ocr`
- **THEN** 服务返回识别 JSON，不要求 CUDA

### Requirement: 运行期离线

镜像构建阶段 MUST 将默认检测、方向分类、识别模型写入镜像。已构建镜像在运行时 MUST 能在无外网的情况下完成默认中英文 OCR，不得再下载模型。

#### Scenario: 断网识别

- **WHEN** 已构建的 CPU 或 GPU 容器以无网络方式启动，并对本地样图调用 `/ocr`
- **THEN** 识别成功且过程中不访问外网下载模型

### Requirement: 按本机 NVIDIA 选择镜像

项目 MUST 提供启动方式：检测本机是否存在可用 NVIDIA GPU（至少包括 `nvidia-smi` 能列出 GPU、存在 `/dev/nvidia0` 或 `/dev/nvidiactl`、已加载 `nvidia` 内核模块、`lspci` 含 nvidia 或厂商号 `10de` 中任一信号）。有 NVIDIA 时 MUST 启动 GPU 容器；否则 MUST 启动 CPU 容器。

#### Scenario: 本机有 NVIDIA

- **WHEN** 本机满足 NVIDIA 检测信号且 GPU 镜像已构建
- **THEN** 启动流程拉起 GPU 容器并监听 OCR 端口

#### Scenario: 本机无 NVIDIA

- **WHEN** 本机不满足 NVIDIA 检测信号且 CPU 镜像已构建
- **THEN** 启动流程拉起 CPU 容器并监听 OCR 端口

### Requirement: 命令行压测

项目 MUST 提供命令行压测脚本：对固定样图并发调用运行中服务的 `POST /ocr`，结束后 MUST 在标准输出打印至少包括 QPS、平均延迟、p50、p95、p99 与错误次数（或错误率）。脚本 MUST 支持配置服务地址、并发数与请求次数（或持续时间）。

#### Scenario: 对本地服务压测

- **WHEN** 服务已监听且使用者按说明运行压测脚本
- **THEN** 终端打印 QPS 与延迟分位，且不打开 Web 压测界面

### Requirement: 不侵入现有脚本

本能力 MUST 不修改 `python/watermark_remover/` 与其它已有脚本的行为。

#### Scenario: 水印工具保持原状

- **WHEN** 完成本 OCR 服务交付
- **THEN** 水印去除脚本的入口、依赖与 OCR 实现路径与本次变更前一致
