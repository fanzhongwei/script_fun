## Context

仓库按「一脚本一目录」放置 Tampermonkey 脚本；现有脚本均针对拼多多商家后台，无 1688/爱用分销自动化。目标 DOM 在 1688 轻应用容器文档中（用户确认以 [isv-container](https://light-app.1688.com/html/isv-container.html?appKey=6541416&_conanVisible_=false&isLapp=true&jumpFunction=lapp_distribute_tool&state=%7B%22scene_type%22%3A%22ai_workbench%22%2C%22page_code%22%3A%22goods_settings%22%2C%22channel%22%3A%22pinduoduo%22%2C%22shopCode%22%3A%22982897357%22%7D) 为注入文档，含该 URL 作为 iframe `src` 的情况）。需求与判定见 `proposal.md` 与 `specs/1688-stock-checker/spec.md`。

页面为 React/Ant Design SPA：列表与规格匹配在同一应用内切换，返回后列表节点会重建。扫描范围为店铺下拉中的全部店铺，每店翻完商品列表。

## Goals / Non-Goals

**Goals:**

- 用 MutationObserver + 轮询在容器文档中稳定插入入口，不依赖顶层 `mms` 页
- 以「等待选择器 + 有限重试」驱动规格匹配进出，避免与页面路由死锁
- 客户端生成双 Sheet xlsx，无需平台导出接口
- 判定与 Excel 列与 spec 一致；告急阈值、重试次数用顶部常量；Excel 列宽写死保证列头可见

**Non-Goals:**

- 不调用爱用/1688 非页面私有 HTTP API 拉库存（本阶段只读 DOM）
- 不修改关联关系、不上架、不同步库存
- 不实现多货源比对
- 本阶段不实现运行时「停止」按钮（全量耗时由用户自行关闭标签页中止）

## Decisions

### 1. 落盘与元数据

- **决策**：`tampermonkey/stock_checker/stock_checker.user.js` + `README.md`；`@name` 1688库存检查；`@match *://light-app.1688.com/*`；不设 `@noframes`，使 iframe 内文档也能注入；`@run-at document-idle`；`@grant none` 加 `@require` SheetJS（jsDelivr `xlsx` 官方构建）生成 xlsx，下载用 `Blob` + `<a download>`。
- **理由**：与现有 `.user.js` 惯例一致；容器页跨域 iframe 时脚本必须跑在 iframe 文档；双 Sheet 不能用纯 CSV。
- **备选**：`GM_download` — 无必要增加 grant；自写 xlsx ZIP — 成本高。

### 2. 入口注入

- **决策**：观察 `.relevance-box-header-new-line`，定位 `button.ant-btn-primary` 且文案为「批量关联货源」，在其后 `insertAdjacentElement('afterend', …)` 插入脚本自有 `button`（带 data 标记防重复）。按钮存在则跳过。
- **理由**：用户提供的页头 HTML 结构稳定；避免插到开关区域。

### 3. 列表与规格匹配定位

- **决策**：商品行 `.relevance-table-row`；规格匹配 `button[data-logger-action-type="ppgg"]`（文案兜底「规格匹配」）。店铺名取 `.selected-shop-name` 文本。商品 ID/标题在规格匹配页 `.shop-product-goods-box`（`ID：`、标题节点）。SKU：`.specs-table tbody tr`；店侧 `.sku-info-title`、`.sku-info-stock`；上架 `button.ant-switch` 的 `ant-switch-checked`；货源 `.ant-select-selection-selected-value`（占位可见则未关联）、`.product-specs-card-info-stock`、供应商/货源名取页头 `.product-goods-card`。返回：`.matchspecs-box-header .breadcrumb` 内可点击图标/项。
- **理由**：与用户提供的列表行、规格表 HTML 对齐；`ppgg` 可避开「关联多货源」「更换货源」。

### 4. 异步控制流

- **决策**：`async` 队列 + `sleep` + `waitFor(predicate, timeout)`。单商品：`for attempt in 1..5` 包一整段（点击匹配 → 等 `.matchspecs-box` → 点全部规格 → 确保未勾选仅上架 → 采集当前规格表全部行（规格匹配页无分页）→ 返回 → 等列表行重新出现）。常量：`LOW_STOCK_THRESHOLD = 20`、`MAX_PRODUCT_RETRIES = 5`。全量：打开 `.select-shop-main-select` 读取店铺行（`.select-shop-table tbody tr` 等），逐店 `switchShop`；每店在已返回列表后点击商品列表 `ul.ant-pagination` 的下一页（禁止在规格匹配页点分页）。
- **理由**：用户要求全量切店、翻商品页；规格匹配页无分页，列表分页与规格页必须分开定位。

### 5. 判定实现

- **决策**：纯函数 `classifySku({ linked, onSale, shopStock, sourceStock })`，顺序与 spec 一致。已关联但未上架且店库存 > 0 记 `关联异常`。已关联且店库存 = 0 且货源 > 0 记 `补充库存`（不论是否上架）。`库存告急` 要求店铺库存 > 0。「默认规格」与「请选择货源规格」视为未关联，货源列留空。库存用正则抽数字。
- **理由**：判定集中便于单测式手工对照。

### 6. 进度与结果 UI

- **决策**：检查中在**页面右上角固定浮层**显示进度（本店 seq/total；当前商品为「店铺名 · 店铺商品名」；SKU 名）；结束用同一浮层列出计数、耗时 + 仅一个「下载 Excel」。运行中按钮禁用，防止重入。
- **理由**：规格匹配会换页，入口旁提示容易看不见；右上角浮层 `position:fixed` 始终可见。

### 7. Excel

- **决策**：`xlsx-js-style` 写两个 sheet；冻结首行；同商品合并列垂直居中；`!cols` 按列头宽度；`库存异常` 整行浅红底、`库存告急` 整行黄底（两 Sheet 相同）。列顺序为店铺商品ID、店铺商品名、店铺SKU名、店铺库存、是否上架、检查结果、货源库存、货源SKU名、货源名称、货源供应商；按店铺各下一份文件。待处理过滤 `库存异常|库存告急|补充库存`。
- **理由**：与 spec 列、Sheet 名一致。

## Risks / Trade-offs

- [容器实际 DOM 不在 match 的文档] → `@match` 放宽到 `light-app.1688.com` 全路径且允许 iframe；README 说明须在能看到「批量关联货源」的那一层启用脚本。
- [规格匹配打开慢/广告遮罩] → `waitFor` 超时拉长；必要时点关闭 `.ad-icon-btn`。
- [返回后列表顺序变化] → 试跑用点击前快照的行索引/标题，不依赖旧节点引用。
- [SheetJS CDN 不可用] → README 写明 `@require` URL，可改为本地 require。
- [写死 2 件被误当成产品行为] → 已改为全量切店与商品翻页。

## Migration Plan

- 安装：油猴导入 `stock_checker.user.js`。
- 回滚：禁用或删除该脚本，页面无残留（不写业务数据）。
- 全量：点击「库存检查」即扫全部店铺与各店商品列表分页。

## Open Questions

- 规格匹配页广告弹层出现频率未知，实现时按需加关闭；不改变判定 spec。
