## Purpose

拼多多商家后台 Tampermonkey 用户脚本：从 `image_exporter` 导出的商品包文件夹读取 `manifest.json`，在目标商品编辑页自动完成轮播/详情图替换、规格重建、Excel 导入与预览图批量上传，最后展示分步骤汇总结果；价格计算仍由用户另行使用 price_calculator。

## ADDED Requirements

### Requirement: 导入商品包入口与文件夹选择

脚本 SHALL 在拼多多商家后台（`mms.pinduoduo.com`）商品编辑页提供「导入商品包」悬浮入口。用户触发导入时，脚本 SHALL 通过 File System Access API 让用户选择商品包根目录（与 image_exporter 选目录交互对称）。选择后脚本 SHALL 读取该目录下的 `manifest.json` 并校验 `version` 与必需字段；校验失败 SHALL 展示错误说明且不开始流水线。

#### Scenario: 成功选择文件夹并开始

- **WHEN** 用户点击「导入商品包」并在系统目录选择器中选择含有效 `manifest.json` 的导出根目录
- **THEN** 系统开始按固定顺序执行导入流水线

#### Scenario: manifest 无效

- **WHEN** 所选目录缺少 `manifest.json` 或版本不受支持
- **THEN** 系统不执行导入，并提示校验失败原因

### Requirement: 轮播图与详情图删旧留一后一次全量上传

导入流水线 SHALL 在处理轮播图与详情图时，先将目标页该类目已有图片中**除第一张以外**的全部删除，再从 manifest 所列路径读取全部文件，并在对应上传入口**一次**提交全部文件（平台多文件/多选能力）。上传结果 SHALL 记入步骤结果。

#### Scenario: 轮播图保留第一张并一次上传全部

- **WHEN** 目标页轮播区已有 4 张图且 manifest 含 8 张轮播图
- **THEN** 系统保留第 1 张，删除第 2～4 张，并一次上传 manifest 中的 8 张轮播图

#### Scenario: 详情图保留第一张并一次上传全部

- **WHEN** 目标页详情区已有 2 张图且 manifest 含 12 张详情图
- **THEN** 系统保留第 1 张，删除第 2 张，并一次上传 manifest 中的 12 张详情图

#### Scenario: 上传失败不中断整步

- **WHEN** 轮播或详情图一次上传失败
- **THEN** 该步骤标记为 partial 或 failed，系统继续后续流水线步骤（除非已触发规格类型 fatal 中断）

#### Scenario: 轮播满槽时先删后找上传入口

- **WHEN** 目标页轮播已上传满（如 10/10）且本地上传入口暂不可见
- **THEN** 系统先通过右上角删除图标删除第 2 张及以后的图，再定位本地上传入口并提交文件

#### Scenario: 导入前跳过过小或占位详情图

- **WHEN** manifest 详情图列表首张为短边小于 480px 的「文本暂无预览」占位图，其余为合规图
- **THEN** 系统跳过该占位图后上传其余文件，并在步骤详情中标明跳过数量

### Requirement: 规格全删后按序添加类型并填充值

导入流水线 SHALL 在填充规格前删除目标页全部已有规格类型（从最后一组向第一组删除）。随后 SHALL 按 `manifest.specDimensions` 数组顺序，对每个维度：在平台 UI 中添加对应规格类型、将 `typeLabel` 与选择器选项做 trim 后全等匹配、匹配成功后对该组第一个规格输入框批量填充 `values`。填充逻辑 SHALL 支持动态增行等待（与 spec_paste 行为等价）。

#### Scenario: 按序添加两个规格维度

- **WHEN** manifest 含「颜色」3 项与「尺码」4 项
- **THEN** 系统先删除全部旧规格，再依次添加并填充颜色组 3 项、尺码组 4 项

#### Scenario: 规格类型匹配失败中断

- **WHEN** 某维度的 `typeLabel` 在平台规格类型选择器中无 trim 后全等匹配项
- **THEN** 系统标记该步骤为 aborted，停止 Excel 导入与预览图上传，并进入汇总弹窗

### Requirement: Excel 规格文件导入

