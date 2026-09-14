## Context

现有 `python/rapidocr_service` 用 compose profile 互斥启动 `cpu` 或 `gpu`，入口均为官方 `rapidocr_api` 监听 9003。官方 RapidOCRWeb（v1，`feat: adapt rapidocr v3`）是 Flask 页面：浏览器 `POST /ocr` JSON `{file: dataURL}`，进程内 `RapidOCR()`，再拼 `{image, total_elapse, elapse_part, rec_res}`。该 HTTP 契约与 `rapidocr_api` 不同，不能把 Web 源码挂进现有 OCR 容器替代 PID 1。动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 独立 Web 容器 + volume 挂源码，转发到 9003。
- 浏览器仍用官方前端，只改服务端适配。
- CPU/GPU 选路与 API 镜像、worker、离线模型策略不动。

**Non-Goals:**

- 不改 `rapidocr_api` 源码、不把页面打进 OCR 镜像。
- 不恢复 API 未返回的 det/cls/rec 分阶段真实耗时。
- 不引入反向代理、Supervisor、同容器双进程。
- 不修改 `watermark_remover` 等其它目录。

## Decisions

### 1. Web 独立服务，OCR 镜像不装 Flask

- **选择**：新增 compose 服务 `web`。基础镜像优先 **`python:3.12-slim-bookworm`**（与 CPU OCR 同主版本 3.12）。本机构建若因镜像源 TLS 证书无法拉取 slim，则回退已有的 **`python:3.12-bookworm`**（与 `Dockerfile.cpu` 相同，无需重新拉基础镜像）。pip 钉死 **`Flask==3.0.0`**（官方 RapidOCRWeb：`Flask>=2.1.0,<=3.0.0`）、**`opencv-python-headless==4.10.0.84`**（画框；系统包补 `libglib2.0-0`、`libgomp1`、`libgl1`）。**不安装** `rapidocr` / `rapidocr_api` / `onnxruntime`。`cpu`/`gpu` command 仍是 `rapidocr_api`。
- **理由**：OCR 镜像已为推理钉死版本；Web 无模型，重建成本低。挂载源码只影响 Web。能拉到 slim 时更小；拉不到时与 CPU 共用已缓存的 bookworm，不阻塞交付。
- **备选**：同容器双进程 → 健康检查与退出信号变复杂；浏览器直打 9003 → 要改前端协议并开 CORS，画框丢失。

### 2. 只改 `task.py` 适配，静态资源保持官方 v1

- **选择**：vendor 官方 `rapidocr_web` 的 Flask 入口、templates、static；`OCRWebUtils` 改为：解码 data URL → `POST image_data` 到 API → 用 `dt_boxes` 画框 → 填 `OCRWebOutput`。不装 `rapidocr`。
- **理由**：v3 适配已让 Web 消费 `boxes/txts/scores`，与 API 的 `dt_boxes/rec_txt/score` 可一一映射。
- **备选**：重写 `index.html` 直调 API → 工作量大且丢失画框。

### 3. 网络别名 `ocr-api`，Web 走两个 profile

- **选择**：`cpu` 与 `gpu` 均设置 network alias `ocr-api`。`web` 的 `profiles: [cpu, gpu]`，环境变量 `RAPIDOCR_API_URL=http://ocr-api:9003/ocr`。端口 `9004:9004`。
- **理由**：`--profile gpu up` 只会起 gpu+web；Web 不必写死服务名 `cpu` 或 `gpu`。无 profile 的 web 在裸 `compose up` 时会单独起来却连不上 API。
- **备选**：`depends_on: [cpu, gpu]` 会在单 profile 下拉起未启用的一侧。

### 4. 耗时字段降级

- **选择**：`total_elapse` 用 Web→API 的 HTTP 耗时；`elapse_part` 空或 `0,0,0`（前端已有 fallback）。
- **理由**：官方 API 不返回 `elapse_list`，改 API 超出范围。

### 5. 自检

- **选择**：对「API JSON → `OCRWebOutput`」做一段无服务的映射自检（样例 dict → 断言 `rec_res` 含文本）。转发与画框用现有 bench 样图在 compose 起来后手工/curl 验证页面 `/ocr`。
- **理由**：符合 ponytail：非平凡逻辑留一个会失败的检查，不引入测试框架。

## Risks / Trade-offs

- [API 未就绪] → Web 识别失败 → `run.sh` 仍先起 OCR；Web 对 API 超时返回错误，不伪造成功。
- [3MB 前端限制 vs API 20MB] → 保持官方页面 3MB，避免悄悄放大行为。
- [画框依赖 OpenCV] → Web 镜像装 headless OpenCV，比纯静态页多重，但可保留官方红框图。
- [vendor 官方 UI 与上游分叉] → 只保留运行所需文件并注明来源/许可证；不跟踪 `ocrweb_multi` 与打包 spec。

## Migration Plan

- 已在跑的仅 API 用户：重新 `run.sh` 或多一个 web 容器；9003 行为不变。
- 回滚：compose 去掉 `web`、恢复脚本 echo；删除 vendor 目录即可，无需重建 OCR 镜像。

## Open Questions

无（端口 9004、alias `ocr-api`、只改 `task.py` 已在探索中确认）。
