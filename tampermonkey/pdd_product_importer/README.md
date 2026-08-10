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
| 轮播图 | 保留第 1 张，删其余，**一次上传** manifest 全部轮播图 |
| 详情图 | 同上 |
| 规格 | 删全部旧规格 → 按 manifest 顺序添加规格类型并填值；**类型名不匹配则中断** |
| Excel | 打开「Excel 批量编辑规格」导入 `成本表.xlsx`，**不点保存草稿** |
| 预览图 | 校验 SKU 表格高度（未正确则设为 N×70px）→ 每 12 张一批上传；有旧预览先删 |

### 5. 汇总弹窗

导入结束展示分步骤结果，可 **复制报告**。规格类型匹配失败时，Excel 与预览图步骤标记为跳过。

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

manifest 中 `typeLabel` 须与目标页「添加规格类型」选择器选项 **trim 后全等**。请从源商品重新导出以更新 manifest，或手动在源页确认规格类型名称。

### Q3：预览图如何分批上传？

与 exporter 一致：第 1 行本地上传可选 12 张，第 13 行再选 12 张，依此类推。上传前若该行已有预览图会先删除（支持重复导入）。

### Q4：SKU 表格高度是什么？

大规格商品使用虚拟表格。脚本会检查内层滚动容器高度是否为「行数 × 70px」；已正确则跳过，否则自动设置后再上传预览图。

### Q5：Excel 导入后需要保存草稿吗？

不需要。平台会自动更新规格数据；最终价格请用 price_calculator 重新算价并回填。

### Q6：轮播/详情图为什么保留第一张？

避免清空后页面空态异常；第 2 张起会被 manifest 中的图片替换。

### Q7：DOM 依赖说明（实现参考）

- 预览图删除：预览 cell 内删除/关闭控件（`findDeleteButton`）
- Excel 导入：弹窗内 `input[type=file]` 或「导入/上传 Excel」按钮
- 规格类型：添加规格后列表项文本全等匹配

若平台改版导致失败，请反馈页面截图与汇总报告。

### Q8：如何卸载？

在 Tampermonkey 管理面板中禁用或删除「拼多多商品包导入器」即可。
