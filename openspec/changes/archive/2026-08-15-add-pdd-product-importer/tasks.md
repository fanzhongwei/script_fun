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

## 9. 修复：无效图过滤 + 轮播上传入口

- [x] 9.1 image_exporter：轮播/详情采集过滤 DOM 占位文案与短边 &lt; 480px（含 URL 探测）
- [x] 9.2 image_exporter：更新 README（占位图/尺寸过滤说明）
- [x] 9.3 importer：删除优先 `DeleteIcon`；轮播卡片选择器兼容 imageBox/imageWrapper
- [x] 9.4 importer：轮播/详情上传入口多策略定位（tracking /「本地上传」/ 区域内 file input），满槽删后再等
- [x] 9.5 importer：上传前过滤短边 &lt; 480px 文件，步骤详情记录跳过数
- [x] 9.6 importer：更新 README FAQ；语法自检

## 10. 修复：详情删首张 + 规格 DOM + 滚动定位

- [x] 10.1 详情图：上传成功后删除保留的首张旧图；增强详情卡片 DeleteIcon 识别
- [x] 10.2 规格：`.goods-spec-row-right` 删除 + `添加规格类型(1/2)` 按钮
- [x] 10.3 各步骤 `scrollIntoView` 定位对应模块
- [x] 10.4 image_exporter：修复 typeLabel 误导出为「规格」

## 11. 修复：详情槽位删除 + 规格确认弹窗

- [x] 11.1 详情：`Grid_rowWrap > div` 槽位识别（「预览 更换 N」）；悬停找 DeleteIcon
- [x] 11.2 详情：上传后按 pre-upload 遗留数清理历史图
- [x] 11.3 规格：MDL 弹窗确认按钮匹配「删除」

## 12. 修复：MouseEvent 沙箱 + 详情 DeleteIcon_v2

- [x] 12.1 移除 Tampermonkey 下 `MouseEvent({ view: window })` 致命错误
- [x] 12.2 详情槽位改为 `ImageWithRemark_v2_imageContainer` + `DeleteIcon_v2`

## 13. 修复：规格 ST 下拉框 + 详情清理计数

- [x] 13.1 exporter：`typeLabel` 从 `#spec.parentSpecArr[n].spec_id` ST 下拉框读取
- [x] 13.2 importer：添加规格后在新行 ST 下拉框选/填 typeLabel，再填规格值
- [x] 13.3 详情：清理历史张数 = 上传前删除 + 上传后删除

## 14. Excel 导入双次确认编辑

- [x] 14.1 上传后自动点「确认编辑项」弹窗的「确认编辑」
- [x] 14.2 再点空值提示 Popover 上的「确认编辑」

## 15. SKU 空库存补 0

- [x] 15.1 Excel 导入后扫描 `td.sku-input.quantity` 空值并填 0
- [x] 15.2 虚拟表格展开后分批滚动补全
