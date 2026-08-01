## 1. 脚本骨架

- [x] 1.1 创建目录 `tampermonkey/spec_paste/`，添加 `spec_paste.user.js` 元数据（`@match *://mms.pinduoduo.com/*`、`@run-at document-idle`、无 `@grant`）
- [x] 1.2 实现 IIFE 入口与常量：`SPEC_INPUT_SELECTOR`、扩展分隔符正则、`FILL_DELAY_MS`、`WAIT_TIMEOUT_MS`

## 2. DOM 与工具函数

- [x] 2.1 实现 `getSpecInputsInGroup(firstInput)`：返回同组内按 DOM 顺序排列的所有规格名称 input
- [x] 2.2 实现 `isFirstSpecInput(input)`：判断 input 是否为所在组第一个规格框
- [x] 2.3 实现 `parseSpecNames(text)`：BOM 去除、分隔符拆分、trim、过滤空项
- [x] 2.4 实现 `setInputValue(input, value)`：native setter + `input`/`change` 事件（对齐 price_calculator）
- [x] 2.5 实现 `delay(ms)` 与 `waitForSpecInput(groupRoot, index, timeout)`：MutationObserver + 轮询兜底

## 3. 批量填充核心逻辑

- [x] 3.1 实现 `fillSpecGroup(firstInput, names)` 异步状态机：顺序写入、80ms 间隔、超时中止
- [x] 3.2 粘贴项少于已有框时，清空剩余框
- [x] 3.3 实现 `isFilling` 防重入，填充中忽略新 paste

## 4. 粘贴事件绑定

- [x] 4.1 在 document 委托 `beforeinput`（`insertFromPaste`）与 `paste` 事件
- [x] 4.2 仅在 `isFirstSpecInput(target)` 时 `preventDefault` 并调用 `fillSpecGroup`
- [x] 4.3 非第一个框或非规格 input 时不拦截

## 5. 用户反馈

- [x] 5.1 实现轻量 toast（成功 / 部分超时 / 无有效内容），3s 自动消失
- [x] 5.2 填充结束根据结果调用对应 toast 文案

## 6. 文档与验证

- [x] 6.1 编写 `README.md`：环境依赖、脚本参数、使用配置、FAQ（含分隔符列表、仅第一个框粘贴、覆盖整组说明）
- [x] 6.2 在拼多多商家后台规格编辑页手动验证：逗号/换行粘贴、动态增行、覆盖已有值、超时提示
