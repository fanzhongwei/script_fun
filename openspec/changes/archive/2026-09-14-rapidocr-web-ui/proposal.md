## Why

现有 RapidOCR 服务只提供 `POST /ocr`，浏览器无法用官方 RapidOCRWeb 页面上传、预览画框和复制文本。官方 Web 与 API 的 HTTP 契约不同，不能把源码原样挂进 9003 容器；需要一个独立 Web 服务把官方 UI 接到已有 9003 接口上。

## What Changes

- 在 `python/rapidocr_service/` 内引入改造后的 RapidOCRWeb（基于官方 v1 / RapidOCR v3 前端与 Flask），浏览器协议保持官方 JSON `{ file }` / `{ image, total_elapse, elapse_part, rec_res }`。
- 新增 compose `web` 服务：源码 volume 挂载，识别请求转发到现有 `cpu`/`gpu` 的 `POST /ocr`，本进程不加载 RapidOCR 模型。
- `cpu`/`gpu` 的官方 `rapidocr_api` 端口、路由与响应保持不变（非 **BREAKING**）。
- 启动/重启脚本在拉起 CPU 或 GPU 的同时拉起 Web；说明文件补充 Web 端口、依赖与 FAQ。

## Capabilities

### New Capabilities

- （无）Web 属于现有 RapidOCR 服务交付范围，不另立能力名。

### Modified Capabilities

- `rapidocr-service`：增加浏览器 OCR 页面能力；compose 与启动流程增加 Web 服务；官方单图 API 行为不变。

## Impact

- 代码：`python/rapidocr_service/docker/compose.yml`、`scripts/run.sh`、`scripts/restart.sh`、`README.md`；新增 Web 源码目录（官方 RapidOCRWeb 精简 + `task.py` 转发）。
- API：9003 上 `rapidocr_api` 不变；Web 另开端口（默认 9004）。
- 依赖：Web 镜像只需 Flask 与 OpenCV 等画框/服务依赖，不安装 `rapidocr` / `rapidocr_api`。
- 不影响 `python/watermark_remover/` 及其它脚本目录。
