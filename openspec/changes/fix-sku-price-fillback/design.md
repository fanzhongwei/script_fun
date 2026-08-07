## Context

见 `proposal.md` - Why。当前 `fillBackAll` 同步遍历全部行并连续 `dispatchEvent`，SKU 多时阻塞主线程；统计处在 `styleOk === false` 时先 `fail++`，写入成功后又 `success++`，导致双计。

## Goals / Non-Goals

**Goals**

- 分批异步回填，保持页面可交互
- 进度提示 + 按钮防重入
- 成功/跳过/失败计数互斥正确

**Non-Goals**

- 不改计算引擎、扫描逻辑、虚拟表展开策略
- 不引入 Web Worker 或新依赖
- 不实现可取消回填（可后续增强）

## Decisions

1. **批次大小固定为 12 行**  
   - 理由：在「减少卡顿」与「完成速度」间折中；无需配置项  
   - 备选：自适应批次 —— 暂不需要

2. **让出方式：`await sleep(0)` + 可选 `requestAnimationFrame`**  
   - 理由：已有 `sleep`；`0` 延迟足以把控制权交还事件循环  
   - 每批结束后更新进度 toast

3. **进度用现有 `showNotice`**  
   - 理由：复用 UI，无新面板；进度期间可缩短自动消失或不依赖其时长（每批刷新即可）  
   - 最终汇总仍用 `showNotice`

4. **去掉会误伤的 style 双计路径**  
   - 信任扫描时绑定的 `groupInput`/`singleInput`；写入失败才计 fail  
   - 若 input 已脱离文档（`isConnected === false`）则计 fail 并跳过

5. **`fillBackAll` 改为 async，按钮 `disabled` 防重入**  
   - 用模块级 `fillBackRunning` + `fillBtnRef`（或查询 `.pc-fill-btn`）

## Risks / Trade-offs

- [Risk] React 仍可能在每批后重渲导致短暂卡顿 → Mitigation：批次 12，必要时再调小  
- [Risk] 进度 toast 频繁重建轻微闪烁 → Mitigation：可接受；后续可改为原地改文案  
- [Risk] 虚拟表未展开时部分 input 引用失效 → Mitigation：`isConnected` 检查计 fail；依赖既有展开逻辑

## Migration Plan

- 升级油猴脚本版本即可，无数据迁移  
- 回滚：恢复同步 `fillBackAll` 即可
