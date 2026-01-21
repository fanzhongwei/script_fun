# https://ultrafunkamsterdam.github.io/nodriver/nodriver/quickstart.html
import nodriver as uc
import time
import datetime
import random
import math
import numpy as np
from math import atan2, sin, cos, sqrt
import subprocess
from pathlib import Path
import os

async def wait_and_send_keys(tab, elment, keys):
    input = await tab.select(f"input[id={elment}]")
    position = await input.get_position()
    await input.send_keys(keys)

async def wait_and_click(tab, elment):
    button = await tab.find(elment, best_match=True)
    await button.click()
    print(f"点击{elment}")

def generate_human_mouse_vectors(start_x, start_y, end_x, end_y, steps=30, jitter_factor=0.5):
    """
    生成拟人化鼠标移动向量（基于物理模型 + 随机扰动）
    
    参数:
        start_x, start_y: 起始坐标
        end_x, end_y: 目标坐标
        steps: 总步数（建议30-100）
        jitter_factor: 随机抖动强度（0.1-1.0）
    返回:
        List[Tuple[dx, dy]]: 位移向量序列
    """
    # 总位移向量
    total_dx = end_x - start_x
    total_dy = end_y - start_y
    
    # 1. 生成基础贝塞尔曲线控制点（模拟加速-减速）
    control_dist = math.sqrt(total_dx**2 + total_dy**2) * 0.3
    angle = math.atan2(total_dy, total_dx)
    
    # 控制点1：起始点向右偏移（模拟初始加速）
    ctrl1_x = start_x + math.cos(angle) * control_dist * 0.5
    ctrl1_y = start_y + math.sin(angle) * control_dist * 0.5
    
    # 控制点2：结束点向左偏移（模拟减速）
    ctrl2_x = end_x - math.cos(angle) * control_dist * 0.7
    ctrl2_y = end_y - math.sin(angle) * control_dist * 0.7
    
    # 2. 生成贝塞尔曲线路径点
    t = np.linspace(0, 1, steps)
    points = []
    for ti in t:
        # 三次贝塞尔曲线公式
        x = (1-ti)**3 * start_x + 3*(1-ti)**2*ti*ctrl1_x + 3*(1-ti)*ti**2*ctrl2_x + ti**3*end_x
        y = (1-ti)**3 * start_y + 3*(1-ti)**2*ti*ctrl1_y + 3*(1-ti)*ti**2*ctrl2_y + ti**3*end_y
        points.append((x, y))
    
    # 3. 添加随机抖动（Perlin噪声更佳，此处简化）
    for i in range(1, len(points)):
        # 抖动强度随进度变化（中间强，两端弱）
        progress = i / len(points)
        current_jitter = jitter_factor * math.sin(progress * math.pi)
        
        points[i] = (
            points[i][0] + random.uniform(-current_jitter, current_jitter),
            points[i][1] + random.uniform(-current_jitter, current_jitter)
        )
    
    # 4. 转换为位移向量并确保总位移精确
    vectors = []
    current_x, current_y = start_x, start_y
    for p in points[1:]:
        dx = p[0] - current_x
        dy = p[1] - current_y
        vectors.append((dx, dy))
        current_x += dx
        current_y += dy
    
    # 5. 修正累积误差（确保严格到达终点）
    error_x = end_x - current_x
    error_y = end_y - current_y
    if vectors:
        vectors[-1] = (vectors[-1][0] + error_x, vectors[-1][1] + error_y)
    
    return vectors

def get_mouse_position():
    try:
        # 执行 xdotool 命令获取鼠标位置
        output = subprocess.check_output(["xdotool", "getmouselocation"]).decode("utf-8")
        
        # 解析输出（格式示例：x:123 y:456 screen:0 window:12345）
        x = output.split("x:")[1].split()[0]
        y = output.split("y:")[1].split()[0]
        return (int(x), int(y))
    except Exception as e:
        print(f"获取鼠标位置失败: {e}")
        return (0, 0)

