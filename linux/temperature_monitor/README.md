# 温度监控脚本

## 📖 简介

这是一个基于 `sensors` 命令的温度监控脚本，可以实时检测系统硬件温度，当温度超过设定阈值时自动发送系统通知。脚本支持两种运行模式：后台循环检测模式和单次检测模式（适用于 cron 定时任务）。

**配置文件支持**：脚本支持配置文件模式，可以同时监控多个硬件设备，每个设备可以独立配置阈值和开关。首次运行时会自动扫描硬件并创建配置文件。

**NVIDIA GPU 监控**：如果系统安装了 NVIDIA 驱动和 `nvidia-smi` 工具，脚本会自动检测并支持监控 NVIDIA 显卡温度。

**通知应用名称**：脚本会自动创建 desktop 文件，用于确保系统通知显示正确的应用名称。

## 🔧 环境依赖说明

### 必需依赖

1. **lm-sensors** - 用于读取硬件温度传感器数据
   - Ubuntu/Debian: `sudo apt-get install lm-sensors`
   - CentOS/RHEL: `sudo yum install lm_sensors`
   - 安装后需要运行 `sudo sensors-detect` 进行传感器检测和配置

2. **libnotify-bin** - 用于发送系统桌面通知
   - Ubuntu/Debian: `sudo apt-get install libnotify-bin`
   - CentOS/RHEL: `sudo yum install libnotify-utils`

### 可选依赖

- **bc** - 用于浮点数比较（如果未安装，脚本会自动使用 awk 作为替代）

- **nvidia-smi** - 用于监控 NVIDIA 显卡温度（如果系统有 NVIDIA 显卡）
  - 通常随 NVIDIA 驱动一起安装
  - 如果已安装 NVIDIA 驱动但 `nvidia-smi` 不可用，请检查驱动安装是否正确
  - 脚本会自动检测 `nvidia-smi` 是否可用，如果可用则会在硬件扫描时自动添加 NVIDIA GPU 设备

### 环境要求

- Linux 系统
- Bash 4.0 或更高版本
- 支持桌面通知的图形环境（如 GNOME、KDE、XFCE 等）

## 📝 脚本参数说明

脚本支持以下命令行参数：

| 参数 | 长参数 | 说明 | 默认值 | 必需 |
|------|--------|------|--------|------|
| `-d` | `--device DEVICE` | 指定硬件设备名（如 `coretemp-isa-0000`），如果不指定则自动使用第一个可用设备 | 自动检测 | 否 |
| `-a` | `--alias ALIAS` | 设置设备别名（用于显示，如"CPU"、"GPU"等），如果不指定则自动识别设备类型 | 自动识别 | 否 |
| `-t` | `--threshold TEMP` | 温度阈值（摄氏度），超过此值将发送通知 | 80°C | 否 |
| `-i` | `--interval SECONDS` | 检测间隔（秒），仅在后台模式有效 | 60秒 | 否 |
| `-n` | `--app-name NAME` | 通知应用名称（用于通知标题显示） | "温度监控" | 否 |
| `-u` | `--urgency LEVEL` | 通知紧急级别（normal/critical/low） | normal | 否 |
| `-b` | `--background` | 启用后台运行模式，循环检测温度 | - | 否 |
| `-c` | `--check-once` | 单次检测模式，执行一次检测后退出（适用于 cron） | - | 否 |
| `-r` | `--reconfigure` | 重新扫描硬件并生成配置文件 | - | 否 |
| `-h` | `--help` | 显示帮助信息 | - | 否 |

### 参数说明

- **设备名（-d/--device）**: 
  - 可以通过运行 `sensors` 命令查看可用的设备名
  - 设备名通常是类似 `coretemp-isa-0000`、`acpitz-acpi-0` 等格式
  - **NVIDIA GPU 设备**：如果系统有 NVIDIA 显卡，设备名格式为 `nvidia-gpu-0`、`nvidia-gpu-1` 等（0 表示第一个 GPU，1 表示第二个 GPU，以此类推）
  - 如果不指定，脚本会自动选择第一个可用的温度传感器设备
  - **脚本会自动识别设备类型**（CPU、显卡、内存、硬盘、主板等），无需手动指定

