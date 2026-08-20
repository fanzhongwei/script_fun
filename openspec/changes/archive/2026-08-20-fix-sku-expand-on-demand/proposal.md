## Why

拼多多商家后台商品编辑页在启用「价格计算器」后，SKU 虚拟表格高度在约 820px 与撑开后的超高值之间反复跳动，页面持续闪烁，空闲状态也会发生。根因是价格计算器在页面加载后用 `MutationObserver` 监听整棵 `document.body`，每次 DOM 变动都重新执行「先压回 820 → 再撑开」的展开逻辑；平台侧虚拟列表重渲后「已展开」退出条件更难满足，形成反馈环。需要立刻改为按需展开，保留展开能力但不允许循环触发。

## What Changes

- **移除**价格计算器在页面加载后的常驻 SKU 展开：删除（或停用）基于 `document.body` 的 `MutationObserver` 自动展开，以及加载后定时多次 `scheduleSkuTableExpand` 的空闲触发。
- **保留** SKU 虚拟表展开能力，改为**用户动作触发一次**：
  - 价格计算：打开计算器弹窗（及弹窗内「刷新」扫描）时展开一次，再扫描/回填。
  - 图片导出：采集/导出预览图前展开一次（沿用现有导出路径，确保无常驻监听）。
  - 商品包导入：进入依赖 SKU 表格的导入步骤时展开/校正高度一次（沿用流水线内 ensure，确保无常驻监听）。
- 展开过程仍可使用「先可滚动唤醒、再设目标高度」的实现，但**单次用户动作内至多完整跑一轮**，结束后不得因自身引发的 DOM 变动再次自动开跑。
- 不改变定价公式、导出分桶、导入流水线业务语义；不合并三个脚本文件。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `price-calculator`: 取消页面空闲/DOM 监听式自动展开；改为打开弹窗与刷新扫描时按需展开一次。
- `page-image-exporter`: 明确预览图相关展开仅在导出/采集动作时触发一次，禁止常驻 MutationObserver 驱动展开。
- `pdd-product-importer`: 明确 SKU 表格高度展开/校正仅在导入流水线相关步骤中按需触发，禁止常驻监听循环展开。

## Impact

- 代码：`tampermonkey/price_calculator/price_calculator.user.js`（主修复）；核对并必要时微调 `tampermonkey/image_exporter/image_exporter.user.js`、`tampermonkey/pdd_product_importer/pdd_product_importer.user.js`。
- 文档：对应三个脚本目录下的 README 中「SKU 虚拟表展开」说明需同步。
- 行为：进入商品编辑页且仅安装价格计算器时，空闲页不再闪烁；打开价格计算/导出预览图/导入商品包时仍会短暂展开表格（可接受的一次性高度变化）。
- 依赖：无新依赖。
