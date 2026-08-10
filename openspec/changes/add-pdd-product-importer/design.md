## Context

仓库已有拼多多 Tampermonkey 脚本三角：

- `image_exporter`：轮播/详情/预览图 + `成本表.xlsx` 一键导出，预览图按 12 张分桶（`CHUNK_SIZE = 12`）
- `spec_paste`：规格名批量粘贴（仅第一个规格框触发）
- `price_calculator`：SKU 扫表、算价、Markdown 导入导出、回填

本变更在导出与算价之间补齐 **跨商品复制（场景 A）** 的导入侧。约束见 proposal.md；用户明确：Excel 导入后不保存草稿；规格类型匹配失败中断；预览图支持重复导入（先删后传）；预览图利用平台 12 张/批快捷上传。

## Goals / Non-Goals

**Goals:**

- 新增 `pdd_product_importer.user.js`，FAB「导入商品包」→ FS API 选文件夹 → 执行六步流水线
- 与 exporter 对称的 `manifest.json` v1 契约
- 轮播/详情：保留第 1 张，删其余，再**一次上传** manifest 全部图片
- 规格：删全部 → 按序选类型 + 填值 → Excel 导入
- 预览：检查 SKU 虚拟表格高度是否已正确 → 未正确则设置 → 每批 12 行删旧预览 → 首行触发批量上传
- fatal：规格类型 `typeLabel` 全等匹配失败即 abort，跳过后续 Excel/预览
- 汇总模态框：分步骤报告，支持复制报告

**Non-Goals:**

- 跨 Tab 内存包（IndexedDB 直传）——后续增强
- 部分导入模式（仅预览图）——后续增强
- 自动调用 price_calculator 算价回填
- 修改 spec_paste / price_calculator 脚本文件本身
- Firefox/Safari 无 FS API 时的完整降级（README 注明 Chrome/Edge）

## Decisions

### 1. 目录与脚本边界

- **决策**：`tampermonkey/pdd_product_importer/pdd_product_importer.user.js` + README；不合并进 image_exporter
- **理由**：一脚本一目录；导入与导出职责分离，便于独立安装与维护

### 2. manifest.json v1 契约

- **决策**：导出根目录下 `{标题-ID}/manifest.json`，结构如下：

```json
{
  "version": "1",
  "source": { "goodsId": "", "goodsTitle": "", "exportedAt": "" },
  "specDimensions": [
    { "typeLabel": "颜色", "values": ["米色", "白色"] }
  ],
  "images": {
    "carousel": ["轮播图/1.jpg"],
    "detail": ["详情图/1.jpg"],
    "preview": [
      { "index": 1, "file": "预览图/1.jpg", "style": "米色 / S" }
    ]
  },
  "excel": "成本表.xlsx",
  "previewTotal": 48
}
```

- **字段说明**：
  - `typeLabel`：源页规格类型选择器显示文本（trim 后全等匹配）
  - `preview[].index`：1-based 全局序号，与 exporter 分桶一致
  - `preview[].style`：SKU 款式拼接文本，用于诊断与可选校验
- **理由**：importer 不猜测路径；序号驱动 12 批上传

### 3. 文件夹选择与文件读取

- **决策**：复用 image_exporter 的 `showDirectoryPicker` / `FileSystemDirectoryHandle` 模式；用户选手势与导出对称
- **校验**：manifest 存在、version 支持、excel 与图片路径可读；失败弹窗说明，不开始流水线
- **备选**：`<input webkitdirectory>` — 仅只读降级，非 MVP

### 4. 编排器与中断策略

- **决策**：单线程 async 状态机，步骤顺序固定：

```
validate → carousel → detail → spec_clear → spec_add[*] → excel → preview_chunks → summary
```

- **fatal abort**：仅 `spec_add` 中 `typeLabel` 在平台选择器无全等匹配时触发；`aborted=true`，跳过 excel 与 preview
- **non-fatal partial**：轮播/详情/预览单文件失败记 partial，默认继续（预览按批继续）
- **不回滚**：已完成的 DOM 变更保留，汇总报告供人工补救

### 5. 轮播图 / 详情图：删旧留一 + 一次全量上传

- **决策**：
  - 轮播：枚举 `#picture` / `MaterialModalButton_v2_imageBox`，index ≥ 1 从后往前点删除
  - 详情：枚举 `#detail_pic` 内 `el_preview_business_details` 对应项，同上
  - 上传：读 manifest 全部路径 → `File[]` → 找 `carousel_img_localfile_upload` 或详情区 `input[type=file]` → **一次** `DataTransfer` 注入全部文件（平台支持多选/多文件一次提交）