- **设备别名（-a/--alias）**:
  - 可选参数，用于自定义设备显示名称
  - 如果不指定，脚本会根据设备名和传感器信息自动识别设备类型
  - 自动识别支持的类型：CPU、显卡、内存、硬盘、主板、硬件设备
  - 示例：`-a "CPU"` 或 `-a "我的CPU"`

- **温度阈值（-t/--threshold）**:
  - 单位为摄氏度（°C）
  - 支持小数，如 `85.5`
  - 当检测到的温度超过此值时，会发送系统通知

- **检测间隔（-i/--interval）**:
  - 单位为秒
  - 仅在后台模式（`-b`）下有效
  - 建议设置值 >= 10 秒，避免过于频繁的检测

- **通知应用名（-n/--app-name）**:
  - 用于设置系统通知中显示的应用名称
  - 如果通知标题显示不正确（如显示为"IntelliJ IDEA"），可以通过此参数手动指定
  - 示例：`-n "温度监控系统"`

- **通知紧急级别（-u/--urgency）**:
  - 设置通知的紧急级别，控制通知的行为和显示方式
  - **normal**（默认）：正常级别，通知会自动消失
  - **critical**：紧急级别，通知不会自动消失，需要用户手动关闭
  - **low**：低级别，通知会自动消失
  - 示例：`-u critical`（使用紧急级别，通知不会自动消失）

- **运行模式**:
  - 默认模式：单次检测，执行一次后退出
  - `-b` 模式：后台循环检测，持续运行
  - `-c` 模式：明确指定单次检测（适用于 cron）

## 🚀 使用配置说明

### 配置文件模式（推荐）

#### 1. 首次运行 - 自动创建配置文件

首次运行脚本时，如果没有配置文件，脚本会自动扫描硬件并创建配置文件：

```bash
./temperature_monitor.sh
```

配置文件会创建在脚本同目录下：`temperature_monitor.conf`

#### 2. 编辑配置文件

配置文件格式如下：

```ini
# 温度监控配置文件
# 格式说明：
# [设备名] - 设备标识符（sensors命令输出的设备名）
# type - 设备类型（CPU/显卡/内存/硬盘/主板/硬件设备）
# enabled - 是否启用监控（true/false）
# threshold - 温度阈值（摄氏度）
# alias - 设备别名（用于显示，可选）

# 全局配置
# interval - 循环检测的时间间隔（秒，仅在后台模式有效）
interval=60

[coretemp-isa-0000]
type=CPU
enabled=true
threshold=80
alias=CPU

[amdgpu-pci-0100]
type=显卡
enabled=true
threshold=85
alias=显卡
```

**全局配置说明**：
- `interval`：循环检测的时间间隔（秒），仅在后台模式（`-b`）下有效
  - 默认值：60秒
  - 修改此配置后，后台运行的脚本会在下次循环时自动读取新的间隔值
  - 无需重启脚本，配置会实时生效

**配置文件实时读取**：
- 后台循环检测模式下，脚本会在每次循环时重新读取配置文件
- 修改配置文件中的设备配置（enabled、threshold、alias）后，会在下次循环时自动生效
- 修改 `interval` 配置后，会在下次循环时自动使用新的间隔值
- 无需重启脚本，所有配置修改都会实时生效

**配置说明**：
- `[设备名]`：sensors 命令输出的设备标识符
- `type`：设备类型，脚本会自动识别，也可以手动修改
- `enabled`：`true` 表示启用监控，`false` 表示禁用
- `threshold`：温度阈值（摄氏度），超过此值会发送通知
- `alias`：设备显示名称，用于通知中显示

#### 3. 使用配置文件运行

配置好文件后，直接运行脚本即可监控所有启用的设备：

```bash
# 单次检测所有启用的设备
./temperature_monitor.sh

# 后台循环检测
./temperature_monitor.sh -b

# 指定检测间隔（后台模式）
./temperature_monitor.sh -b -i 30

# 重新扫描硬件并更新配置文件
./temperature_monitor.sh -r
```

### 命令行参数模式（向后兼容）

如果使用命令行参数，脚本会使用参数模式，而不是配置文件模式：

