## 1. 目录与脚本骨架

- [x] 1.1 创建 `tampermonkey/stock_checker/` 目录
- [x] 1.2 新增 `stock_checker.user.js` 元数据：`@match *://light-app.1688.com/*`、`@run-at document-idle`、`@grant none`、`@require` SheetJS、不设 `@noframes`
- [x] 1.3 定义常量 `LOW_STOCK_THRESHOLD = 20`、`MAX_PRODUCT_RETRIES = 5`、商品/店铺间隔
- [x] 1.4 实现 `sleep` / `waitFor` 与防重复注入标记

## 2. 入口按钮

- [x] 2.1 用轮询或 MutationObserver 等待 `.relevance-box-header-new-line` 中「批量关联货源」按钮
- [x] 2.2 在其后插入「库存检查」`ant-btn ant-btn-primary`，样式对齐，禁止改筛选/重置/两个同步开关
- [x] 2.3 运行中禁用按钮，防止重入

## 3. 判定与 DOM 采集

- [x] 3.1 实现 `classifySku`（未关联/已关联判定顺序与 spec 一致，含 `补充库存`）
- [x] 3.2 解析店铺名、规格匹配页商品 ID/标题、货源供应商与货源名称
- [x] 3.3 解析规格行：SKU 名、店库存、上架开关、是否已选货源、货源 SKU 名、货源库存
- [x] 3.4 进入后点击「全部规格」、取消「仅查看上架中的商品规格」；规格匹配页无分页，只采集当前规格表

## 4. 商品扫描控制流

- [x] 4.1 读取店铺下拉全部店铺；每店快照当前列表带 `ppgg`「规格匹配」的行
- [x] 4.2 单商品：点击规格匹配 → 采集全部规格 → 面包屑返回 → 等待列表恢复；已返回列表后翻商品页；规格匹配页不点分页
- [x] 4.3 商品级失败整段重试最多 5 次；仍失败写入 `检查失败` 行并继续下一件
- [x] 4.4 必要时关闭规格匹配广告遮罩（`.ad-icon-btn`），不改变判定
- [x] 4.5 逐店切换 `.select-shop-main-select`，扫完一店全部商品页再切下一店

## 5. 总结与 Excel

- [x] 5.1 结束后展示总结：商品数、SKU 行数、各结果计数、检查失败商品数
- [x] 5.2 用 SheetJS 生成两 Sheet（列顺序与 spec 一致，设置列宽）；待处理仅 `库存异常`/`库存告急`/`补充库存`；明细含全部及 `检查失败`
- [x] 5.3 Blob 下载 xlsx（文件名含店铺名与时间）

## 6. 说明文档

- [x] 6.1 编写 `tampermonkey/stock_checker/README.md`（环境依赖、脚本参数/常量、使用配置、FAQ，含全量切店与商品翻页）
- [x] 6.2 在根 `README.md` Tampermonkey 列表中增加本脚本链接