- **理由**：目标页常有模板占位图，保留第 1 张避免空态异常；轮播与详情均支持一次上传所有图，无需逐张循环

### 6. 规格：删旧 → 加类型 → 填值

- **决策**：
  1. 找所有含「删除规格类型」的组，从最后一组往第一组删
  2. 对每个 `specDimensions[i]`：点「添加规格类型」→ 在选择器中 **trim 全等** 匹配 `typeLabel` → 失败则 fatal
  3. 对组内第一个 input 复用 spec_paste 逻辑（`setInputValue` + 等增行 + `waitForSpecInput`）
- **理由**：平台 SKU 表依赖规格维度先生成；类型名必须精确，避免 silent wrong mapping

### 7. Excel 导入

- **决策**：复用 image_exporter 的 `findSkuExcelExportElement` 思路打开弹窗 → 找「导入/上传 Excel」→ 注入 `成本表.xlsx` → 等弹窗关闭或 SKU 表 mutation；**不**点击「保存草稿」
- **完成信号**：弹窗消失 + 超时兜底（如 30s）
- **理由**：用户确认平台自动更新规格

### 8. 预览图：表格高度校验 + 12 张/批 + 删旧

- **决策**：
  1. **SKU 虚拟表格高度**（非「滚轮展开」）：上传预览图前检查 `#sku` / `#goods-spec-sku` 内层滚动容器高度是否已正确：
     - 期望高度：`SKU 行数 × 70px`（与 price_calculator / image_exporter 一致），并清零 spacer 的 `padding-top/bottom`
     - 若已满足（如 DOM 行数 ≥ 预期行数，或容器 `height/maxHeight` 已达期望）→ **跳过**，不重复设置
     - 若未满足 → 设置 `maxHeight`/`height` 并清 spacer，必要时短等待 DOM 稳定
  2. `preview` 按 `index` 排序，每 12 张一组
  3. 对批次 `startRow = (chunkIdx * 12)`（0-based）：
     - 对该批每行：若 preview cell 已有图（background 非空且非 placeholder）→ 删除
     - 定位第 `startRow` 行 `.sku-preview-cell` 内 `el_specification_batch_modification_preview_picture` → 本地上传 → 一次注入 ≤12 个 `File`
     - 等待本批 preview 更新或超时
  4. 末批不足 12 张：仍从对应首行上传，只注入剩余文件数
- **理由**：表格高度正确时各行已在 DOM 中可访问，无需额外 scroll 唤醒；与 exporter `CHUNK_SIZE = 12` 及平台 12 张/批上传对称

### 9. 汇总弹窗

- **决策**：模态面板，表格列：步骤 | 状态 | 详情；状态枚举 `success` / `partial` / `failed` / `skipped` / `aborted`；提供「复制报告」
- **执行中**：同面板顶部进度 + 当前步骤文案

### 10. image_exporter 增强

- **决策**：`exportPddCategories` 全量导出成功后写 `manifest.json` 到同一根目录；采集：
  - 各规格组 `typeLabel`（下拉/组标题 DOM）
  - 各组规格值列表
  - 预览图 `index`、`file`（相对路径）、`style`（行款式文本）
- **理由**：导入器唯一索引来源

## Risks / Trade-offs

- [预览图删除按钮 DOM 未文档化] → 实现前 spike 录制样本；失败时汇总 partial
- [Excel 导入按钮文案/位置变化] → 多 selector + 文本匹配；README FAQ
- [规格类型选择器标准/自定义两套 UI] → 仅全等匹配；失败 fatal，用户修正 manifest 源数据
- [SKU 表格高度未正确导致预览行不可访问] → 上传前校验高度，不正确则设为 N×70px；批间 sleep
- [重复导入全量删规格成本高] → 文档说明；后续可加 `importMode`
- [FS API 仅 Chromium] → README 注明浏览器要求
- [Excel 可能写入旧价格] → 文档说明最终以 price_calculator 算价为准

## Migration Plan

- 新建 `pdd_product_importer/` 脚本与 README
- 升级 `image_exporter` 写 manifest（向后兼容：无 manifest 的旧导出包无法导入，需重新导出）
- 无数据迁移；禁用/删除脚本即可回滚
- 归档 change 时同步 `openspec/specs/pdd-product-importer/spec.md` 与 `page-image-exporter` delta

## Open Questions

- 预览图删除入口的具体 DOM（hover 删除 vs 弹层删除）——实现 spike 确认，不改变 spec 行为
