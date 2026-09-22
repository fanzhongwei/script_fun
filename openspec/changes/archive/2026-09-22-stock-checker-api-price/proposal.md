## Why

库存检查时还要看出货源价相对上次是涨了还是降了。曾尝试用爱用接口代替规格匹配页，但 1688 轻应用里脚本找不到可复用的已登录请求方法，接口路径已放弃。仍在规格匹配页读取货源卡片价格，按店铺记在油猴本地，下次对比涨跌，并和库存结果分开给出。

## What Changes

- 店铺切换、商品列表和单商品采集仍走页面。每一件商品进入规格匹配页，读取全部规格、上架状态、货源库存和货源卡片价格，然后返回列表。不并行。
- 每次成功检查后，把已关联 SKU 的货源价写入油猴本地存储（按店铺）。远端 NAS 不使用。
- 用上次存价对比本次货源价，得到涨价、降价、持平、首次、无货源价、换绑。
- Excel 仍按店铺各一份。原有两个库存 Sheet 的列与筛选规则不变；新增两个价格 Sheet。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `1688-stock-checker`：规格匹配页同时读取货源卡片价格；增加货源价本地存档与涨跌判定；导出增加价格 Sheet。库存判定规则与原库存 Sheet 列不变。

## Impact

- 代码与说明：`tampermonkey/stock_checker/stock_checker.user.js`、`tampermonkey/stock_checker/README.md`
- 依赖：增加油猴 `GM_getValue` / `GM_setValue` 以保存货源价。不使用 `unsafeWindow`，不请求爱用接口，不保存令牌。
- 行为：检查时仍打开规格匹配页并返回列表。库存判定树与「待处理库存」「库存检查结果明细」列不变。
