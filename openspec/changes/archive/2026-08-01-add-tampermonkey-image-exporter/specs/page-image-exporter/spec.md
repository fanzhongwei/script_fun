## ADDED Requirements

### Requirement: 右侧悬浮导出入口

脚本 SHALL 在匹配页面的右侧提供固定悬浮按钮，按钮文案为「导出图片」。点击该按钮 SHALL 打开图片导出面板；面板关闭后页面原有功能不受影响。

#### Scenario: 打开导出面板

- **WHEN** 用户点击右侧「导出图片」悬浮按钮
- **THEN** 系统展示图片导出面板，并开始发现当前页面图片

#### Scenario: 关闭导出面板

- **WHEN** 用户在导出面板中选择关闭
- **THEN** 面板消失，悬浮按钮仍保留在页面右侧

### Requirement: 发现页面图片

脚本 SHALL 从当前页面发现以下来源的图片 URL，并按绝对 URL 去重后展示：

1. `<img>` 元素的有效图片地址（含 `currentSrc`/`src` 及常见懒加载属性）
2. 元素 CSS `background-image` 中的 `url(...)` 资源（忽略 `none` 与纯渐变）

#### Scenario: 发现 img 与背景图

- **WHEN** 用户打开导出面板且页面同时存在 `<img>` 与 CSS 背景图
- **THEN** 面板中同时列出这两类来源的去重后图片

#### Scenario: URL 去重

- **WHEN** 同一图片 URL 同时出现在多个元素上
- **THEN** 面板中仅展示一次该图片

### Requirement: 缩略图平铺与复选

导出面板 SHALL 以约 200×200 像素的缩略图网格平铺展示发现的图片，每张图片 SHALL 支持复选。面板 SHALL 提供全选与取消全选能力。

#### Scenario: 平铺展示

- **WHEN** 发现至少一张图片
- **THEN** 图片以约 200×200 的网格平铺显示在导出面板中

#### Scenario: 复选图片

- **WHEN** 用户勾选或取消勾选某张缩略图
- **THEN** 该图片的选中状态相应更新

#### Scenario: 全选

- **WHEN** 用户触发全选
- **THEN** 当前列表中所有图片均为选中状态

### Requirement: 手动指定下载文件夹名

下载前，脚本 SHALL 要求用户手动输入本地文件夹名。脚本可用清理后的页面标题预填该输入框，但 MUST 允许用户修改。文件夹名为空时 SHALL 禁止开始下载并提示用户。

#### Scenario: 预填并可修改

- **WHEN** 导出面板打开
- **THEN** 文件夹名输入框可被预填，且用户可以修改为任意合法名称

#### Scenario: 空文件夹名不可下载

- **WHEN** 文件夹名为空且用户触发下载
- **THEN** 系统不执行下载，并提示需要填写文件夹名

### Requirement: 通过 GM_download 子路径批量下载

脚本 SHALL 使用油猴 `GM_download`，将每个选中图片保存为 `{文件夹名}/{文件名}`，从而下载到浏览器默认下载目录下的对应子文件夹。文件夹名与文件名中的非法字符 SHALL 被清洗。下载结束后 SHALL 向用户反馈成功与失败数量。

#### Scenario: 下载选中图片到子文件夹

- **WHEN** 用户已填写合法文件夹名、已选中至少一张图片并触发下载
- **THEN** 系统对每张选中图片调用 `GM_download`，目标路径为该文件夹名下的文件

#### Scenario: 未选中图片时不下载

- **WHEN** 用户未选中任何图片并触发下载
- **THEN** 系统不执行下载，并提示需要先选择图片

#### Scenario: 下载结果反馈

- **WHEN** 一批下载尝试完成
- **THEN** 系统展示成功与失败的数量（或等价可见反馈）

### Requirement: 脚本目录与说明文档

仓库 SHALL 在 `tampermonkey/image_exporter/` 下提供用户脚本文件与 README。README MUST 包含：环境依赖说明、脚本参数说明、使用配置说明、FAQ 说明。

#### Scenario: 目录结构完整

- **WHEN** 本变更实现完成
- **THEN** 存在 `tampermonkey/image_exporter/` 目录，内含 `.user.js` 脚本与符合仓库规范的 README
