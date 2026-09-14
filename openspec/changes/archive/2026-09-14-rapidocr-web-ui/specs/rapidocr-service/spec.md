## ADDED Requirements

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
