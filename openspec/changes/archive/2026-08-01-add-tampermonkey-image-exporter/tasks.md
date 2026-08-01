## 1. 目录与脚本骨架

- [x] 1.1 创建 `tampermonkey/image_exporter/` 目录
- [x] 1.2 新增 `image_exporter.user.js`，编写 Tampermonkey 元数据头（`@match`、`GM_download` 等 `@grant`）
- [x] 1.3 注入右侧「导出图片」悬浮按钮的基础 DOM/CSS

## 2. 图片发现与面板 UI

- [x] 2.1 实现 `<img>` 图片 URL 收集（含 `currentSrc`/`src` 与常见懒加载属性）
- [x] 2.2 实现 CSS `background-image` 的 `url(...)` 解析与收集
- [x] 2.3 实现 URL 去重与无效项过滤
- [x] 2.4 实现导出面板：200×200 平铺缩略图、复选、全选/取消全选、关闭
- [x] 2.5 实现文件夹名输入框（可用清理后的 `document.title` 预填，允许修改；空值校验）

## 3. 批量下载

- [x] 3.1 实现文件夹名/文件名非法字符清洗与重名序号处理
- [x] 3.2 使用 `GM_download` 按 `{文件夹名}/{文件名}` 下载选中图片
- [x] 3.3 汇总并展示下载成功/失败数量；未选中时提示

## 4. 文档与仓库说明

- [x] 4.1 编写 `tampermonkey/image_exporter/README.md`（环境依赖、脚本参数、使用配置、FAQ）
- [x] 4.2 视需要更新根 `README.md` 中 Tampermonkey 分类说明
- [x] 4.3 自检：脚本元数据完整、核心流程可手动验证、不改动既有 linux/python 脚本
