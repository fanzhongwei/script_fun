## 1. 价格计算器：去掉常驻展开环

- [x] 1.1 删除或停用 `initSkuTableExpandOnLoad` 中的 `document.body` MutationObserver、页面 load 空闲触发，以及 `[1000,2500,5000,10000]` 定时 `scheduleSkuTableExpand`
- [x] 1.2 在打开价格计算弹窗入口（扫描 SKU 前）`await` 至多一轮 `loadAllVirtualSkuRows`（保留进程内防重入锁）
- [x] 1.3 在弹窗「刷新」重新扫描路径同样先按需展开一轮再扫描
- [x] 1.4 确认脚本启动时不再调用会在空闲改高度的初始化；bump `price_calculator.user.js` 版本号

## 2. 图片导出器：核对按需展开

- [x] 2.1 确认预览图采集/导出路径在读 `.sku-preview-cell` 前仍调用 `expandPddSkuTable`（或等价）一轮
- [x] 2.2 确认无常驻 MutationObserver/定时器驱动 SKU 高度展开；若有则移除
- [x] 2.3 如有行为说明变更则 bump `image_exporter.user.js` 版本号

## 3. 商品包导入器：核对流水线内校正

- [x] 3.1 确认依赖 SKU 全表的导入步骤仍调用 `ensureSkuTableHeight`，且高度已正确时跳过
- [x] 3.2 确认空闲页无常驻监听反复改写 SKU 高度；若有则移除
- [x] 3.3 如有行为说明变更则 bump `pdd_product_importer.user.js` 版本号

## 4. 文档与自检

- [x] 4.1 更新三个脚本 README：写明展开仅在打开价格计算/刷新、导出预览图、导入相关步骤触发，空闲不监听
- [x] 4.2 自检：仅启用价格计算器进入编辑页空闲不闪；打开弹窗可扫描；导出预览图与导入相关步骤仍能访问 SKU 行
