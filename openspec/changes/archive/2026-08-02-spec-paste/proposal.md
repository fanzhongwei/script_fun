## Why

拼多多商家后台商品规格编辑页中，规格名称需逐个输入；每填完一项页面才会动态出现下一个输入框。运营从 Excel 或文档复制多行/多列规格时，手动逐框粘贴效率低且易错。需要油猴脚本在第一个规格框粘贴时自动拆分并依次填充所有规格。

## What Changes

- 新增 Tampermonkey 用户脚本 `tampermonkey/spec_paste/`，作用于 `mms.pinduoduo.com` 商品规格编辑页
- 在任意规格组的**第一个**「请输入规格名称」输入框拦截粘贴事件，按常见分隔符拆分文本
- 依次写入各规格框；每写一项后等待页面动态增行，再继续下一项
- 粘贴时**覆盖整组**已有规格值（从第一个框开始重写）
- 不区分规格维度（颜色、尺码等），对所有 `.spec-input` 规格输入区域均生效
- 新增 README（环境依赖、参数、配置、FAQ）

## Capabilities

### New Capabilities

- `spec-paste`: 拼多多商家后台规格名称批量粘贴填充能力——粘贴拦截、分隔符解析、动态等待增行、受控 input 写入与结果提示

### Modified Capabilities

（无）

## Impact

- **新增文件**：`tampermonkey/spec_paste/spec_paste.user.js`、`tampermonkey/spec_paste/README.md`
- **依赖**：Tampermonkey；无 npm 依赖；可复用同仓库 `price_calculator` 的 React 受控 input 写入模式
- **兼容性**：与现有 `price_calculator` 脚本无冲突，作用 DOM 区域不同
- **系统**：仅浏览器端 DOM 操作，不涉及后端或 API
