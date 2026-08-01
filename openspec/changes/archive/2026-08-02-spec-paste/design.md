## Context

拼多多商家后台（`mms.pinduoduo.com`）商品规格编辑页使用 beast-core 组件。规格名称输入框位于 `.spec-input` 容器内，`placeholder="请输入规格名称"`。填完一项后 React 才渲染下一输入框，无法一次性 query 全部 input 后批量赋值。

同仓库 `price_calculator` 已验证：beast-core 受控 input 需通过 native value setter + 触发 `input`/`change` 事件写入；批量粘贴可用 `beforeinput`（`insertFromPaste`）+ `paste` 拦截。本脚本复用该模式，不引入新依赖。

动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 在任意规格组第一个输入框粘贴时，拆分并依次填充整组规格
- 支持尽可能全的常见分隔符
- 粘贴时覆盖整组已有值
- 动态等待下一输入框出现后再继续填充
- 填充完成后给出简要结果提示

**Non-Goals:**

- 不修改 SKU 价格、库存等其他字段
- 不提供悬浮面板、快捷键或独立批量输入 UI
- 不在非第一个规格框触发批量逻辑
- 不处理平台侧校验失败（重复名、敏感词等）的自动重试
- 不与 `price_calculator` 合并为同一脚本

## Decisions

### 1. 触发：仅第一个规格框粘贴拦截

在 document 级委托 `paste` / `beforeinput`，判断 `event.target` 是否为某规格组内**第一个** `.spec-input input[placeholder="请输入规格名称"]`（按 DOM 顺序该组内 index 0）。是则 `preventDefault` 并启动填充流程；否则不干预。

**备选**：MutationObserver 绑定每个 input — 复杂且 SPA 切页难维护；**放弃**。

### 2. 「第一个框」与「整组」定义

- **规格组**：同一父级规格编辑区域内，所有 `.spec-input` 下的规格名称 input，按 DOM 顺序排列
- **第一个框**：用户 paste 时 focus 的 input，且为该组内第一个 input
- **覆盖整组**：从 index 0 起按序写入；超出粘贴项数的已有框清空（写入空串并触发事件）；不足项数时等待动态增行

不区分颜色/尺码等维度标签，凡匹配 selector 的 input 均纳入同一组逻辑。

### 3. 分隔符

```javascript
/[\s,;，；|｜/／\\、\t\n\r]+/
```

覆盖：空格、逗号、中英文分号、竖线、斜杠、反斜杠、顿号、制表符、换行。去 BOM、trim、过滤空串。

**备选**：仅复用 `price_calculator` 的 `PASTE_SPLIT` — 覆盖不足；**扩展**。

### 4. 受控 input 写入

```javascript
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(input, value);
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

与 `price_calculator` 保持一致。

### 5. 动态等待策略

顺序填充异步状态机：

1. 解析粘贴文本为 `names[]`
2. `i = 0`：获取组内第 `i` 个 input（必要时等待）
3. `setInputValue(input, names[i])`
4. `i++`；若 `i < names.length`，等待第 `i` 个 input 出现后继续
5. 若 `i >= names.length` 且组内仍有更多 input，清空剩余框

**等待实现**：MutationObserver 监听规格区域 `subtree` + 50ms 轮询兜底；单项最长等待 3s，超时则中止并提示已填项数与剩余项数。

**填值间隔**：每次写入后 `await delay(80)`，给 React 增行留时间（实现时可微调）。

### 6. 并发与重入

填充过程中设置 `isFilling` 标志，忽略新的 paste。避免重复触发。

### 7. 脚本结构与 @match

```
tampermonkey/spec_paste/
├── spec_paste.user.js
└── README.md
```

- `@match *://mms.pinduoduo.com/*`
- `@run-at document-idle`
- 无 `@grant`（纯 DOM，无需 GM API）
- 使用 event delegation + 必要时在 DOM 变化后重新确认规格区域根节点

### 8. 用户反馈

页面右上角轻量 toast（纯 CSS，不依赖第三方），3s 自动消失：

- 成功：`已填充 N 项规格`
- 部分失败：`已填充 N 项，剩余 M 项超时未填入`
- 无效粘贴：`未识别到有效规格名称`

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| beast-core 类名 hash 变化 | 依赖 `placeholder` 与 `.spec-input`，避免 `IPT_input_*` |
| 填值后平台校验阻止增行 | 超时提示；README 说明需手动处理重复/非法名 |
| 多规格组 DOM 结构变化 | selector 尽量宽松；README 注明适用页面 |
| 清空剩余框可能误删用户手动输入 | 仅在「粘贴覆盖整组」流程内执行，符合产品决策 |
| SPA 路由切换后监听失效 | `document-idle` 注入 + 委托到 document，不绑死单一容器 |

## Migration Plan

1. 新增脚本目录与文件，不影响现有脚本
2. 用户在 Tampermonkey 安装/更新脚本
3. 回滚：禁用或卸载脚本即可，无数据迁移

## Open Questions

（无——站点、触发方式、覆盖策略、分隔符范围已在 proposal 阶段确认）
