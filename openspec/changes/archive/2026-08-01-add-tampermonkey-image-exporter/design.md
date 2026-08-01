## Context

仓库 `script_fun` 按「每个脚本一个目录 + README」组织脚本；根 README 已预留 `tampermonkey/`，但目录尚未创建。本变更新增首个 Tampermonkey 用户脚本：在任意网页发现图片、复选预览、并按用户指定文件夹名批量下载到本地。

约束：

- 说明文件需包含：环境依赖、脚本参数、使用配置、FAQ
- 变更范围最小化，不影响 `linux/`、`python/` 既有脚本
- 浏览器安全模型不允许脚本静默写入任意路径；批量「子文件夹」依赖 `GM_download` 的文件路径前缀能力

## Goals / Non-Goals

**Goals:**

- 提供右侧悬浮「导出图片」入口
- 发现当前页 `<img>` 与 CSS `background-image` 中的图片 URL，去重后以 200×200 平铺展示
- 支持复选、全选/取消全选
- 下载前由用户手动输入文件夹名；通过 `GM_download` 将文件保存为 `{文件夹名}/{文件名}`（方案 B）
- 落盘目录：`tampermonkey/image_exporter/`（脚本 + README）

**Non-Goals:**

- 不做 ZIP 打包、不做 File System Access API 选目录
- 不解析 canvas / SVG 内嵌位图 / blob 动态绘制结果（非 URL 类资源）
- 不做图片编辑、压缩、格式转换
- 不针对单一站点做专用爬取逻辑（保持通用 `@match`）

## Decisions

### 1. 目录与命名

- **决策**：`tampermonkey/image_exporter/image_exporter.user.js` + `README.md`
- **理由**：与仓库「一脚本一目录」及 README 中 `tampermonkey/` 分类一致；`.user.js` 便于油猴识别元数据头

### 2. 脚本元数据与权限

- **决策**：`@match *://*/*`；申请 `@grant GM_download`、`@grant GM_xmlhttpRequest`（若实现需要）、必要时 `@grant GM_notification`
- **理由**：通用页面增强；跨域图片下载常需油猴 API 绕过页面 CORS
- **备选**：收窄 `@match` — 通用性差，否决

### 3. 图片发现范围

- **决策**：
  - `<img>`：取 `currentSrc` 或 `src`，并检查常见懒加载属性（如 `data-src`、`data-original`）
  - CSS：遍历可见元素计算样式（或内联/样式表中的 `background-image`），解析 `url(...)`，忽略 `none` / `gradient`
- **理由**：覆盖用户明确要求的两类来源
- **过滤**：去除空 URL、`data:` 极小占位可按策略保留或跳过；按绝对 URL 去重；可过滤明显 1×1 尺寸的 `<img>`

### 4. UI 交互

- **决策**：固定右侧悬浮按钮；点击后全屏/半屏遮罩面板，CSS Grid 200×200 缩略图 + checkbox；面板内提供「文件夹名」输入框（默认可用清理后的 `document.title` 预填，但允许用户修改）、全选、下载选中、关闭
- **理由**：文件夹名手动输入更通用；预填 title 减少输入成本且不强制

### 5. 下载方案 B：`GM_download` 子路径

- **决策**：对每个选中 URL 调用 `GM_download({ url, name: `${folder}/${filename}` })`；`folder` 经非法字符清洗（Windows：`\ / : * ? " < > |` 等）
- **文件名**：从 URL 路径取 basename，冲突时追加序号；无法解析时用 `image_N.ext`
- **理由**：用户选定方案 B，无需引入 JSZip；实现简单
- **备选**：ZIP / showDirectoryPicker — 已明确不做

### 6. 跨域与失败处理

- **决策**：优先 `GM_download` 直接按 URL 下载；失败时可选经 `GM_xmlhttpRequest` 拉取 blob 再下（若油猴环境支持）；UI 汇总成功/失败数量
- **理由**：部分 CDN 有防盗链，无法保证 100% 成功，需可见反馈

## Risks / Trade-offs

- [部分浏览器/油猴版本不保留 `name` 中的子目录] → README FAQ 说明需开启「允许保存到子文件夹」类设置；失败时回退为扁平文件名并提示
- [CSS background 扫描性能（大 DOM）] → 限制扫描元素数量或仅扫描带 `background-image` 的样式；打开面板时再扫描，不常驻轮询
- [跨域 / 防盗链导致下载失败] → 展示失败列表；文档说明可能需站点 cookie/referer（能力受限）
- [懒加载未触发导致漏图] → 优先读 `data-*` 懒加载属性；FAQ 提示先滚动加载完再导出
- [文件夹名非法或为空] → 校验非空 + 清洗；非法时提示用户修改

## Migration Plan

- 新建 `tampermonkey/image_exporter/` 与脚本、README；可选同步根 README 脚本列表
- 无数据迁移；卸载即删除油猴中的脚本即可回滚

## Open Questions

- Violentmonkey 对 `GM_download` 子路径的支持差异是否需在 README 中单独标注（实现时按实测补充）
- `data:` URL 是否默认纳入发现列表（建议：纳入但体积过大时警告；实现阶段可取默认纳入）
