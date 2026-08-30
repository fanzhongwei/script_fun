## 1. 详情图 V2 槽位采集

- [x] 1.1 在 `image_exporter.user.js` 实现 `#detail_pic` 槽位枚举（ImageWithRemark / V2 sortable 子卡 / 旧 img tracking 回退），按 DOM 顺序取 URL（img 与 background-image）
- [x] 1.2 占位判断改为仅看本槽位文案；对 PDD 缩略 URL 剥离 imageView2/imageMogr2 后再走现有短边 480 过滤
- [x] 1.3 用 `collectDetailImages`（或替换实现）接入 `discoverImagesPdd`，保持轮播/预览采集不变

## 2. 规格赠品词清洗与撞名中断

- [x] 2.1 实现纯字符串清洗：长词 `赠送|赠品|附赠` 再单字 `赠|送` 换成 `-`，连续 `-` 合并为一个
- [x] 2.2 在 `#spec` / `.goods-sku-box.goods-spec` 用 `pieQuerySpecInputs` 定位规格值框，React 友好写入（native setter + input + blur），逐框短间隔
- [x] 2.3 按规格类型分组检测清洗后重复值；重复则 toast 说明已清洗但中断、不回滚输入框
- [x] 2.4 在一键导出 `exportPddCategories` 且需要成本表时：先清洗与去重，通过后再选目录/下载图片/截获 Excel；仅下载图片类目不清洗

## 3. 版本、文档与自检

- [x] 3.1 bump `image_exporter.user.js` 版本号
- [x] 3.2 更新 `tampermonkey/image_exporter/README.md`：详情图 V2 槽位采集、一键导出前规格清洗、撞名中断
- [x] 3.3 自检：V2 详情区 12 张合规图时面板为 12；「红色赠袜子」一键导出后为「红色-袜子」；「红色赠」+「红色送」中断且不写出成本表；仅下载详情图不改规格
