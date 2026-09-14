## 1. Vendor 与适配

- [x] 1.1 在 `python/rapidocr_service/web/` 放入官方 RapidOCRWeb 运行所需文件（Flask 入口、templates、static、许可证说明），不包含 `ocrweb_multi` 与打包 spec，并确认目录可被 Python 找到
- [x] 1.2 改 `task.py`：去掉进程内 `RapidOCR()`，将 data URL 转为对 `RAPIDOCR_API_URL` 的 `POST /ocr`（`image_data` 或 `image_file`），用返回的 `dt_boxes`/`rec_txt`/`score` 画框并填充 `OCRWebOutput`；API 不可用时识别失败
- [x] 1.3 增加映射自检（无 Flask、无真实 API）：样例 API JSON 转出的 `rec_res` 含预期文本，用 `python3-dev` 运行且退出码为 0

## 2. Compose 与镜像

- [x] 2.1 新增 Web Dockerfile：基础镜像 `python:3.12-slim-bookworm`，安装 `Flask==3.0.0` 与 `opencv-python-headless==4.10.0.84`（及 `libglib2.0-0`/`libgomp1`/`libgl1`），不安装 `rapidocr`/`rapidocr_api`，默认监听 9004
- [x] 2.2 修改 `docker/compose.yml`：增加 `web`（`profiles: [cpu, gpu]`，volume 挂 `web/`，`9004:9004`，`RAPIDOCR_API_URL=http://ocr-api:9003/ocr`）；`cpu`/`gpu` 增加网络别名 `ocr-api`；二者 command 与 9003 映射保持不变

## 3. 启动脚本与说明

- [x] 3.1 更新 `scripts/run.sh` 与 `scripts/restart.sh`：现有 NVIDIA 选路不变，拉起对应 profile 时包含 web，结束时打印 Web 地址（9004）与原 API 地址（9003）
- [x] 3.2 更新 `README.md`：环境依赖、参数、配置与 FAQ 覆盖 Web 与 API 关系、端口、volume 挂载，且不改变官方 `POST /ocr` 调用说明

## 4. 行为核对

- [x] 4.1 确认 9003 的 `POST /ocr` 仍可用（对 `bench/sample.png` 上传 `image_file` 得到含 `rec_txt` 的 JSON）
- [x] 4.2 确认 Web 根路径返回 HTML 页面，且对同源 `/ocr` 提交官方 JSON 后响应含 `rec_res`（需 API 已就绪）