```bash
# 指定阈值进行单次检测
./temperature_monitor.sh -t 85

# 指定设备和阈值进行单次检测
./temperature_monitor.sh -d "coretemp-isa-0000" -t 85

# 自定义设备显示名称
./temperature_monitor.sh -d "coretemp-isa-0000" -a "CPU" -t 85

# 指定通知应用名和紧急级别
./temperature_monitor.sh -t 85 -n "温度监控系统" -u normal
```

#### 2. 后台循环检测模式

```bash
# 使用默认配置启动后台监控
./temperature_monitor.sh -b

# 指定设备、阈值和检测间隔启动后台监控
./temperature_monitor.sh -d "coretemp-isa-0000" -t 80 -i 30 -b
```

后台模式启动后会：
- 在 `/tmp/temperature_monitor_<设备名>.pid` 创建 PID 文件
- 在后台持续运行，按设定间隔检测温度
- 如果温度超过阈值，会发送系统通知

#### 3. Cron 定时任务配置

使用 cron 定时执行单次检测：

```bash
# 编辑 crontab
crontab -e

# 添加以下行（每5分钟检测一次）
*/5 * * * * /path/to/temperature_monitor.sh -c -t 85

# 或者每10分钟检测一次，并指定设备
*/10 * * * * /path/to/temperature_monitor.sh -c -d "coretemp-isa-0000" -t 80
```

**注意事项**：
- 使用 cron 时建议使用绝对路径
- 如果需要在 cron 中发送通知，可能需要设置 `DISPLAY` 环境变量
- 建议使用 `-c` 参数明确指定单次检测模式

### 查看可用设备

在运行脚本前，可以先查看系统中有哪些温度传感器设备：

```bash
# 查看所有传感器信息
sensors

# 查看设备列表（第一行通常是设备名）
sensors | head -20
```

### 停止后台监控

如果脚本在后台运行，可以通过以下方式停止：

```bash
# 方法1：通过 PID 文件查找并停止
PID=$(cat /tmp/temperature_monitor_<设备名>.pid)
kill $PID

# 方法2：查找进程并停止
pkill -f temperature_monitor.sh

# 方法3：如果知道 PID
kill <PID>
```

### 查看运行状态

```bash
# 检查是否有后台进程在运行
ps aux | grep temperature_monitor

# 查看 PID 文件
ls -l /tmp/temperature_monitor_*.pid
```

## ❓ FAQ 说明

### Q1: 脚本提示"未找到 sensors 命令"怎么办？

**A**: 需要先安装 `lm-sensors` 包，安装后运行 `sudo sensors-detect` 进行传感器检测和配置。

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install lm-sensors
sudo sensors-detect

# CentOS/RHEL
sudo yum install lm_sensors
sudo sensors-detect
```

### Q2: 脚本提示"未找到 notify-send 命令"怎么办？

**A**: 需要安装 `libnotify-bin` 包：

```bash
# Ubuntu/Debian
sudo apt-get install libnotify-bin

