## 1. 轮播图快删（pdd_product_importer）

- [x] 1.1 新增 `deleteCarouselImagesExceptFirst()`：循环重查 `getCarouselImageBoxes()`，删 `boxes[1]` 的 DeleteIcon，`clickDeleteIconFast` + 40ms，guard 50
- [x] 1.2 `stepCarousel` 将 `deleteImagesExceptFirst(getCarouselImageBoxes())` 替换为新函数
- [x] 1.3 确认 `deleteImagesExceptFirst` 无其他调用或保留给非轮播场景；清理冗余逻辑
- [x] 1.4 更新 `tampermonkey/pdd_product_importer/README.md`：轮播删图策略与详情图一致（第 2 张起连续快删）

## 2. 价格计算器默认值

- [x] 2.1 `DEFAULTS.targetMargin` 改为 30
- [x] 2.2 `createDefaultActivities().coupon.amount` 改为 5
- [x] 2.3 更新 `tampermonkey/price_calculator/README.md` 默认值说明（目标利润率 30%、立减券 5 元）

## 3. 回填商品参考价

- [x] 3.1 实现 `fillMarketReferencePrice(targets)`：max(单买价)+2，定位 `#market_price` 输入框，React 友好写入
- [x] 3.2 在 `fillBackAll` 的 tableList 成功路径调用（保存草稿前）
- [x] 3.3 在 `fillBackByInputEvents` 成功路径调用（保存草稿前）
- [x] 3.4 无有效单买价或找不到输入框时跳过，不阻断 SKU 回填
- [x] 3.5 README FAQ 补充商品参考价自动回填规则

## 4. 自检

- [x] 4.1 浏览器侧手动验证：轮播 10 张快删仅剩 1 张；回填后参考价 = 最大单买价 + 2
- [x] 4.2 确认新开价格计算器弹窗显示 30% / 5 元默认