在规格维度与规格值填充完成后，脚本 SHALL 打开拼多多「Excel 批量编辑规格」弹窗，将 manifest 指定的 Excel 文件（默认 `成本表.xlsx`）导入。导入完成后脚本 SHALL NOT 点击「保存草稿」。系统 SHALL 等待平台自动更新规格（如弹窗关闭或 SKU 表刷新）后再进入预览图步骤。

#### Scenario: 成功导入 Excel

- **WHEN** 规格填充已完成且所选目录中存在 manifest 指定的 Excel 文件
- **THEN** 系统在批量编辑弹窗中完成文件导入，且不触发保存草稿

#### Scenario: 因规格中断跳过 Excel

- **WHEN** 规格类型匹配已触发 fatal 中断
- **THEN** Excel 导入步骤标记为 skipped，系统不打开 Excel 弹窗

### Requirement: 预览图按 12 张分批上传且支持重复导入

预览图上传前，脚本 SHALL 检查 SKU 虚拟表格内层滚动容器高度是否已正确（期望为 SKU 行数 × 70px，且 spacer padding 已清零）；若已正确则跳过，若未正确则设置高度后再继续。对每个 12 张一批的批次：对该批内已有预览图的 SKU 行先删除旧预览图，再在该批**第一行**（全局序号 1、13、25… 对应行）触发本地上传，一次注入本批全部文件（末批可少于 12 张）。`manifest.images.preview` 的 `index` SHALL 为 1-based 全局序号，与 image_exporter 12 张分桶规则一致。

#### Scenario: 表格高度已正确则跳过设置

- **WHEN** 预览图上传前 SKU 表格内层容器高度已等于行数 × 70px 且 DOM 行数满足预期
- **THEN** 系统不重复修改表格高度，直接进入预览图分批上传

#### Scenario: 表格高度未正确则设置

- **WHEN** 预览图上传前 SKU 表格高度不足或未清零 spacer padding
- **THEN** 系统将容器高度设为行数 × 70px 并清零 spacer 后再上传预览图

#### Scenario: 48 张预览图分 4 批上传

- **WHEN** manifest 含 48 条 preview 条目且 SKU 表已生成
- **THEN** 系统分 4 次批量上传，分别自第 1、13、25、37 行触发，每批最多 12 个文件

#### Scenario: 重复导入先删后传

- **WHEN** 某 SKU 行已有预览图且用户再次执行导入
- **THEN** 系统在该批上传前先删除该行已有预览图，再上传 manifest 中对应文件

#### Scenario: 末批不足 12 张

- **WHEN** 预览图总数为 25 张
- **THEN** 前三批各 12 张自第 1、13、25 行上传，最后一批仅上传 1 张文件

### Requirement: 分条目汇总弹窗

导入结束（含 aborted）后，脚本 SHALL 展示模态汇总弹窗，按步骤列出：轮播图、详情图、各规格维度、Excel 导入、预览图。每步 SHALL 包含状态（success / partial / failed / skipped / aborted）与可读详情（如成功数/总数、失败文件名、中断原因）。弹窗 SHALL 提供关闭，并 SHOULD 提供复制报告能力。

#### Scenario: 全部成功

- **WHEN** 各步骤均无 fatal 且文件全部成功
- **THEN** 汇总弹窗中各步骤状态为 success，并显示对应数量

#### Scenario: 规格中断后的汇总

- **WHEN** 规格类型匹配失败触发中断
- **THEN** 已完成步骤显示实际结果，Excel 与预览图显示 skipped，规格步骤显示 aborted 及原因

#### Scenario: 执行中进度

- **WHEN** 流水线正在执行
- **THEN** 用户可见当前步骤名称与进度（如「正在上传轮播图 3/8」）

### Requirement: 脚本目录与说明文档

仓库 SHALL 在 `tampermonkey/pdd_product_importer/` 下提供用户脚本与 README。README MUST 包含：环境依赖说明、脚本参数说明、使用配置说明、FAQ 说明；并说明依赖 image_exporter 导出包、`manifest.json` 格式及导入后需使用 price_calculator 算价。

#### Scenario: 目录结构完整

- **WHEN** 查看仓库 `tampermonkey/pdd_product_importer/`
- **THEN** 存在用户脚本文件与包含四类说明的 README
