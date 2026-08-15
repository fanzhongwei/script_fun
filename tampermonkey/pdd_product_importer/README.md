# 拼多多商品包导入器

Tampermonkey 用户脚本：在拼多多商家后台商品编辑页，从 [页面图片导出器](../image_exporter/README.md) 一键导出的商品包文件夹读取 `manifest.json`，自动完成轮播/详情图替换、规格重建、Excel 导入与预览图分批上传；价格计算请继续使用 [价格计算器](../price_calculator/README.md)。

## 环境依赖说明

- **浏览器**：Chrome、Edge（需支持 File System Access API）
- **扩展**：Tampermonkey（推荐）
- **权限**：`GM_setValue` / `GM_getValue`（悬浮按钮位置）
- **适用站点**：`*://mms.pinduoduo.com/*`
- **配套**：需先使用 image_exporter **一键导出**生成含 `manifest.json` 的商品包

## 脚本参数说明

本脚本为浏览器用户脚本，**无命令行参数**。可在 Tampermonkey 管理面板中查看/编辑以下元数据：

| 元数据 | 说明 | 默认值 |
|--------|------|--------|
| `@match` | 脚本生效的 URL | `*://mms.pinduoduo.com/*` |
| `@grant GM_setValue` | 保存 FAB 位置 | 必需 |
| `@grant GM_getValue` | 读取 FAB 位置 | 必需 |
| `@run-at` | 注入时机 | `document-idle` |

## 使用配置说明

### 1. 安装脚本

1. 安装 Tampermonkey
2. 安装 `pdd_product_importer.user.js`
3. 与 image_exporter、spec_paste、price_calculator 可同时启用

### 2. 跨商品复制流程

```
源商品 → image_exporter「一键导出」→ 本地商品包文件夹
目标商品（新建/草稿）→ 本脚本「导入商品包」→ 选择文件夹
目标商品 → price_calculator 算价回填
```

### 3. 选择文件夹

点击右侧 **「导入商品包」**，选择与导出时相同的目录：

- 若目录下直接有 `manifest.json`（即 `{标题-ID}/` 文件夹），选该文件夹
- 若目录下为 `{标题-ID}/manifest.json` 结构，选父目录即可，脚本会自动进入子目录

### 4. 导入流水线（自动）

| 步骤 | 行为 |
|------|------|
| 轮播图 | 保留第 1 张，从第 2 张起连续快删（40ms，与详情图相同），**一次上传** manifest 全部轮播图 |
| 详情图 | 保留第 1 张占位避免空态 → 上传 manifest 全部 → **再删保留的首张旧图** |
| 规格 | 删全部旧规格 → 按 manifest 顺序添加规格类型并填值；**校验 SKU 数量与导出一致**（不符则自动重试，最多 5 次）；类型名不匹配或 SKU 仍不一致则中断 |
| Excel | 打开「Excel 批量编辑规格」导入 → 两次「确认编辑」 |
| SKU启用 | Excel 导入后，**库存为空** 的 SKU 行在右侧启用列设为 **不启用**（点 Switch / 下拉选项） |
| 预览图 | 校验 SKU 表格高度 → 每 12 张一批上传 |

### 5. 汇总弹窗

导入结束展示分步骤结果（含 **规格SKU数量**），可 **复制报告**。规格类型匹配失败或 SKU 数量校验失败时，Excel / SKU启用 / 预览图步骤标记为跳过。

### 6. 目录结构

```
tampermonkey/pdd_product_importer/
├── pdd_product_importer.user.js
└── README.md
```

## FAQ 说明

### Q1：提示找不到 manifest.json？

- 请使用 image_exporter **一键导出**（非仅下载部分图片）重新导出
- 确认所选目录含 `{标题-ID}/manifest.json` 或直接选中 `{标题-ID}` 文件夹

### Q2：规格类型匹配失败中断？

manifest 中 `typeLabel` 须与目标页规格类型 **ST 下拉框** 显示值 trim 后全等（如「颜色」「尺码」）。请从源商品 **重新一键导出** 以更新 manifest；勿使用旧包中错误的「规格」占位名。

