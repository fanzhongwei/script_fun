## Context

见 proposal.md 动机。现有 GUI：`BatchWorker` 选图后对每张 `process_auto`（OCR+缩略 inpaint）；画布仅一个 `QGraphicsRectItem`，左键按下 `clear_rect`。开发启动 `bootstrap-python.sh` 的 `need_bootstrap` 要求 `${PY_ROOT}/cpython/bin/python3`，与本机 `/home/develop/python/python-3.12/...` + `venvs/python-dev` 布局不一致，导致每次重装。导出仍用 `thumb_mask` 映射后在 max 边 1024 上 LaMa（与现实现一致，本变更不改导出分辨率策略）。

## Goals / Non-Goals

**Goals:**

- 用「可运行的 python3-dev」判定跳过 bootstrap，不绑定 `cpython/` 目录
- GUI 选图只加载缩略图；去掉自动检测按钮与入队 OCR
- 选区几何列表 + 并集栅格化为一张 mask，复用现有 `Inpainter`
- 每张图独立的选区 undo/redo 栈，快捷键与按钮共用
- 选区与预览版本不一致时禁止确认

**Non-Goals:**

- 不改 CLI 自动检测
- 不新增加速库或替换 LaMa
- 不做魔棒/GrabCut 等半自动抠图
- 不把选区历史持久化到磁盘
- 不修改 Tampermonkey 脚本

## Decisions

### 1. Bootstrap 判定：解释器可运行即可

- **决策**：`need_bootstrap` 改为：`python3-dev` 在 PATH 上且 `--version` 成功则跳过；不再检查 `PY_ROOT/cpython`。venv 包装脚本已存在时不要 `rm -rf` venv。
- **理由**：本机 python3-dev 已指向 `venvs/python-dev`，缺的只是脚本假设的目录名。
- **备选**：软链 `cpython` → 真实目录 — 脆弱，换机器仍会炸。
- **依赖安装**：保持 `deps_ready` 失败才 pip，与本次「不要重装 Python」分开。

### 2. 入队只解码缩略图

- **决策**：`BatchWorker`（或改名 LoadWorker）只调用 `load_task`，不调用 `process_auto`；状态从 queued/processing-auto 改为「加载中 → 待选区」。
- **理由**：KISS；去掉 GUI 对 EasyOCR 的热路径，入队变快。
- **备选**：选图同步解码 — 多图时卡住主线程。
- **移除**：主窗口「自动检测」按钮及 `ManualWorker(rerun_auto=True)`。

### 3. 选区模型：几何列表，不是单矩形

```
RegionKind: rect | ellipse | polygon | lasso
Region: { kind, 点集或 x,y,w,h }  # 坐标相对 thumb
ImageTask.regions: list[Region]
thumb_mask = rasterize_union(regions, thumb_hw)
```

- **决策**：坐标存在缩略图空间（与现 canvas 一致）。预览与导出工作图均为 max 边 1024，几何栅格化一次即可。
- **理由**：不必上原图像素编辑；并集 mask 与现 `process_manual` / `export_task` 接口兼容，只把 `mask_from_rect` 换成 `mask_from_regions`。
- **备选**：存原图坐标 — 预览缩放时映射更烦，收益小。

### 4. 画布工具与追加语义

- **决策**：工具栏互斥：矩形（拖）、椭圆（拖外接框）、多边形（单击加点，双击或 Enter 闭合，Esc 取消未闭合）、套索（按下移动、松开闭合填充）。新完成的一块 **追加** 到 `regions`，不再清空旧选区。「清除全部」仍保留。
- **理由**：多水印一次修；不规则边用多边形/套索。
- **Qt**：`QGraphicsPathItem` / `QPainterPath`；栅格化用 `cv2.fillPoly` / `cv2.ellipse` 或把 path 画到 QImage 再转 numpy。

### 5. Undo / Redo：每图一条栈，命令粒度为「整块选区」

- **决策**：每张 `ImageTask` 维护 `undo_stack` / `redo_stack`。完成一块选区 = 压入 undo 并清空 redo；撤销弹出最后一块；恢复从 redo 拿回。多边形绘制中：Ctrl+Z 优先回退最后一个顶点，无顶点则取消本次绘制。
- **快捷键**：主窗口 `QShortcut`：Ctrl+Z 撤销，Ctrl+Y 与 Ctrl+Shift+Z 恢复（Linux/Windows）。画布有焦点时快捷键仍要生效（shortcut context `WindowShortcut`）。
- **理由**：用户明确要求键盘撤销/恢复；粒度按「块」比按像素笔画好理解。
- **备选**：全局单一栈跨图片 — 切图后 Ctrl+Z 会改错图，禁止。
- **改选区副作用**：任何 regions 变更将 `preview_bgr=None`、状态退回待预览，禁止确认。

### 6. 预览与确认状态机

```
待选区 --(≥1 块有效选区)--> 可预览 --(生成预览成功)--> 待确认 --(确认)--> 已确认
                ▲                    │
                └── 改选区/撤销/恢复 ─┘  作废 preview
```

- **决策**：可导出仅 `CONFIRMED`；删除 `READY` 作为 GUI 导出条件（或保留枚举但不再赋值）。
- **生成预览**：`ManualWorker` 只走 `process_manual_regions(task)`，内部并集 inpaint。

### 7. 变更范围最小化

- **不动**：`inpainter.py`、CLI、`detector.detect_auto`（CLI 仍用）。
- **小动**：`detector.mask_from_rect` 旁新增 `mask_from_regions`，或放在 `gui` / `image_utils`，避免 CLI 行为变化。

## Risks / Trade-offs

- [误判 bootstrap] PATH 上的 python3-dev 指向损坏包装 → 启动失败。缓解：`--version` 失败则再走 bootstrap，并打印当前路径。
- [套索自交/过密点] 路径自交填充结果难看。缓解：直接 fill 即可，不先简化；用户可撤销重画。
- [快捷键与文本框冲突] 当前 GUI 几乎无输入框。缓解：无焦点在可编辑控件时才处理；若以后加搜索框再收窄 context。
- [多选区 LaMa 一次修] 两块相距很远可能互相影响纹理。缓解：接受单 mask 一次 inpaint（与产品「一次预览」一致）；不拆多次 inpaint（复杂且更慢）。
- [undo 与清除全部] 「清除全部」应作为一次可撤销操作（压入「空列表」相对快照，或压入删除全部的命令）。缓解：用 regions 快照栈比差分命令更简单、不易错。

快照栈细化：每次选区提交/清除后 `undo_stack.append(copy(regions))`，撤销即回到上一快照。比「只弹最后一块」更能覆盖「清除全部」。**采用 regions 列表快照** 作为 undo 单元。

## Migration Plan

- 开发者：更新后直接 `./run-gui.sh`，已有 python3-dev 应秒过 bootstrap。
- 已打包 GUI：随下次构建发布；旧包仍是自动队列，无数据迁移。
- 回滚：还原 bootstrap 判定与 GUI 自动队列即可。

## Open Questions

（无。形状四种、快捷键、跳过 bootstrap 的判定已在 specs 钉死。）
