## Why

当前已关联且店铺库存为 0、货源库存 > 0 一律判为 `补充库存`。货源库存 ≤ 20 本属库存告急，再建议从该货源补店库存不合理，待处理清单会误导补货。

## What Changes

- `补充库存` 仅在货源库存 **> 20** 时成立（店铺库存仍为 0）
- 已关联、店铺库存 > 0、货源库存 ≤ 20 时仍为 `库存告急`
- 店铺库存 = 0 且货源库存 ≤ 20 时为 `库存正常`（不报告急、不补充库存）
- 店库存大于货源、关联异常、未关联等既有优先级不变

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `1688-stock-checker`: 调整已关联 SKU 的 `补充库存` / `库存告急` 判定条件

## Impact

- 修改：`tampermonkey/stock_checker/stock_checker.user.js` 中 `classifySku`
- 同步：`tampermonkey/stock_checker/README.md` 判定表
- 不影响扫描、导出 Sheet、着色与其余检查结果取值
