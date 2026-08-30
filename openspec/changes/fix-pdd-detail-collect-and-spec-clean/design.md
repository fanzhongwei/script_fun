## Context

见 `proposal.md`。约束：只改 `image_exporter`；不引入 xlsx 库；规格写入对齐现有 React 友好 input（`spec_paste` / importer 的 native setter + `input`/`blur`）；Python 命令仍用 `python3-dev`（本变更不涉及）。

当前详情图：`collectDetailImages()` 只查 `#detail_pic img[data-tracking-click-viewid="el_preview_business_details"]`，再祖先 8 层占位正则、img 短边 480、URL 再探 480。V2 槽位多为背景图或无该 tracking 的卡片，故漏采。

当前成本表：一键导出后半段 `captureSkuExcelViaModal()` 直接截获平台 xlsx，不改规格。`manifest.specDimensions` 在导出末尾从规格输入框读取。

## Goals / Non-Goals

**Goals:**

- 详情图列表与页面已上传张数（合规图）对齐。
- 一键导出时源页规格值先清洗，Excel / manifest 读到同一套名字。
- 清洗后撞名则整次一键导出失败退出，由用户改规格后重试。

**Non-Goals:**

- 不改 `pdd_product_importer` 删图/上传策略（它消费导出结果）。
- 不清洗规格类型名、商品标题、SKU 表单元格。
- 不在「仅下载某类目图片」时改规格。
- 不做 xlsx 二进制改写；不自动为撞名加后缀消歧。
- 词表不扩展到「买赠 / 满赠」（未纳入本期；需要时可再加，属规格变更）。

## Decisions

1. **详情槽位枚举对齐导入器，但导出侧负责取 URL**  
   - 在 `#detail_pic` 内优先：`ImageWithRemark`+`imageContainer`；其次 `quick_decoration_v2_sortableWrapper` / `Grid_row` 下带「预览」且「更换」的子卡片；最后回退旧 img tracking。  
   - 每槽：`img` 候选 URL 或容器/`imageBox` 的 `background-image`（与轮播 `firstBackgroundUrl` 同类）。  
   - 备选（否决）：继续只扩 tracking 选择器 —— 盖不住纯背景图槽位。

2. **占位只看槽位节点 textContent**  
   - 不再从 img 向上爬 8 层。空槽有「暂无预览」时不得污染已上传兄弟卡。  
   - 备选（否决）：整区 `#detail_pic` 文本匹配 —— 空槽会误杀全部。

3. **缩略 URL 还原后再做 480 过滤**  
   - 对拼多多 CDN 常见 `imageView2` / `imageMogr2` 等查询参数做剥离或放到较大边（实现时选「去变换参数」更简单），再用现有 `filterUrlsByMinEdge`。  
   - 还原失败则仍按当前 URL 探测；过小则丢弃（真占位小图仍过滤）。  
   - 备选（否决）：详情图取消 480 门槛 —— 会把「文本暂无预览」小图重新带进包。

4. **清洗只走一键导出入口 `exportPddCategories` 且 `needExcel` 为真时**  
   - 顺序：清洗规格值 → 同类型去重检查 → 失败则 toast 中断（不选目录后半段、不截获 Excel）→ 成功则等待 SKU 表短暂稳定（有限 sleep / 与现有 settle 同类、动作内一轮）→ 再跑现有图片下载 + Excel + `buildExportManifest`。  
   - 面板打开时的 `discoverImagesPdd` 不改规格（详情图采集可立刻变准）。  
   - 若先选保存目录再清洗：撞名时用户已选过目录但无文件 —— 可接受；更宜 **先清洗再 `showDirectoryPicker`**，避免空点一次目录。  
   - 备选（否决）：只改截获的 xlsx —— 需解析器，且 manifest 仍脏。

5. **规格值定位复用 `pieQuerySpecInputs`，作用域限制在 `#spec` / `.goods-sku-box.goods-spec`**  
   - 排除 SKU 表内 input（现有 `pieIsSpecInput` 已排除 TB 表）。  
   - 写入：`HTMLInputElement` native value setter + `input` + `focusout`/`blur`，逐框、有短间隔，避免一次改完 React 未提交。  
   - 替换函数纯字符串：`赠送|赠品|附赠` 全局替换为 `-`，再 `赠|送` 替换为 `-`，再 `-{2,}` → `-`。不去首尾 `-`（「附赠赠品」→ `-` 是合法非空名）。

6. **撞名：按规格类型分组，trim 后的值集合 size < 条数则中断**  
   - 提示需点明「规格值清洗后重复，请手动修改后重新一键导出」。  
   - 已写入页面的清洗结果**保留**（用户本就要去赠品词）；不回滚输入框。用户手动改重复项后再点一键导出。  
   - 备选（否决）：自动加 `-2` 后缀 —— 用户要求平台重复时中断、人工处理。

## Risks / Trade-offs

- [Risk] V2 卡片 DOM 再变，槽位选择器失效  
  → Mitigation：多层回退（ImageWithRemark → sortable 子卡 → img tracking）；README 写明对照「已上传 N」。
- [Risk] URL 还原过度去掉必要签名参数导致 403  
  → Mitigation：只剥 `imageView2`/`imageMogr2` 类变换，保留其余 query；探测失败则回退原 URL。
- [Risk] 清洗后平台异步重建 SKU，Excel 仍是旧名  
  → Mitigation：blur 后短等待 + 可选再读输入框确认已是新值再点「导出当前规格数据」。
- [Risk] 「送」误伤（如极少见规格名含「送」但非赠品）  
  → Mitigation：词表按用户确认；误伤可在中断/导出前从页面改回。不引入白名单。
- [Risk] 撞名中断前已改页面，用户以为导出失败即规格未动  
  → Mitigation：toast 写明「已清洗规格但因重复中断，请改重复项后重试」。

## Migration Plan

- 用户更新油猴脚本「页面图片导出器」版本即可。
- 回滚：恢复旧 `collectDetailImages` 与一键导出时序（详情会再漏、规格不再洗）。

## Open Questions

（无）
