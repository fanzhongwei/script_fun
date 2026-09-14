# rapidocr-service

## Purpose

提供可 Docker 部署的 RapidOCR HTTP 服务：官方单图 OCR 接口、CPU/GPU 双镜像、构建后离线运行、按本机 NVIDIA 选镜像、浏览器 OCR 页面（转发官方 API），以及命令行压测。

## Requirements

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

### Requirement: 浏览器 OCR 页面

项目 MUST 提供浏览器可访问的 OCR 页面：支持选择文件、拖拽或剪贴板上传图片，展示识别文本、置信度，并支持复制识别文本。页面 MUST 走与官方 RapidOCRWeb v1 相同的浏览器协议：`POST` 页面同源的 `/ocr`，JSON 请求体含 `file`（data URL），成功响应含画框后的 `image`、`rec_res`（文本块序号、文本、置信度）。`total_elapse` 与 `elapse_part` 若 API 未提供分阶段耗时，MUST 仍返回可被页面解析的值（总耗时可用请求往返时间；分阶段可为空或全零，页面按官方逻辑显示）。

#### Scenario: 打开页面

- **WHEN** 使用者在浏览器访问 Web 服务根路径
- **THEN** 得到 OCR 上传页面而非 API 欢迎 JSON

#### Scenario: 上传图片识别

- **WHEN** 使用者在页面提交一张含文字的图片且 API 服务可用
- **THEN** 页面展示识别文本列表，并更新为带检测框的结果图

#### Scenario: 复制识别文本

- **WHEN** 识别成功且页面展示结果
- **THEN** 使用者可以复制全部或单条识别文本

### Requirement: Web 转发官方 OCR 接口

Web 服务 MUST 将识别请求转发到本项目已部署的官方 `rapidocr_api` 的 `POST /ocr`（`image_file` 或 `image_data`），不得在 Web 进程内加载 RapidOCR 推理引擎。Web 与 API MUST 使用不同监听端口；API 默认仍为 9003，Web 默认 9004。官方 API 的请求与响应契约 MUST 保持现有行为，不因增加 Web 而变更。

#### Scenario: 推理发生在 API 侧

- **WHEN** 页面完成一次成功识别
- **THEN** 实际 OCR 由 9003 上的 `rapidocr_api` 完成，Web 进程不初始化 RapidOCR 模型

#### Scenario: API 契约不变

- **WHEN** 调用方仍对 9003 使用 `curl -F image_file=@样图 POST /ocr`
- **THEN** 响应形状与增加 Web 之前一致（有字为序号对象，无字为空对象）

#### Scenario: API 不可用

- **WHEN** Web 已启动但无法连上 `POST /ocr`
- **THEN** 页面对应识别请求失败且不假装识别成功

### Requirement: 启动时同时提供页面

按本机 NVIDIA 选择 CPU 或 GPU 容器启动或重启时，MUST 同时启动 Web 服务。Compose MUST 将 Web 源码以 volume 挂载进 Web 容器，便于改 UI 适配逻辑而无需重建 OCR 镜像。CPU 与 GPU 服务 MUST 在同一 Docker 网络上使用固定主机名供 Web 访问 API，避免 Web 绑定某一个 profile 服务名。

#### Scenario: 有 NVIDIA 时带页面启动

- **WHEN** 本机满足 NVIDIA 检测且使用者执行启动脚本
- **THEN** GPU OCR 与 Web 均在运行，浏览器可打开 Web 端口，识别走 GPU 容器的 `/ocr`

#### Scenario: 无 NVIDIA 时带页面启动

- **WHEN** 本机不满足 NVIDIA 检测且使用者执行启动脚本
- **THEN** CPU OCR 与 Web 均在运行，识别走 CPU 容器的 `/ocr`

#### Scenario: 说明覆盖 Web

- **WHEN** 使用者阅读 `python/rapidocr_service/` 内说明
- **THEN** 能获知 Web 端口、与 API 的关系、环境依赖、参数与 FAQ