# CentOS/RHEL
sudo yum install libnotify-utils
```

### Q3: 如何确定要监控的设备名？

**A**: 运行 `sensors` 命令，输出中第一行（非 "Adapter:" 开头的行）通常是设备名。例如：

```
coretemp-isa-0000
Adapter: ISA adapter
Core 0:       +45.0°C  (high = +80.0°C, crit = +95.0°C)
```

这里的 `coretemp-isa-0000` 就是设备名。

**注意**：脚本会自动识别设备类型，无需手动指定别名。如果设备名包含 `coretemp`、`k10temp` 等关键词，会自动识别为 CPU；包含 `amdgpu`、`nvidia` 等会识别为显卡。

**NVIDIA GPU 设备**：如果系统安装了 NVIDIA 驱动，脚本会自动检测并添加 NVIDIA GPU 设备。设备名格式为 `nvidia-gpu-0`（第一个 GPU）、`nvidia-gpu-1`（第二个 GPU）等。可以通过运行 `nvidia-smi -L` 查看系统中的 NVIDIA GPU 列表。

### Q4: 如何监控 NVIDIA 显卡温度？

**A**: 如果系统已安装 NVIDIA 驱动和 `nvidia-smi` 工具，脚本会在硬件扫描时自动检测并添加 NVIDIA GPU 设备。使用方法：

1. **首次运行**：运行 `./temperature_monitor.sh -r` 重新扫描硬件，脚本会自动检测 NVIDIA GPU 并询问是否监控
2. **设备名**：NVIDIA GPU 设备名格式为 `nvidia-gpu-0`、`nvidia-gpu-1` 等
3. **手动指定**：也可以直接使用设备名，例如：
   ```bash
   ./temperature_monitor.sh -d nvidia-gpu-0 -t 85 -a "NVIDIA GPU"
   ```

**注意**：
- 确保已正确安装 NVIDIA 驱动，`nvidia-smi` 命令可以正常运行
- 如果 `nvidia-smi` 不可用，脚本不会添加 NVIDIA GPU 设备
- NVIDIA GPU 的默认温度阈值为 85°C（可在配置文件中修改）

### Q5: 在 cron 中运行时没有收到通知？

**A**: 可能的原因：
1. cron 环境变量问题，需要设置 `DISPLAY` 环境变量
2. 用户权限问题，确保 cron 任务以正确的用户运行
3. 桌面环境未运行

解决方法：
```bash
# 在 crontab 中设置环境变量
DISPLAY=:0 */5 * * * * /path/to/temperature_monitor.sh -c -t 85
```

### Q6: 脚本无法解析温度值？

**A**: 可能的原因：
1. 设备名不正确，使用 `sensors` 命令确认正确的设备名
2. sensors 输出格式与脚本预期不符，可以尝试不指定设备名让脚本自动检测

### Q7: 如何修改默认阈值和检测间隔？

**A**: 可以编辑脚本文件，修改以下变量：
```bash
DEFAULT_THRESHOLD=80    # 默认温度阈值
DEFAULT_INTERVAL=60     # 默认检测间隔（秒）
```

### Q8: 后台模式如何查看日志？

**A**: 后台模式的输出会发送到标准输出，可以通过以下方式查看：
- 使用 `journalctl` 查看系统日志（如果配置了 systemd）
- 将输出重定向到日志文件：
  ```bash
  ./temperature_monitor.sh -b >> /var/log/temperature_monitor.log 2>&1
  ```

### Q9: 可以同时监控多个设备吗？

**A**: 当前版本脚本一次只能监控一个设备。如果需要监控多个设备，可以：
1. 启动多个脚本实例，每个实例监控不同的设备
2. 修改脚本以支持多设备监控（需要自定义开发）

### Q10: 温度单位是什么？

**A**: 脚本使用摄氏度（°C）作为温度单位。所有温度值（阈值、当前温度）都是摄氏度。

### Q11: 脚本支持哪些 Linux 发行版？

**A**: 脚本理论上支持所有安装了 `lm-sensors` 和 `libnotify-bin` 的 Linux 发行版，已在以下发行版测试：
- Ubuntu 18.04+
- Debian 10+
- CentOS 7+
- Fedora 30+

### Q11: 通知弹窗显示的应用名不对（如显示为"IntelliJ IDEA"）？

**A**: 脚本已自动处理此问题。脚本会自动使用 desktop 文件来设置正确的应用名称。

**解决方案**：
1. **自动安装 desktop 文件**：脚本首次运行时，会自动将 `temperature-monitor.desktop` 文件安装到 `~/.local/share/applications/` 目录
2. **默认开启循环检测**：desktop 文件默认使用 `-b` 参数启动脚本，开启后台循环检测模式。循环检测的时间间隔由配置文件中的 `interval` 配置项控制
3. **使用 desktop 文件标识符**：脚本使用 desktop 文件的 basename（`temperature-monitor`）作为应用标识符，桌面环境会从 desktop 文件中读取正确的应用名称

**手动安装 desktop 文件**（可选）：
```bash
# 复制 desktop 文件到用户目录
mkdir -p ~/.local/share/applications
cp temperature-monitor.desktop ~/.local/share/applications/

