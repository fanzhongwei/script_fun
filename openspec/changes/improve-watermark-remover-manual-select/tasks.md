## 1. 开发启动跳过已有 Python

- [x] 1.1 修改 `packaging/linux/bootstrap-python.sh`：`python3-dev` 可执行且 `--version` 成功则跳过 bootstrap，不再要求 `PY_ROOT/cpython/bin/python3`
- [x] 1.2 确认 `ensure-dev-env.sh` 仍仅在 `deps_ready` 失败时安装 pip 包，不因 1.1 误触发重装解释器
- [x] 1.3 用本机已有 `python3-dev` 跑一遍 `run-gui.sh` 前半段，确认无下载 CPython、无重建 venv

## 2. 数据模型与 mask 并集

- [x] 2.1 扩展 `gui/models.py`：`regions` 列表、选区快照 undo/redo 栈；导出条件仅已确认
- [x] 2.2 新增 `mask_from_regions`（矩形/椭圆/多边形/套索并集栅格化），不改 CLI `detect_auto`
- [x] 2.3 `pipeline.process_manual` 改为基于 `regions` 生成 mask 并 inpaint；去掉 GUI 对 `process_auto` / `rerun_auto` 的调用

## 3. 入队只加载缩略图

- [x] 3.1 `BatchWorker` 只 `load_task`，不 OCR、不 inpaint；状态为加载中/待选区
- [x] 3.2 `main_window` 去掉「自动检测」按钮与 `rerun_auto` worker
- [x] 3.3 列表文案与 loading 改为缩略图加载/待选区/待预览/待确认/已确认

## 4. 画布多形状多选区

- [x] 4.1 工具切换：矩形、椭圆、多边形、套索；完成一块后追加，不替换已有选区
- [x] 4.2 多边形：单击加点、双击或 Enter 闭合、Esc 取消未闭合路径
- [x] 4.3 套索：按下拖路径、松开闭合填充
- [x] 4.4 「清除全部」清空当前图选区（作为一次可撤销快照）
- [x] 4.5 切图时各自显示该图 `regions`，互不串扰

## 5. 撤销恢复与预览确认

- [x] 5.1 选区提交/清除后压入 regions 快照；撤销回到上一快照，恢复从 redo 栈弹出
- [x] 5.2 窗口级快捷键：Ctrl+Z 撤销；Ctrl+Y 与 Ctrl+Shift+Z 恢复；与按钮同一套栈
- [x] 5.3 多边形绘制中 Ctrl+Z 回退顶点或取消当前笔画
- [x] 5.4 任何选区变更作废 `preview_bgr`，禁止确认，直到再次「生成预览」成功
- [x] 5.5 「生成预览」要求至少一块有效选区；确认后才可「导出当前/全部」

## 6. 文档

- [x] 6.1 更新 `python/watermark_remover/README.md`：启动跳过 python3-dev、手动多选区、预览确认、撤销恢复快捷键
