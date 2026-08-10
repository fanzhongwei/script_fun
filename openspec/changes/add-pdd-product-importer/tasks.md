## 1. image_exporter：manifest 写出

- [x] 1.1 定义 manifest v1 结构与 JSON 序列化工具函数
- [x] 1.2 导出时从 DOM 采集 `specDimensions`（typeLabel + values）
- [x] 1.3 导出时采集 preview 的 index、相对 file 路径、style 文本
- [x] 1.4 一键导出成功后将 `manifest.json` 写入导出根目录（FS API / 与现有下载路径一致）
- [x] 1.5 更新 `tampermonkey/image_exporter/README.md`（manifest 说明、与导入器配合）

## 2. pdd_product_importer：脚本骨架

- [x] 2.1 创建 `tampermonkey/pdd_product_importer/` 目录
- [x] 2.2 新增 `pdd_product_importer.user.js` 元数据（`@match mms.pinduoduo.com`、FAB 位置）
- [x] 2.3 实现 FS API 选文件夹 + manifest 校验
- [x] 2.4 实现编排器框架（步骤枚举、结果收集、fatal abort 标志）

## 3. 轮播图与详情图

- [x] 3.1 实现轮播区枚举与删第 2+ 张（从后往前）
- [x] 3.2 实现详情区枚举与删第 2+ 张
- [x] 3.3 实现 `assignFilesToInput` / DataTransfer 一次注入轮播/详情全部文件
- [x] 3.4 接入 manifest 路径 → File[] 读取与步骤结果记录

## 4. 规格：删旧、加类型、填值

- [x] 4.1 实现删除全部规格类型（从后往前，含确认弹窗处理）
- [x] 4.2 实现「添加规格类型」+ 选择器 trim 全等匹配 typeLabel
- [x] 4.3 复用 spec_paste 核心填充逻辑（等增行、去重、blur 焦点处理）
- [x] 4.4 匹配失败触发 fatal abort，跳过后续步骤

## 5. Excel 导入

- [x] 5.1 定位并打开「Excel 批量编辑规格」弹窗（复用 exporter 思路）
- [x] 5.2 定位导入/上传入口并注入 `成本表.xlsx`
- [x] 5.3 等待导入完成信号；明确不点击保存草稿

## 6. 预览图分批上传

- [x] 6.1 实现 SKU 表格高度校验（已正确则跳过，否则设为 N×70px + 清 spacer）
- [x] 6.2 按 manifest preview index 分 12 张/批
- [x] 6.3 每批：删已有预览图 → 首行触发批量本地上传
- [x] 6.4 批间等待与 partial 结果记录

## 7. 汇总弹窗与文档

- [x] 7.1 实现分步骤汇总模态框（success/partial/failed/skipped/aborted）
- [x] 7.2 实现执行中进度展示与「复制报告」
- [x] 7.3 编写 `tampermonkey/pdd_product_importer/README.md`（环境、参数、配置、FAQ）
- [x] 7.4 端到端自检：导出包 → 目标页导入 → 汇总正确；规格类型失败中断路径

## 8. Spike（实现前 DOM 验证）

- [x] 8.1 录制预览图删除按钮 DOM 样本
- [x] 8.2 确认 Excel 弹窗「导入」按钮文案与 file input
- [x] 8.3 确认规格类型选择器（标准/自定义）DOM 与匹配方式
