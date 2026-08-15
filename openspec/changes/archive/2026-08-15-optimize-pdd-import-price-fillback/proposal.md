## Why

商品包导入与价格计算是跨商品铺货流水线的后半段。当前轮播图删除仍用「静态列表 + 从后往前 + 350ms 间隔」，与已验证可用的详情图快删策略不一致，多张图时慢且易因 DOM 重排漏删；价格计算器默认参数（目标利润率 20%、立减券 0 元）与运营习惯不符；回填 SKU 价格后仍需手工填写「商品参考价」，打断一键铺货体验。

## What Changes

- **轮播图快删（importer）**：导入商品包时，轮播区删第 2 张及以后的方式对齐详情图——每轮重新枚举卡片，始终点第 2 张右上角 `DeleteIcon`，间隔 40ms，React 友好点击
- **价格计算器默认值**：目标利润率默认 **30%**（原 20%）；立减优惠券默认 **5 元**（原 0 元）
- **回填商品参考价**：价格计算器「回填」成功写入 SKU 拼单价/单买价后，自动将 `#market_price`「商品参考价」设为 **所有有效 SKU 单买价最大值 + 2**（无有效单买价时跳过）
- 同步更新两个脚本 README 及对应 OpenSpec 行为说明

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pdd-product-importer`：轮播图删旧策略由「从后往前慢删」改为「从第 2 张起连续快删」，与详情图一致
- `price-calculator`：默认值调整；回填流程增加商品参考价自动写入

## Impact

- 修改：`tampermonkey/pdd_product_importer/pdd_product_importer.user.js` 及 README（轮播删图逻辑）
- 修改：`tampermonkey/price_calculator/price_calculator.user.js` 及 README（默认值、回填后写参考价）
- 不影响：`image_exporter`、`spec_paste`、manifest 契约、Excel/预览图导入流水线
- 依赖：拼多多商家后台 DOM（`MaterialModalButton_v2_imageWrapper`、`#market_price` 输入框）保持稳定