# 更新 desktop 数据库
update-desktop-database ~/.local/share/applications/
```

**技术说明**：
- 脚本使用 desktop 文件的 basename 作为 `--app-name` 参数值
- 桌面环境（如 GNOME）会通过这个标识符查找对应的 desktop 文件
- desktop 文件中的 `Name` 字段会被用作通知中显示的应用名称
- 如果 desktop 文件不存在，脚本会回退到使用 `-n` 参数指定的应用名

如果仍然显示不正确，可以尝试：
1. 检查 desktop 文件是否正确安装：`ls ~/.local/share/applications/temperature-monitor.desktop`
2. 手动更新 desktop 数据库：`update-desktop-database ~/.local/share/applications/`
3. 重启桌面环境或注销重新登录
4. 确保使用的是最新版本的脚本

### Q12: 设备类型是如何自动识别的？

**A**: 脚本会根据设备名和传感器输出信息自动识别设备类型：
- **CPU**: 设备名包含 `coretemp`、`k10temp`、`zenpower` 等，或输出包含 `Core`、`Package` 等关键词
- **显卡**: 设备名包含 `amdgpu`、`nouveau`、`nvidia`、`radeon` 等，或输出包含 `GPU`、`Graphics` 等关键词
- **内存**: 设备名包含 `dimm`、`ddr`、`memory` 等
- **硬盘**: 设备名包含 `hddtemp`、`nvme`、`sata` 等
- **主板**: 设备名包含 `acpitz`、`it87`、`nct` 等
- **其他**: 无法识别时显示为"硬件设备"

### Q13: 通知不会自动消失怎么办？

**A**: 通知是否自动消失由 `urgency`（紧急级别）控制：

- **normal**（默认）：通知会自动消失
- **critical**：通知不会自动消失，需要用户手动关闭
- **low**：通知会自动消失

如果需要通知不自动消失，可以使用 `critical` 级别：

```bash
# 使用紧急级别，通知不会自动消失
./temperature_monitor.sh -t 85 -u critical

# 使用正常级别，通知会自动消失（默认）
./temperature_monitor.sh -t 85 -u normal
```

**注意**：系统通知的自动消失行为由桌面环境根据 `urgency` 级别自动控制，不需要单独设置时间参数。

### Q14: 如何使用配置文件监控多个设备？

**A**: 配置文件模式是推荐的使用方式：

1. **首次运行**：直接运行脚本，会自动扫描硬件并创建配置文件
   ```bash
   ./temperature_monitor.sh
   ```

2. **编辑配置**：编辑生成的 `temperature_monitor.conf` 文件，设置每个设备的阈值和开关

3. **运行监控**：再次运行脚本，会按照配置文件监控所有启用的设备
   ```bash
   # 单次检测
   ./temperature_monitor.sh
   
   # 后台循环检测
   ./temperature_monitor.sh -b
   ```

**配置文件示例**：
```ini
[coretemp-isa-0000]
type=CPU
enabled=true
threshold=80
alias=CPU

[amdgpu-pci-0100]
type=显卡
enabled=false
threshold=85
alias=显卡
```

### Q15: 如何禁用某个设备的监控？

**A**: 在配置文件中，将对应设备的 `enabled` 设置为 `false`：

```ini
[设备名]
type=CPU
enabled=false  # 设置为 false 即可禁用
threshold=80
alias=CPU
```

### Q16: 配置文件在哪里？

**A**: 配置文件位于脚本同目录下，文件名为 `temperature_monitor.conf`。可以通过以下方式查看：

```bash
# 查看配置文件路径
ls -l $(dirname "$(readlink -f temperature_monitor.sh)")/temperature_monitor.conf
```

### Q17: 如何重新扫描硬件并更新配置？

**A**: 使用 `-r` 或 `--reconfigure` 参数可以重新扫描硬件并更新配置文件：

```bash
# 重新扫描硬件并更新配置
./temperature_monitor.sh -r
```

重新配置时会：
- 自动备份旧配置文件（文件名格式：`temperature_monitor.conf.backup.YYYYMMDD_HHMMSS`）
- 重新扫描所有硬件设备
- 交互式选择要监控的设备
- 生成新的配置文件

**适用场景**：
- 添加了新的硬件设备
- 修改了硬件配置
- 需要重新选择要监控的设备
- 配置文件损坏或需要重置

## 📄 许可证

本脚本仅供学习交流使用。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

