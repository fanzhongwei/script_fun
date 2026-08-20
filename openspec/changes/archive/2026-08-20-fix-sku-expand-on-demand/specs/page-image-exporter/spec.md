## ADDED Requirements

### Requirement: 预览图采集前按需展开 SKU 表

图片导出器在采集拼多多 SKU 预览图（`.sku-preview-cell`）之前，SHALL 对当前页 SKU 虚拟表执行至多一轮展开（设置内层滚动容器高度并清理 spacer padding，使预览行可访问）。脚本 SHALL NOT 在页面空闲时通过常驻 MutationObserver 或等价持续监听自动反复展开 SKU 表格。

#### Scenario: 空闲页不因导出器展开而闪烁

- **WHEN** 用户进入商品编辑页且启用图片导出器，但未发起预览图采集或导出
- **THEN** 脚本不反复修改 SKU 表格高度

#### Scenario: 导出/采集预览图前展开一次

- **WHEN** 用户发起包含 SKU 预览图的采集或导出流程
- **THEN** 系统在读取预览图 DOM 之前完成至多一轮 SKU 虚拟表展开，再按行顺序采集预览图
