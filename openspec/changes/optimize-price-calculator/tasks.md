## 1. 计算引擎重构

- [x] 1.1 重构 `createDefaultActivities` 为 `{ coupon, timeLimit }`，删除 5 券互斥逻辑
- [x] 1.2 重写 `calcRow`：正向加价模型（实际成本→实际拼单价→活动→拼单价→单买价）
- [x] 1.3 实现扩展指标：实际利润、实际利润率、净保本/微付费/最佳投产比（最佳按实际利润率 >50% 用 ×1.4，≤50% 用 ×2）
- [x] 1.4 更新 `selfTestFormulas` 断言（5.94→实际拼单价 7.13 等新用例）

## 2. SKU 扫描与款式展示

- [x] 2.1 实现多规格列 carry-forward 拼接（` / ` 分隔）
- [x] 2.2 将成本字段重命名为采购成本，更新 `buildSkuRow` 与扫描初始值逻辑

## 3. UI 列布局与活动区

- [x] 3.1 重构表头/数据行：左 1 列 + 中间 11 列 + 右 3 列（含实际拼单价）
- [x] 3.2 更新 sticky CSS（sticky-1 款式换行；sticky-r3/r2/r1）
- [x] 3.3 简化活动区 UI 为「立减优惠券 + 限时限量购 + 回填」
- [x] 3.4 更新 `updateOutputsOnly` / `renderDataRows` 以输出全部新列
- [x] 3.5 采购成本列批量粘贴与表头批量设置字段名同步更新

## 4. 导入导出

- [x] 4.1 实现 `getGoodsMeta()`（goods_id + 商品标题）
- [x] 4.2 实现 `exportMarkdown()`：标题 + 活动配置 + SKU 表
- [x] 4.3 导出双通道：剪贴板复制 + 下载 `{goods_id}-{商品标题}.md`
- [x] 4.4 实现 `parseMarkdownExport()` 与款式匹配导入逻辑
- [x] 4.5 实现导入 UI（文件选择 + 粘贴 Markdown 弹窗）
- [x] 4.6 弹窗头部添加【导出】【导入】蓝色按钮

## 5. 文档与版本

- [x] 5.1 更新 `price_calculator.user.js` 版本号至 1.4.0
- [x] 5.2 更新 README：新公式、列说明、活动简化、导入导出 FAQ