### Q2.1：SKU 数量校验失败？

全部规格值填充完成后，脚本会比对页面 SKU 行数与 manifest 的 `previewTotal`（或预览图条数 / 规格值笛卡尔积）。若不一致（常见于平台未正确响应批量填充事件），会自动 **删除规格 → 重新填充 → 再校验**，最多 5 次。汇总报告会显示 `规格SKU数量：SKU 18/18`；仍失败则中断后续 Excel / 预览图步骤。

### Q3：预览图如何分批上传？

与 exporter 一致：第 1 行本地上传可选 12 张，第 13 行再选 12 张，依此类推。上传前若该行已有预览图会先删除（与详情图相同：直接点 `DeleteIcon`，40ms 间隔，不弹确认框，支持重复导入）。

### Q4：SKU 表格高度是什么？

大规格商品使用虚拟表格。脚本会检查内层滚动容器高度是否为「行数 × 70px」；已正确则跳过，否则自动设置后再上传预览图。

### Q5：Excel 导入后空库存怎么处理？

Excel 确认编辑后，脚本优先读 React `tableList.quantity` 识别空库存行，再在 `#goods-spec-sku` 内定位 `td.sku-input.quantity` 与右侧 **启用** 列 Switch 设为 **不启用**；Switch 无效时回写 `is_onsale=0`。

### Q6：Excel 导入后需要保存草稿吗？

不需要。上传后会自动点击「确认编辑项」弹窗及空值提示上的「确认编辑」；平台更新规格后直接进入预览图步骤。最终价格请用 price_calculator 重新算价并回填。

### Q7：轮播/详情图为什么保留第一张？

轮播图：避免清空后页面空态异常；从第 2 张起连续点击右上角删除叉（40ms 间隔）直至仅剩 1 张，再上传 manifest 中的图片。

详情图：上传前同样暂留第 1 张避免空态；**上传成功后会自动删除该首张旧图**，最终只保留 manifest 中的详情图。

### Q8：各步骤会滚动到对应区域吗？

会。轮播 → `#picture`；详情 → `#detail_pic`；规格 → `#spec`；Excel/预览 → `#sku`，便于 SPA 懒加载渲染目标 DOM。

### Q9：提示「未找到轮播图上传入口」？

满槽（如 10/10）时「本地上传」常会隐藏。脚本会先删至剩 1 张，再点击空槽位 / `carousel_img_localfile_upload` /「本地上传」触发上传，并扫描 `#picture` 区域内及弹窗中的 `input[type=file]`。

### Q10：详情图提示尺寸不符 / 假成功？

常见原因是源商品详情混入了「文本暂无预览」占位小图（短边 &lt; 480px）。请升级 image_exporter 后**重新一键导出**；导入器也会在上传前跳过短边 &lt; 480px 的文件，并在步骤详情标明跳过数。

### Q11：DOM 依赖说明（实现参考）

- 图片删除：优先 `[class*="DeleteIcon"]`（右上角叉）
- 轮播上传：`carousel_img_localfile_upload` /「本地上传」/ `#picture` 内 file input
- 规格删除：`.goods-spec-row-right` 内「删除规格类型」→ 确认弹窗点 **删除**
- 详情删除：`ImageWithRemark_v2_imageContainer` 内 `DeleteIcon_v2`（右上角叉）
- 规格添加：点「添加规格类型(1/2)」→ 新行 ST 下拉框（`#spec.parentSpecArr[n].spec_id`）选/填 typeLabel → 再批量填规格值
- Excel 导入：`button[data-tracking-viewid="confirm_edit"]`（BatchEditSkuModal 页脚）→ Popover `PP_popoverWithConfirm` 内再次确认
- SKU 启用：`.skuModule` 内 `tableList.quantity` 判空 → 批量写 `is_onsale=0` + 点 `[class*="SW_"]` Switch（React onChange / 坐标点击）
- 规格类型：添加规格后列表项文本全等匹配

若平台改版导致失败，请反馈页面截图与汇总报告。

### Q12：如何卸载？

在 Tampermonkey 管理面板中禁用或删除「拼多多商品包导入器」即可。
