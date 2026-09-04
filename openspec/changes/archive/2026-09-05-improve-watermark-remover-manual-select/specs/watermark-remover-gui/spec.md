## ADDED Requirements

### Requirement: 选择文件或文件夹并加载缩略图

应用 SHALL 提供「选择文件」与「选择文件夹」入口。用户选入后，应用 SHALL 将所有支持的图片（`.png`、`.jpg`、`.jpeg`、`.webp`）列入侧栏，并 MAY 在后台仅加载缩略图以便显示。应用 SHALL NOT 在选入后自动执行 OCR 检测或修复 inpaint。

#### Scenario: 选择多个文件后仅入列表

- **WHEN** 用户通过文件选择器选中 3 张图片并确认
- **THEN** 列表显示 3 项，且不开始自动检测或自动修复

#### Scenario: 选择文件夹后仅入列表

- **WHEN** 用户选择包含 5 张支持格式图片的文件夹
- **THEN** 5 张图片全部出现在列表中，且不开始自动检测或自动修复

### Requirement: 手动形状工具与多选区

应用 SHALL 提供可由用户选择的选区形状：矩形、椭圆、多边形、套索。手动选区 SHALL 不依赖 OCR 或内置水印关键词。同一张图片 SHALL 允许存在多个已完成选区；修复 mask SHALL 为全部选区的并集。用户点击「生成预览」后，应用 SHALL 基于该并集 mask 生成缩略修复预览。

#### Scenario: 选择多边形绘制不规则选区

- **WHEN** 用户选择多边形工具并在图上点出顶点后闭合
- **THEN** 该多边形作为一块选区显示，且不调用 OCR

#### Scenario: 套索绘制自由轮廓

- **WHEN** 用户选择套索工具按住拖出闭合路径后松开
- **THEN** 该填充路径作为一块选区显示

#### Scenario: 多块选区并集预览

- **WHEN** 用户在同一张图上完成两块选区并点击「生成预览」
- **THEN** 系统按两块选区的并集 inpaint 并显示一张缩略预览

#### Scenario: 新选区追加而非替换

- **WHEN** 用户已有一块矩形选区，再拖拽一块椭圆
- **THEN** 两块选区同时存在，椭圆不替换矩形

### Requirement: 选区撤销与恢复（含键盘）

应用 SHALL 支持对当前图片选区历史的撤销与恢复。撤销与恢复 MUST 可通过键盘触发：撤销为 Ctrl+Z（macOS 上为 Cmd+Z）；恢复为 Ctrl+Y 或 Ctrl+Shift+Z（macOS 上为 Cmd+Shift+Z 或 Cmd+Y）。按钮与快捷键 SHALL 作用于同一套历史。正在绘制中的多边形（尚未闭合）被撤销时，应用 SHALL 取消当前未完成笔画或回退一个顶点（实现须保证用户可撤销误点）。

#### Scenario: 键盘撤销上一块选区

- **WHEN** 用户已完成两块选区并按下 Ctrl+Z
- **THEN** 后完成的那一块选区从画布上消失，第一块仍保留

#### Scenario: 键盘恢复选区

- **WHEN** 用户刚撤销一块选区后按下 Ctrl+Y 或 Ctrl+Shift+Z
- **THEN** 被撤销的选区重新出现

#### Scenario: 无可撤销时保持现状

- **WHEN** 当前图片没有任何选区历史可撤销时用户按下 Ctrl+Z
- **THEN** 画布选区不变且不报错

### Requirement: 改选区后须重新生成预览才能确认

用户在已有预览后若增删或撤销/恢复选区，应用 SHALL 作废当前修复预览，且 SHALL NOT 允许确认或导出，直至用户再次点击「生成预览」并成功得到与当前选区一致的预览。

#### Scenario: 预览后追加选区不可确认

- **WHEN** 用户已生成预览后再次画一块新选区
- **THEN** 预览区不再展示旧修复图，且「确认」不可用

#### Scenario: 撤销选区后须重新预览

- **WHEN** 用户在预览后撤销一块选区
- **THEN** 旧预览作废，须重新生成预览后才能确认

### Requirement: 开发启动跳过已有 python3-dev

通过 `run-gui.sh` 在 Linux 开发环境启动时，若系统 PATH 上已有可执行的 `python3-dev` 且能成功打印版本，脚本 SHALL NOT 下载或重装独立 CPython，SHALL NOT 因缺少 `PY_ROOT/cpython/bin/python3` 而判定需要 bootstrap。仅当找不到可用的 `python3-dev` 时 SHALL 执行 bootstrap。Python 包依赖仍仅在导入检查失败时安装。