async def mouse_move_and_click_real(x, y):
    # 获取当前鼠标位置
    is_linux = (os.name == 'posix')
    print(f"操作系统类型: {os.name}，is_linux：{is_linux}")
    if is_linux:
        # Linux自带工具
        print("Linux自带工具xdotool获取当前坐标位置")
        start_x, start_y = get_mouse_position()
    else:
        # pyautogui
        print("Windows 使用pyautogui获取当前坐标位置")
        import pyautogui
        start_x, start_y = pyautogui.position()

    print(f"当前坐标位置: {start_x}, {start_y}")
    print(f"目标坐标位置: {x}, {y}")
    steps = math.floor(random.uniform(20, 30))
    vectors = generate_human_mouse_vectors(start_x, start_y, x, y, steps)
    current_x = start_x
    current_y = start_y
    for i in range(1, len(vectors)):
        target_x = vectors[i][0]
        target_y = vectors[i][1]
        current_x += target_x
        current_y += target_y
        if is_linux:
            # Linux自带工具
            subprocess.run(["xdotool", "mousemove", f"{current_x}", f"{current_y}"])
        else:
            # pyautogui
            pyautogui.moveTo(current_x, current_y, duration=random.uniform(0.001, 0.005))
    # 最终修正到准确位置
    if is_linux:
        # Linux自带工具
        subprocess.run(["xdotool", "mousemove", f"{x}", f"{y}"])
        subprocess.run(["xdotool", "click", "1"])  # 左键点击
    else:
        # pyautogui
        pyautogui.moveTo(x, y, duration=random.uniform(0.05, 0.1))
        pyautogui.click()


def template_location(template_image):
        """
        attempts to find the location of given template image in the current viewport
        the only real use case for this is bot-detection systems.
        you can find for example the location of a 'verify'-checkbox,
        which are hidden from dom using shadow-root's or workers.

        template_image can be custom (for example your language, included is english only),
        but you need to create the template image yourself, which is just a cropped
        image of the area, see example image, where the target is exactly in the center.
        template_image can be custom (for example your language), but you need to
        create the template image yourself, where the target is exactly in the center.

        example (111x71): https://ultrafunkamsterdam.github.io/nodriver/_images/template_example.png
        ---------
        this includes the white space on the left, to make the box center

        .. image:: template_example.png
            :width: 111
            :alt: example template image


        :param template_image:
        :type template_image:
        :return:
        :rtype:
        """
        try:
            import cv2
        except ImportError:
            print(
                """
                missing package
                ----------------
                template_location function needs the computer vision library "opencv-python" installed
                to install:
                pip3 install opencv-python
            
            """
            )
            return
        try:
            import mss
        except ImportError:
            print(
                """
                missing package
                ----------------
                template_location function needs "mss" installed
                to install:
                pip3 install mss
            
            """
            )
            return
        try:

            template_image = Path(template_image)
            if not template_image.exists():
                raise FileNotFoundError(
                    "%s was not found in the current location : %s"
                    % (template_image, os.getcwd())
                )
                
            # 截取全屏
            with mss.mss() as sct:
                # 获取所有显示器信息
                monitors = sct.monitors
    
                # 截取主屏幕（显示器 1）
                screenshot = sct.shot(output="screen.jpg")
            time.sleep(0.05)
            im = cv2.imread("screen.jpg")
            im_gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
            # 读取模板图片
            template = cv2.imread(str(template_image))
            template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
            # 匹配模板顶点位置
            match = cv2.matchTemplate(im_gray, template_gray, cv2.TM_CCOEFF_NORMED)
            (min_v, max_v, min_l, max_l) = cv2.minMaxLoc(match)
            (xs, ys) = max_l
            tmp_h, tmp_w = template_gray.shape[:2]
            xe = xs + tmp_w
            ye = ys + tmp_h
            cx = (xs + xe) // 2
            cy = (ys + ye) // 2
            return cx, cy
        except (TypeError, OSError, PermissionError):
            pass  # ignore these exceptions
        except:  # noqa - don't ignore other exceptions
            raise
        finally:
            try:
                os.unlink("screen1.jpg")
            except:
                print("could not unlink temporary screenshot")

async def main():
    print(f"开始验证，{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("正在启动浏览器...")
    # 初始化浏览器
    driver = await uc.start(
        headless=False,
        browser_args=[
            "--lang=en-US",
            "--disable-dev-shm-usage"
        ]
    )
    
    try:
        # 访问页面
        tab = await driver.get("https://www.nowsecure.nl/")
        
        # 删除自动化标志
        await tab.evaluate("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)
        time.sleep(8)  # 等待页面加载
        
        # 自动处理机器人验证
        print("正在处理机器人验证...")

        # 自动获取验证框位置
        x, y = template_location("turnstile_template.png")

        print(f"自动获取验证框位置：（{x}, {y}）")
        await mouse_move_and_click_real(x, y)
        time.sleep(5)
        
        print(f"验证完成！{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
    except Exception as e:
        print(f"发生错误: {str(e)}")
    
    finally:
        # 等待一段时间后关闭浏览器
        time.sleep(10)
        driver.stop()

if __name__ == "__main__":
    # main()
    uc.loop().run_until_complete(main())