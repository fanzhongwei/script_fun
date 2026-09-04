## Why

爱用分销「关联货源 / 商品管理」里，店铺 SKU 库存与 1688 货源 SKU 库存、关联状态、上架状态需要逐商品进入规格匹配页才能核对。多店铺、多分页手工点检效率低，超卖与缺货难以及时发现。需要在轻应用容器页注入油猴脚本，按规则批量检查并导出 Excel。

## What Changes

- 新增油猴脚本「1688 库存检查」及 README，目录 `tampermonkey/stock_checker/`
- 仅在 1688 轻应用容器（爱用分销 `goods_settings`）内注入；在「批量关联货源」按钮后增加「库存检查」主按钮，样式与之相同
- 点击后按当前筛选（不改「商品状态=在售中」）扫描**全部店铺**：每店翻完商品列表、进入规格匹配核对全部规格后返回；商品失败最多重试 5 次
- 检查结束后展示总结，并生成可下载的双 Sheet Excel（待处理库存、库存检查结果明细；列宽足够显示中文列头）

## Capabilities

### New Capabilities

- `1688-stock-checker`: 轻应用容器内注入库存检查入口；按规格匹配页 SKU 判定；全量切店与商品翻页；失败重试；总结与 Excel 导出

### Modified Capabilities

- （无）

## Impact

- 新增：`tampermonkey/stock_checker/stock_checker.user.js`、`tampermonkey/stock_checker/README.md`
- 可选同步根 README 的 Tampermonkey 脚本列表
- 不影响现有 `tampermonkey/` 其他脚本
- 运行环境：浏览器 + Tampermonkey；`@match` 覆盖 `light-app.1688.com` 轻应用容器（含该页 iframe）；Excel 依赖脚本内引入的 SheetJS
- 目标页：爱用分销铺货工具商品设置（拼多多渠道），容器 URL 形如 [isv-container `lapp_distribute_tool` / `goods_settings`](https://light-app.1688.com/html/isv-container.html?appKey=6541416&_conanVisible_=false&isLapp=true&jumpFunction=lapp_distribute_tool&state=%7B%22scene_type%22%3A%22ai_workbench%22%2C%22page_code%22%3A%22goods_settings%22%2C%22channel%22%3A%22pinduoduo%22%2C%22shopCode%22%3A%22982897357%22%7D)