#### Scenario: 已有 python3-dev 不重装解释器

- **WHEN** 本机已能执行 `python3-dev --version` 且用户运行 `run-gui.sh`
- **THEN** 不下载独立 CPython 压缩包，也不重建 venv

#### Scenario: 无 python3-dev 才 bootstrap

- **WHEN** PATH 上找不到可运行的 `python3-dev`
- **THEN** 脚本安装独立 Python 并创建 `python3-dev` 包装后再继续依赖检查

## MODIFIED Requirements

### Requirement: 列表状态与切换时的 loading

应用 SHALL 在侧栏列表展示每张图片的处理状态（待选区、加载缩略图中、待预览、待确认、已确认可导出）。用户切换到仍在加载缩略图的图片时，主视图 SHALL 显示 loading 提示；缩略图就绪后 SHALL 显示原图缩略并等待用户选区。尚未生成预览的图片 SHALL 在预览区提示手动选区后点击「生成预览」。正在生成预览时主视图 SHALL 显示 loading。

#### Scenario: 切换到正在加载缩略图的图片

- **WHEN** 用户点击仍在加载缩略图的列表项
- **THEN** 主视图显示 loading，且不展示修复预览

#### Scenario: 缩略图加载完成后显示原图待选区

- **WHEN** 用户正查看某张加载中的图片且缩略图完成
- **THEN** loading 消失并显示原图缩略，预览区提示尚未生成预览

#### Scenario: 切换到已确认的图片

- **WHEN** 用户点击状态为已确认的列表项
- **THEN** 立即显示缓存的选区与修复预览，无 loading

### Requirement: 手动路径显式确认

对已生成与当前选区一致的修复预览的图片，应用 SHALL 显示「确认」按钮；用户 MUST 点击确认后该图片才变为可导出状态。应用 SHALL NOT 因自动检测成功而允许跳过确认。

#### Scenario: 手动预览后未确认不可导出

- **WHEN** 用户完成选区并生成预览但未点击确认
- **THEN** 「导出当前」对该图不可用或提示需先确认

#### Scenario: 手动确认后可导出

- **WHEN** 用户完成选区、生成预览并点击确认
- **THEN** 该图标记为可导出

#### Scenario: 无选区不可确认

- **WHEN** 当前图片没有任何有效选区
- **THEN** 「生成预览」与「确认」均不可将图片变为可导出

### Requirement: 导出当前与导出全部

应用 SHALL 提供「导出当前」与「导出全部」；仅可导出状态为「已确认」的图片。未选区、未预览或未确认的图片 SHALL NOT 被包含在导出全部中。

#### Scenario: 导出当前

- **WHEN** 用户选中已确认图片并点击导出当前且选择输出路径
- **THEN** 修复图写入该路径

#### Scenario: 导出全部跳过未确认项

- **WHEN** 队列中有 2 张未确认、3 张已确认，用户点击导出全部
- **THEN** 仅 3 张已确认图片写入目标文件夹，并提示跳过数量

### Requirement: GUI 使用说明

`python/watermark_remover/` 下 README 或独立 GUI 说明 SHALL 补充：`run-gui.sh` 在已有 `python3-dev` 时跳过重装、选图后不自动修复、形状工具与多选区、生成预览与确认、选区撤销/恢复快捷键、导出说明。

#### Scenario: 文档覆盖 GUI 流程

- **WHEN** 用户阅读 README 中 GUI 章节
- **THEN** 可了解手动选区、多选区、预览确认、快捷键与导出的完整操作路径

## REMOVED Requirements

### Requirement: 选择文件或文件夹并自动批量处理

**Reason**: 选图即 OCR+修复不符合「全部手动框选再预览确认」的使用方式。
**Migration**: 使用「选择文件或文件夹并加载缩略图」；修复仅在用户选区并点击「生成预览」后发生。

### Requirement: 自动检测路径与失败行为

**Reason**: GUI 去掉自动处理路径，避免误修与等待 OCR。
**Migration**: 用户使用手动形状工具绘制选区；CLI 自动检测不受影响。

### Requirement: 手动矩形框选（独立于关键词）

**Reason**: 单矩形且新框替换旧框无法覆盖不规则水印与多块水印。
**Migration**: 使用「手动形状工具与多选区」（矩形/椭圆/多边形/套索，多选区并集）。
