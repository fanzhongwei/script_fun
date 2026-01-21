## 项目简介

本目录下的脚本 `turnstile_verify.py`，通过 **图像识别 + 拟人化鼠标轨迹 + 系统级鼠标控制**，在真实浏览器环境中自动通过 Cloudflare Turnstile 机器人验证，可用于自动化测试、RPA 任务等场景下的“人机验证”自动化。

核心思路与效果参考如下思路：

- 使用 `nodriver` 启动真实 Chrome / Chromium 浏览器，访问目标页面  
- 利用 `mss + OpenCV` 对屏幕截图，在整屏中定位 Turnstile 验证框的中心坐标  
- 通过贝塞尔曲线 + 随机扰动生成拟人化鼠标移动轨迹  
- 在 Linux 下调用 `xdotool`，在 Windows 下调用 `pyautogui`，以系统级方式控制鼠标移动和点击  
- 实测表明：相比传统 Selenium 直接点击元素，该方式更接近人类行为，对 Turnstile 这类基于行为分析和机器学习的验证机制更友好

![自动化机器人验证.png](https://mmbiz.qpic.cn/mmbiz_gif/14Blum0GwI5998grYlYz5LzoMuvMfxwdB3O09Ob5Sczf2gU518TkhFkzs9DickVMElJKRE7nc56CZT0aK7EO0cA/640?wx_fmt=gif&from=appmsg)

> 注意：本项目仅供学习研究与自动化测试使用，请勿用于任何违反目标网站服务条款或法律法规的行为。

---

## 环境依赖说明

- **操作系统**
  - 推荐：Linux（脚本默认使用 `xdotool` 控制鼠标）
  - Windows：支持（使用 `pyautogui` 获取/控制鼠标），需按需安装依赖

- **Python 版本**
  - Python **3.9+**（建议与 `nodriver` 官方文档保持一致）

- **Python 依赖（见本目录 `requirements.txt`）**
  - `nodriver`：基于 DevTools 协议的浏览器自动化库  
  - `opencv-python`：负责模板匹配与图像处理  
  - `mss`：跨平台屏幕截图  
  - `numpy`：贝塞尔曲线与向量计算  
  - （Windows 可选）`pyautogui`：系统级鼠标控制

- **系统级依赖**
  - **Linux**
    - `xdotool`：模拟鼠标移动与点击
      - 安装示例（Debian/Ubuntu）：
        ```bash
        sudo apt update && sudo apt install -y xdotool
        ```
  - **Windows**
    - 无需额外工具，可直接使用 `pyautogui` 控制鼠标  
    - 如遇到 `WinError 2` 之类错误，请确保 Python 环境和依赖正确安装，并在本机实际桌面环境中运行，而非纯命令行/无界面会话

---

## 脚本功能概览

- 自动启动浏览器并访问示例站点 `https://www.nowsecure.nl/`  
- 移除部分自动化特征（如 `navigator.webdriver`）以降低被识别风险  
- 截取当前主屏幕图像，使用模板图片 `turnstile_template.png` 匹配 Turnstile 验证框位置  
- 根据验证框中心坐标生成拟人化鼠标轨迹  
- 调用系统工具（Linux 使用 `xdotool`，Windows 使用 `pyautogui`）执行真实鼠标移动与点击  
- 模拟真实用户勾选“我不是机器人”之类的 Turnstile 验证操作

---

## 目录结构

- `turnstile_verify.py`：主脚本，包含浏览器控制、模板匹配、鼠标轨迹生成与系统级点击逻辑  
- `requirements.txt`：Python 依赖清单  
- `turnstile_template.png`：Turnstile 验证框模板图片（需保证验证框位于图片**正中心**）  
- `turnstile_verify.gif`：示例运行效果动图  

---

## 安装与运行步骤

### 1. 准备 Python 环境

```bash
cd /path/to/turnstile_verify

# 建议使用虚拟环境（可选）
python3 -m venv venv
source venv/bin/activate   # Windows 使用 venv\Scripts\activate
```

### 2. 安装 Python 依赖

```bash
pip install -r requirements.txt
```

如在 Windows 下运行，还需确保安装：

```bash
pip install pyautogui
```

### 3. 安装系统依赖（Linux）

```bash
sudo apt update && sudo apt install -y xdotool
```

确认 `xdotool` 可用：

```bash
xdotool getmouselocation
```

能正常输出坐标即可。

### 4. 启动脚本

```bash
python turnstile_verify.py
```

脚本会：

- 启动可视化浏览器（`headless=False`）  
- 自动访问示例页面  
- 等待页面加载并移除部分自动化标志  
- 自动定位 Turnstile 验证框  
- 拟人化移动鼠标并点击验证框

---

## 脚本参数说明

当前脚本使用 **固定配置**，未暴露命令行参数，关键参数写在代码中：

- 页面地址：
  - 位于 `main()` 中：
    - `tab = await driver.get("https://www.nowsecure.nl/")`
- 模板图片路径：
  - 位于 `main()` 中：
    - `x, y = template_location("turnstile_template.png")`
- 浏览器启动参数：
  - 位于 `uc.start()` 中：
    - `--lang=en-US`：浏览器语言
    - `--disable-dev-shm-usage`：解决部分环境下共享内存限制问题
- 鼠标轨迹参数：
  - 位于 `generate_human_mouse_vectors()`：
    - `steps`：轨迹步数（建议 30–100）
    - `jitter_factor`：轨迹抖动强度（越大越“飘忽”）

如需按项目需求做定制，可直接修改上述代码中的参数值。

---

## 使用配置说明

- **更换目标站点**
  - 将 `main()` 中的 URL 改为你的实际业务地址：
    ```python
    tab = await driver.get("https://your-target-domain.com/")
    ```

- **更换/调整模板图片**
  - 使用本机的 `mss` 或系统截图工具先截取整屏：
    ```python
    # 参考代码片段（已在脚本中内置）
    with mss.mss() as sct:
        sct.shot(output="screen.jpg")
    ```
  - 在图片编辑工具中裁剪出包含 Turnstile 验证框的小图，**确保验证框位于图片正中心**  
  - 保存为 `turnstile_template.png` 或其他文件名，并在 `template_location("...")` 中同步修改

    ![验证框模板.png](https://mmbiz.qpic.cn/mmbiz_png/14Blum0GwI5998grYlYz5LzoMuvMfxwd46bibmoiaJRjqyrx7jUWWroHQXTF7LicibEVDicuhPxjJtSOP8wPgz2qC7g/640?wx_fmt=png&amp;from=appmsg)

- **多显示器环境**
  - 当前实现默认截取“主屏幕”（`sct.shot(output="screen.jpg")`）  
  - 如验证框在副屏，可在 `mss` 部分根据 `sct.monitors` 调整截图区域

- **浏览器行为伪装**
  - 当前仅做了基础的自动化标志移除：
    ```python
    await tab.evaluate("""
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        window.chrome = {runtime: {}};
    """)
    ```
  - 如需更强伪装，可在此基础上增加 UA、时区、语言、分辨率等指纹调优逻辑。

---

## 工作原理简要说明

- **1. Turnstile 行为分析机制**
  - 通过鼠标移动轨迹、点击节奏、页面停留时间等行为特征，结合机器学习模型判断访问者是否为机器人  
  - 单纯的“瞬移式点击”“全直线轨迹”“毫无随机性”通常更容易触发机器人判定

- **2. 模板匹配定位验证框**
  - 利用 `mss` 截取整屏图像，并用 `opencv-python` 的 `matchTemplate` 算法在截图中查找模板图片  
  - 匹配到的矩形区域中心即为 Turnstile 验证框在 **屏幕坐标系** 下的 `(cx, cy)`  
  - 这种方式不依赖 DOM / shadow-root，可绕过 `shadow-root(closed)` 带来的元素不可见问题

- **3. 贝塞尔曲线 + 抖动生成鼠标轨迹**
  - 使用三次贝塞尔曲线生成从 `(start_x, start_y)` 到 `(end_x, end_y)` 的平滑曲线  
  - 在轨迹中部叠加强度随进度变化的随机抖动，使轨迹既平滑又略带“抖动”，更贴近人类手部肌肉控制特征  
  - 最后一步对累计误差进行修正，确保终点精确落在验证框中心附近

- **4. 系统级鼠标控制**
  - **Linux**：通过 `subprocess` 调用 `xdotool mousemove` / `xdotool click`  
  - **Windows**：通过 `pyautogui.moveTo` / `pyautogui.click`  
  - 与直接在浏览器内部触发 `click()` 事件不同，这种方式在操作系统层面产生真实输入事件，更符合人类行为模式

---

## FAQ 常见问题

- **Q1：运行时提示 `获取鼠标位置失败: [WinError 2] 系统找不到指定的文件。`**
  - 检查是否在 Windows 环境下正确安装并导入了 `pyautogui`：
    ```bash
    pip install pyautogui
    ```
  - 确保脚本在 **有桌面环境的会话** 中运行（例如本地登录桌面或远程桌面），而非仅在无 GUI 的终端环境  
  - 如果在 Linux 环境看到类似错误，多半是 `xdotool` 未安装或环境变量异常，请确认：
    ```bash
    xdotool getmouselocation
    ```

- **Q2：提示 `xdotool: command not found`**
  - 请在 Linux 上安装 `xdotool`：
    ```bash
    sudo apt update && sudo apt install -y xdotool
    ```

- **Q3：鼠标确实移动并点击了验证框，但仍然偶尔无法通过 Turnstile 验证？**
  - Turnstile 的模型会综合 IP、UA、指纹、行为历史等多维度特征，偶发验证失败属于正常现象  
  - 可适当：
    - 放慢整体操作节奏（增加 `sleep` 时间和鼠标移动耗时）  
    - 增加页面中其他自然行为（如滚动、随机移动鼠标）  
    - 减少同一 IP 的高频连续请求

- **Q4：模板匹配不到验证框，返回坐标为 `None` 或明显错误？**
  - 确认当前屏幕显示的 Turnstile 验证框样式与模板图片一致  
  - 确保模板图片中，验证框在**正中心**，且分辨率与当前屏幕比例接近  
  - 在多分辨率显示器、缩放比例≠100% 的情况下，可能需要在目标机器上重新截取模板图片

- **Q5：如何在自己的业务系统中复用这套方案？**
  - 步骤大致为：
    1. 替换 `main()` 中的目标 URL  
    2. 在业务页面上打开 Turnstile 所在的实际页面，按“获取模板图片”的方法重新截取模板  
    3. 根据实际 UI 布局微调等待时间、轨迹参数和滚动逻辑（如需先滚动到验证框）

---

## 参考资料

- nodriver 官方文档（Quickstart）：`https://ultrafunkamsterdam.github.io/nodriver/nodriver/quickstart.html`  
- OpenCV 模板匹配文档：`https://docs.opencv.org/3.4/df/dfb/group__imgproc__object.html`  
- OpenCV Python 教程：`https://docs.opencv.org/3.4/d6/d00/tutorial_py_root.html`


