## Why

拼多多商家后台跨商品复制时，现有脚本只能分别完成「图片导出」「规格粘贴」「价格计算」，中间的上传图片、清理旧规格、选择规格类型、导入 Excel、批量上传预览图等步骤仍需大量手工操作。需要一条与 `image_exporter` 一键导出对称的「商品包导入」能力，使用户在目标商品页选择导出文件夹后，自动完成除价格计算外的铺货步骤。

## What Changes

- 新增 Tampermonkey 脚本「拼多多商品包导入器」（`tampermonkey/pdd_product_importer/`），在 `mms.pinduoduo.com` 商品编辑页提供「导入商品包」入口
- 用户通过 File System Access API 选择由 `image_exporter` 导出的商品根目录，脚本读取 `manifest.json` 并按固定流水线执行
- 轮播图、详情图：删除已有图片中除第一张以外的项，再上传 manifest 中的对应文件
- 规格：删除全部已有规格类型；按 manifest 顺序添加规格类型并批量填充规格值；规格类型匹配失败时中断后续步骤
- Excel：在「Excel 批量编辑规格」弹窗中导入 `成本表.xlsx`，不点击保存草稿（平台自动更新规格）
- 预览图：已有预览图的 SKU 行先删除再上传；利用平台每 12 张一批的本地上传能力，从第 1、13、25… 行触发批量上传
- 结束后展示分条目汇总弹窗（成功/部分成功/失败/跳过/中断）
- 增强 `image_exporter`：一键导出时写入 `manifest.json`（含规格类型、规格值、图片路径、预览图全局序号与款式文本）
- **修复（DOM 漂移）**：轮播区优先点击右上角 `DeleteIcon` 删图；满槽后重新定位「本地上传」/ `input[type=file]`，避免「未找到轮播图上传入口」
- **过滤无效图**：导出与导入双侧过滤「文本暂无预览」类占位图及短边 &lt; 480px 的图片，避免详情图假成功、平台尺寸校验失败

## Capabilities

### New Capabilities

- `pdd-product-importer`：拼多多商家后台商品包导入：选文件夹、六步流水线编排、12 张分批预览图上传、fatal 中断与汇总弹窗

### Modified Capabilities

- `page-image-exporter`：拼多多一键导出时额外生成 `manifest.json`，采集规格维度类型名、规格值、预览图款式与全局序号，与导入器契约对齐

## Impact

- 新增目录：`tampermonkey/pdd_product_importer/`（脚本 + README）
- 修改：`tampermonkey/image_exporter/image_exporter.user.js` 及 README（manifest 写出）
- 逻辑复用（不合并文件）：`spec_paste` 规格填充、SKU 表格高度设置思路（与 price_calculator / image_exporter 一致）、`image_exporter` 拼多多 DOM 锚点与 12 张分桶规则
- 依赖环境：Chrome/Edge + Tampermonkey；File System Access API 选目录；仅 `mms.pinduoduo.com`
- 不影响 `linux/`、`python/` 及 `spec_paste`、`price_calculator` 既有行为（price_calculator 仍为导入后人工算价步骤）
