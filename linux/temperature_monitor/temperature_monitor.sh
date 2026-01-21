#!/bin/bash

# 温度监控脚本
# 功能：使用sensors检测温度，超过阈值后发送系统通知
# 支持后台循环检测和cron单次检测两种模式

set -euo pipefail

# 默认配置
DEFAULT_THRESHOLD=80
DEFAULT_INTERVAL=60
DEFAULT_DEVICE=""
DEFAULT_ALIAS=""
DEFAULT_APP_NAME="温度监控"
DEFAULT_URGENCY="normal"  # 默认紧急级别：normal（会自动消失）、critical（不会自动消失）、low（会自动消失）

# 显示使用说明
show_usage() {
    cat << EOF
用法: $0 [选项]

选项:
    -d, --device DEVICE      指定硬件设备名（可选，默认使用第一个可用设备）
    -a, --alias ALIAS        设置设备别名（用于显示，如"CPU"、"GPU"等）
    -t, --threshold TEMP     温度阈值（摄氏度，默认: ${DEFAULT_THRESHOLD}°C）
    -i, --interval SECONDS   检测间隔（秒，默认: ${DEFAULT_INTERVAL}秒，仅后台模式有效）
    -n, --app-name NAME      通知应用名称（默认: ${DEFAULT_APP_NAME}）
    -u, --urgency LEVEL      通知紧急级别（normal/critical/low，默认: ${DEFAULT_URGENCY}）
                             注意：critical级别通知不会自动消失，normal和low会自动消失
    -b, --background         后台运行模式（循环检测）
    -c, --check-once         单次检测模式（适用于cron）
    -r, --reconfigure        重新扫描硬件并生成配置文件
    -h, --help               显示此帮助信息

示例:
    # 单次检测（默认模式）
    $0 -t 85

    # 后台循环检测，设置设备别名
    $0 -d "coretemp-isa-0000" -a "CPU" -t 80 -i 30 -b

    # 指定通知应用名和紧急级别
    $0 -t 85 -n "温度监控系统" -u normal

    # cron定时执行（每5分钟检测一次）
    # 在crontab中添加: */5 * * * * /path/to/temperature_monitor.sh -c -t 85 -a "CPU" -n "温度监控"

    # 重新扫描硬件并生成配置文件
    $0 -r

EOF
}

# 解析命令行参数
DEVICE="${DEFAULT_DEVICE}"
ALIAS="${DEFAULT_ALIAS}"
THRESHOLD="${DEFAULT_THRESHOLD}"
INTERVAL="${DEFAULT_INTERVAL}"
APP_NAME="${DEFAULT_APP_NAME}"
URGENCY="${DEFAULT_URGENCY}"
BACKGROUND=false
CHECK_ONCE=false
RECONFIGURE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--device)
            DEVICE="$2"
            shift 2
            ;;
        -a|--alias)
            ALIAS="$2"
            shift 2
            ;;
        -t|--threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        -i|--interval)
            INTERVAL="$2"
            shift 2
            ;;
        -n|--app-name)
            APP_NAME="$2"
            shift 2
            ;;
        -u|--urgency)
            URGENCY="$2"
            shift 2
            ;;
        -b|--background)
            BACKGROUND=true
            shift
            ;;
        -c|--check-once)
            CHECK_ONCE=true
            shift
            ;;
        -r|--reconfigure)
            RECONFIGURE=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "错误: 未知参数 '$1'" >&2
            show_usage
            exit 1
            ;;
    esac
done

# 检查sensors命令是否可用
if ! command -v sensors &> /dev/null; then
    echo "错误: 未找到 sensors 命令，请先安装 lm-sensors 包" >&2
    echo "安装方法: sudo apt-get install lm-sensors 或 sudo yum install lm_sensors" >&2
    exit 1
fi

# 检查notify-send命令是否可用
if ! command -v notify-send &> /dev/null; then
    echo "错误: 未找到 notify-send 命令，请先安装 libnotify-bin 包" >&2
    echo "安装方法: sudo apt-get install libnotify-bin" >&2
    exit 1
fi

# 检查bc命令是否可用（用于浮点数比较）
if ! command -v bc &> /dev/null; then
    echo "警告: 未找到 bc 命令，将使用 awk 进行浮点数比较" >&2
    USE_BC=false
else
    USE_BC=true
fi

# 检查nvidia-smi命令是否可用
check_nvidia_smi_available() {
    if command -v nvidia-smi &> /dev/null; then
        # 进一步检查nvidia-smi是否能正常工作
        if nvidia-smi -L &> /dev/null; then
            return 0
        fi
    fi
    return 1
}

# 获取NVIDIA GPU数量
get_nvidia_gpu_count() {
    if check_nvidia_smi_available; then
        nvidia-smi -L 2>/dev/null | wc -l
    else
        echo "0"
    fi
}

# 获取NVIDIA GPU温度
get_nvidia_gpu_temperature() {
    local gpu_index="${1:-0}"
    
    if ! check_nvidia_smi_available; then
        echo "错误: nvidia-smi 不可用" >&2
        return 1
    fi
    
    # 使用nvidia-smi查询指定GPU的温度
    local temp=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits -i "$gpu_index" 2>/dev/null)
    
    if [[ -z "$temp" ]] || [[ ! "$temp" =~ ^[0-9]+$ ]]; then
        echo "错误: 无法获取NVIDIA GPU $gpu_index 的温度" >&2
        return 1
    fi
    
    echo "$temp"
    return 0
}

# 获取NVIDIA GPU名称
get_nvidia_gpu_name() {
    local gpu_index="${1:-0}"
    
    if ! check_nvidia_smi_available; then
        echo ""
        return 1
    fi
    
    # 使用nvidia-smi查询指定GPU的名称
    local name=$(nvidia-smi --query-gpu=name --format=csv,noheader -i "$gpu_index" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    echo "$name"
    return 0
}

# 获取配置文件路径
get_config_file() {
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    echo "${script_dir}/temperature_monitor.conf"
}

# 获取所有可用设备列表
get_all_available_devices() {
    local devices=""
    
    # 获取sensors设备列表
    local sensors_devices=$(sensors 2>/dev/null | awk '
        /^[^[:space:]]/ && !/^Adapter:/ {
            device = $1
            gsub(/:$/, "", device)
            if ((getline) > 0 && /^Adapter:/) {
                print device
            }
        }
    ' || echo "")
    
    devices="$sensors_devices"
    
    # 检查并添加NVIDIA GPU设备
    if check_nvidia_smi_available; then
        local gpu_count=$(get_nvidia_gpu_count)
        local gpu_index=0
        while [[ $gpu_index -lt $gpu_count ]]; do
            if [[ -n "$devices" ]]; then
                devices="${devices}"$'\n'"nvidia-gpu-${gpu_index}"
            else
                devices="nvidia-gpu-${gpu_index}"
            fi
            ((gpu_index++))
        done
    fi
    
    echo "$devices"
}

# 获取可用设备列表（兼容旧版本）
get_available_devices() {
    # 获取第一个非Adapter的设备名
    get_all_available_devices | head -1
}

# 交互式选择设备（逐个询问）
interactive_select_devices() {
    local devices="$1"
    local device_array=()
    local device_configs=()
    local index=1
    local enabled_count=0
    
    # 将设备列表转换为数组
    while IFS= read -r device; do
        [[ -z "$device" ]] && continue
        device_array+=("$device")
    done <<< "$devices"
    
    if [[ ${#device_array[@]} -eq 0 ]]; then
        echo "错误: 未找到任何温度传感器设备" >&2
        return 1
    fi
    
    echo "" >&2
    echo "开始扫描硬件设备，请逐个选择是否监控：" >&2
    echo "==========================================" >&2
    echo "" >&2
    
    # 逐个询问用户
    for device in "${device_array[@]}"; do
        # 检测设备类型
        local device_type=$(detect_device_type "$device" 2>/dev/null || echo "硬件设备")
        # 获取设备信息
        local device_info=""
        local is_nvidia_gpu=false
        if [[ "$device" =~ ^nvidia-gpu-[0-9]+$ ]]; then
            # NVIDIA GPU设备，使用nvidia-smi获取信息
            is_nvidia_gpu=true
            local gpu_index=$(echo "$device" | sed 's/nvidia-gpu-//')
            local gpu_name=$(get_nvidia_gpu_name "$gpu_index")
            local gpu_temp=$(get_nvidia_gpu_temperature "$gpu_index" 2>/dev/null || echo "N/A")
            device_info="NVIDIA GPU #${gpu_index}"
            if [[ -n "$gpu_name" ]]; then
                device_info="${device_info}: ${gpu_name}"
            fi
            if [[ "$gpu_temp" != "N/A" ]]; then
                device_info="${device_info}"$'\n'"当前温度: ${gpu_temp}°C"
            fi
        else
            # 普通sensors设备
            device_info=$(sensors "$device" 2>/dev/null | head -5 || echo "无法获取设备信息")
        fi
        local default_threshold=80
        
        # 根据设备类型设置默认阈值
        case "$device_type" in
            "CPU")
                default_threshold=80
                ;;
            "显卡")
                default_threshold=85
                ;;
            "内存")
                default_threshold=70
                ;;
            "硬盘")
                default_threshold=60
                ;;
            "主板")
                default_threshold=75
                ;;
            *)
                default_threshold=80
                ;;
        esac
        
        # 输出设备信息（所有输出都到标准错误，确保在终端显示）
        echo "" >&2
        echo "[设备 $index/${#device_array[@]}]" >&2
        echo "设备名: $device" >&2
        echo "类型: $device_type" >&2
        echo "默认阈值: ${default_threshold}°C" >&2
        echo "设备信息:" >&2
        if [[ "$is_nvidia_gpu" == true ]]; then
            # NVIDIA GPU设备，分行显示
            echo "$device_info" | while IFS= read -r line; do
                echo "  $line" >&2
            done
        else
            # 普通sensors设备
            echo "$device_info" | sed 's/^/  /' | head -3 >&2
        fi
        echo "" >&2
        # 提示信息
        echo -n "是否监控此设备？(y/n，默认: n): " >&2
        # 从终端读取输入（确保在交互式环境中工作）
        local answer=""
        if [[ -t 0 ]] && [[ -c /dev/tty ]] 2>/dev/null; then
            read -r answer < /dev/tty 2>/dev/null || read -r answer
        else
            # 如果无法从终端读取，尝试从标准输入
            read -r answer
        fi
        
        # 处理用户输入（支持 y/Y/yes/YES 等）
        local enabled="false"
        if [[ "$answer" =~ ^[yY] ]] || [[ "$answer" == "yes" ]] || [[ "$answer" == "YES" ]]; then
            enabled="true"
            ((enabled_count++))
            echo "  ✓ 已启用监控" >&2
        else
            echo "  - 已禁用监控（可在配置文件中手动启用）" >&2
        fi
        
        # 保存设备配置（格式：设备名|类型|启用|阈值|别名）
        device_configs+=("${device}|${device_type}|${enabled}|${default_threshold}|${device_type}")
        ((index++))
    done
    
    echo "" >&2
    echo "==========================================" >&2
    echo "扫描完成！已启用 $enabled_count 个设备的监控" >&2
    echo "" >&2
    
    # 返回所有设备配置（不论是否启用）
    # 只输出设备配置，不输出其他信息
    printf '%s\n' "${device_configs[@]}"
    return 0
}

# 扫描硬件并生成配置
scan_hardware_and_create_config() {
    local config_file="$1"
    local devices=$(get_all_available_devices)
    
    if [[ -z "$devices" ]]; then
        echo "错误: 未找到任何温度传感器设备" >&2
        return 1
    fi
    
    # 交互式选择设备（逐个询问）
    local device_configs=$(interactive_select_devices "$devices")
    
    if [[ $? -ne 0 ]] || [[ -z "$device_configs" ]]; then
        echo "错误: 设备选择失败" >&2
        return 1
    fi
    
    # 创建配置文件
    cat > "$config_file" << EOF
# 温度监控配置文件
# 格式说明：
# [设备名] - 设备标识符（sensors命令输出的设备名）
# type - 设备类型（CPU/显卡/内存/硬盘/主板/硬件设备）
# enabled - 是否启用监控（true/false）
# threshold - 温度阈值（摄氏度）
# alias - 设备别名（用于显示，可选）

# 全局配置
# interval - 循环检测的时间间隔（秒，仅在后台模式有效）
interval=${DEFAULT_INTERVAL}

EOF
    
    # 为所有设备生成配置（不论是否启用）
    local enabled_count=0
    while IFS= read -r line; do
        # 跳过空行
        [[ -z "$line" ]] && continue
        # 验证配置格式：必须包含分隔符|
        if [[ ! "$line" =~ \| ]]; then
            continue
        fi
        # 确保是有效的设备配置格式（必须包含分隔符|，且至少有5个字段）
        local field_count=$(echo "$line" | tr '|' '\n' | wc -l)
        if [[ $field_count -lt 5 ]]; then
            continue
        fi
        
        # 解析配置行
        IFS='|' read -r device device_type enabled threshold alias <<< "$line"
        
        # 验证设备名不包含特殊字符（如[、]等）
        if [[ "$device" =~ \[|\] ]]; then
            continue
        fi
        
        # 跳过空字段
        [[ -z "$device" ]] && continue
        [[ -z "$device_type" ]] && continue
        
        if [[ "$enabled" == "true" ]]; then
            ((enabled_count++))
        fi
        
        cat >> "$config_file" << EOF
[${device}]
type=${device_type}
enabled=${enabled}
threshold=${threshold}
alias=${alias}

EOF
    done <<< "$device_configs"
    
    local total_count=$(echo "$device_configs" | grep -c '^' || echo "0")
    
    echo ""
    echo "配置文件已创建: $config_file"
    echo "共发现 $total_count 个硬件设备，其中 $enabled_count 个已启用监控"
    echo "您可以在配置文件中手动修改 enabled=true/false 来启用或禁用设备监控"
}

# 读取配置文件
read_config() {
    local config_file="$1"
    
    if [[ ! -f "$config_file" ]]; then
        return 1
    fi
    
    # 解析配置文件，返回设备配置数组
    # 格式：设备名|类型|启用|阈值|别名
    local current_device=""
    local device_type=""
    local enabled=""
    local threshold=""
    local alias=""
    
    while IFS= read -r line || [[ -n "$line" ]]; do
        # 跳过注释和空行
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue
        
        # 匹配设备块
        if [[ "$line" =~ ^\[(.+)\]$ ]]; then
            # 保存上一个设备（如果有）
            if [[ -n "$current_device" ]] && [[ -n "$device_type" ]]; then
                echo "${current_device}|${device_type}|${enabled:-true}|${threshold:-80}|${alias:-${device_type}}"
            fi
            
            # 开始新设备
            current_device="${BASH_REMATCH[1]}"
            device_type=""
            enabled=""
            threshold=""
            alias=""
        elif [[ "$line" =~ ^[[:space:]]*type[[:space:]]*=[[:space:]]*(.+)$ ]]; then
            device_type="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^[[:space:]]*enabled[[:space:]]*=[[:space:]]*(.+)$ ]]; then
            enabled="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^[[:space:]]*threshold[[:space:]]*=[[:space:]]*(.+)$ ]]; then
            threshold="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^[[:space:]]*alias[[:space:]]*=[[:space:]]*(.+)$ ]]; then
            alias="${BASH_REMATCH[1]}"
        fi
    done < "$config_file"
    
    # 保存最后一个设备
    if [[ -n "$current_device" ]] && [[ -n "$device_type" ]]; then
        echo "${current_device}|${device_type}|${enabled:-true}|${threshold:-80}|${alias:-${device_type}}"
    fi
}

# 读取配置文件中的全局配置（如interval）
read_global_config() {
    local config_file="$1"
    local config_key="$2"
    local default_value="$3"
    
    if [[ ! -f "$config_file" ]]; then
        echo "$default_value"
        return 1
    fi
    
    # 读取全局配置（在第一个设备块之前）
    while IFS= read -r line || [[ -n "$line" ]]; do
        # 如果遇到设备块，停止读取全局配置
        if [[ "$line" =~ ^\[(.+)\]$ ]]; then
            break
        fi
        
        # 跳过注释和空行
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue
        
        # 匹配配置项
        if [[ "$line" =~ ^[[:space:]]*${config_key}[[:space:]]*=[[:space:]]*(.+)$ ]]; then
            echo "${BASH_REMATCH[1]}"
            return 0
        fi
    done < "$config_file"
    
    echo "$default_value"
    return 1
}

# 自动识别设备类型
detect_device_type() {
    local device="$1"
    
    # 检查是否是NVIDIA GPU设备
    if [[ "$device" =~ ^nvidia-gpu-[0-9]+$ ]]; then
        echo "显卡"
        return 0
    fi
    
    # 转换为小写（兼容旧版bash）
    local device_lower=$(echo "$device" | tr '[:upper:]' '[:lower:]')
    
    # 获取设备详细信息用于判断
    local device_info=$(sensors "$device" 2>/dev/null || sensors | grep -A 10 "^${device}" 2>/dev/null)
    local device_info_lower=$(echo "$device_info" | tr '[:upper:]' '[:lower:]')
    
    # CPU相关设备
    if echo "$device_lower" | grep -qE "coretemp|k10temp|zenpower|cpu" || \
       echo "$device_info_lower" | grep -qE "core[[:space:]]*[0-9]|package[[:space:]]*id|tdie"; then
        echo "CPU"
        return 0
    fi
    
    # GPU相关设备
    if echo "$device_lower" | grep -qE "amdgpu|nouveau|nvidia|radeon|gpu" || \
       echo "$device_info_lower" | grep -qE "gpu|graphics|vga"; then
        echo "显卡"
        return 0
    fi
    
    # 内存相关设备
    if echo "$device_lower" | grep -qE "dimm|ddr|memory" || \
       echo "$device_info_lower" | grep -qE "dimm|memory"; then
        echo "内存"
        return 0
    fi
    
    # 硬盘相关设备
    if echo "$device_lower" | grep -qE "hddtemp|nvme|sata" || \
       echo "$device_info_lower" | grep -qE "hdd|disk|drive"; then
        echo "硬盘"
        return 0
    fi
    
    # 主板相关设备
    if echo "$device_lower" | grep -qE "acpitz|it87|nct|w83627ehf|lm78" || \
       echo "$device_info_lower" | grep -qE "motherboard|mainboard|sys"; then
        echo "主板"
        return 0
    fi
    
    # 其他/未知设备
    echo "硬件设备"
    return 0
}

# 浮点数比较函数
compare_float() {
    local a="$1"
    local op="$2"
    local b="$3"
    
    if [[ "$USE_BC" == true ]]; then
        echo "$a $op $b" | bc -l
    else
        awk "BEGIN {if ($a $op $b) print 1; else print 0}"
    fi
}

# 获取指定设备的温度
get_temperature() {
    local device="$1"
    local temp_output
    
    if [[ -z "$device" ]]; then
        # 如果没有指定设备，获取第一个可用设备
        device=$(get_available_devices)
        if [[ -z "$device" ]]; then
            echo "错误: 未找到可用的温度传感器设备" >&2
            return 1
        fi
    fi
    
    # 检查是否是NVIDIA GPU设备
    if [[ "$device" =~ ^nvidia-gpu-[0-9]+$ ]]; then
        local gpu_index=$(echo "$device" | sed 's/nvidia-gpu-//')
        local temp=$(get_nvidia_gpu_temperature "$gpu_index")
        if [[ $? -eq 0 ]]; then
            echo "$temp"
            return 0
        else
            return 1
        fi
    fi
    
    # 获取该设备的温度信息（sensors设备）
    # 先尝试直接指定设备，如果失败则从全部输出中提取
    temp_output=$(sensors "$device" 2>/dev/null)
    if [[ -z "$temp_output" ]]; then
        temp_output=$(sensors | awk -v dev="$device" '/^'"$device"'/ {flag=1} flag && /^[^[:space:]]/ && !/^'"$device"'/ {exit} flag {print}')
    fi
    
    if [[ -z "$temp_output" ]]; then
        echo "错误: 无法获取设备 '${device}' 的温度信息" >&2
        return 1
    fi
    
    # 提取最高温度值
    # 匹配格式如: Core 0:        +45.0°C  (high = +80.0°C, crit = +95.0°C)
    # 或: temp1:       +45.0°C  (high = +80.0°C, crit = +95.0°C)
    local max_temp=0
    local temp_value
    
    while IFS= read -r line; do
        # 匹配温度值（格式: 标签: +XX.X°C 或 标签: XX.X°C）
        # 使用awk提取第一个温度值（当前温度，不是high/crit）
        if [[ $line =~ ^[[:space:]]*[^:]+:[[:space:]]*\+?([0-9]+\.[0-9]+)°C ]]; then
            temp_value="${BASH_REMATCH[1]}"
            # 比较并更新最大值
            if [[ $(compare_float "$temp_value" ">" "$max_temp") -eq 1 ]]; then
                max_temp=$temp_value
            fi
        fi
    done <<< "$temp_output"
    
    if [[ $(compare_float "$max_temp" "==" "0") -eq 1 ]]; then
        echo "错误: 无法从设备 '${device}' 解析温度值" >&2
        return 1
    fi
    
    echo "$max_temp"
    return 0
}

# 创建desktop文件
create_desktop_file() {
    # 获取脚本所在目录，用于定位图标文件
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local icon_path="${script_dir}/thermometer.svg"
    local user_desktop_dir="${HOME}/.local/share/applications"
    local user_desktop_file="${user_desktop_dir}/temperature-monitor.desktop"
    
    # 如果desktop文件已存在，直接返回
    if [[ -f "$user_desktop_file" ]]; then
        return 0
    fi
    
    # 创建目录（如果不存在）
    mkdir -p "$user_desktop_dir" 2>/dev/null
    if [[ ! -d "$user_desktop_dir" ]]; then
        echo "警告: 无法创建desktop文件目录: $user_desktop_dir" >&2
        return 1
    fi
    
    # 动态创建desktop文件（默认开启循环检测）
    cat > "$user_desktop_file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=温度监控
Name[en]=Temperature Monitor
GenericName=Temperature Monitor
Comment=使用sensors检测温度，超过阈值后发送系统通知
Comment[en]=Monitor system temperature using sensors and send notifications when threshold is exceeded
Exec=${script_dir}/temperature_monitor.sh -b
Icon=${icon_path}
Terminal=false
Categories=System;Monitor;
StartupNotify=false
NoDisplay=false
StartupWMClass=temperature-monitor
EOF
    
    # 设置desktop文件权限（某些系统需要可执行权限）
    chmod +x "$user_desktop_file" 2>/dev/null
    
    # 更新desktop数据库（某些桌面环境需要）
    if command -v update-desktop-database &> /dev/null; then
        update-desktop-database "$user_desktop_dir" 2>/dev/null
    fi
    
    # 输出提示信息
    echo "" >&2
    echo "✓ Desktop文件已创建" >&2
    echo "  安装路径: $user_desktop_file" >&2
    echo "  桌面环境会自动识别此文件，您可以在应用程序菜单中找到"温度监控"" >&2
    echo "  从桌面启动时会自动开启后台循环检测模式" >&2
    echo "" >&2
    
    return 0
}

# 发送合并后的通知（用于多个设备告警）
send_merged_notification() {
    local summary="$1"
    local body="$2"
    local app_name="$3"
    local urgency="$4"
    
    # 验证urgency参数
    if [[ ! "$urgency" =~ ^(low|normal|critical)$ ]]; then
        urgency="normal"  # 默认值
    fi
    
    # 获取脚本所在目录，用于定位图标文件
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local icon_path="${script_dir}/thermometer.svg"
    local user_desktop_dir="${HOME}/.local/share/applications"
    local user_desktop_file="${user_desktop_dir}/temperature-monitor.desktop"
    
    # 如果图标文件不存在，尝试使用系统默认的温度计图标
    local icon_param
    if [[ -f "$icon_path" ]]; then
        icon_param="$icon_path"
    else
        # 使用系统默认图标（thermometer 或 temperature）
        icon_param="thermometer"
    fi
    
    # 确保desktop文件存在（如果不存在则创建）
    create_desktop_file >/dev/null 2>&1
    
    # 使用desktop文件的basename作为应用标识符
    local desktop_id="temperature-monitor"
    
    # 设置环境变量，帮助通知系统识别应用
    export DESKTOP_STARTUP_ID="$desktop_id"
    
    # 发送通知
    notify-send \
        --app-name="$desktop_id" \
        --urgency="$urgency" \
        --icon="$icon_param" \
        "$summary" \
        "$body"
}

# 发送系统通知（单个设备）
send_notification() {
    local temp="$1"
    local threshold="$2"
    local device="$3"
    local alias="$4"
    local app_name="$5"
    local urgency="$6"
    
    # 确定显示名称：优先使用用户指定的别名，其次使用自动识别的设备类型，最后使用设备名
    local display_name
    if [[ -n "$alias" ]]; then
        display_name="$alias"
    else
        display_name=$(detect_device_type "$device")
    fi
    
    # 构建通知内容
    local summary="温度警告"
    local body="设备: ${display_name}\n当前温度: ${temp}°C\n阈值: ${threshold}°C\n温度已超过设定阈值！"
    
    # 发送通知
    send_merged_notification "$summary" "$body" "$app_name" "$urgency"
}

# 检测单个设备的温度
check_single_device() {
    local device_name="$1"
    local threshold="$2"
    local alias="$3"
    local app_name="$4"
    local urgency="$5"
    
    if [[ -z "$device_name" ]]; then
        return 1
    fi
    
    local current_temp=$(get_temperature "$device_name")
    
    if [[ $? -ne 0 ]]; then
        echo "错误: 获取设备 '${device_name}' 温度失败" >&2
        return 1
    fi
    
    # 获取设备显示名称
    local display_name
    if [[ -n "$alias" ]]; then
        display_name="$alias"
    else
        display_name=$(detect_device_type "$device_name")
    fi
    
    # 比较温度（使用浮点数比较函数）
    if [[ $(compare_float "$current_temp" ">" "$threshold") -eq 1 ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 警告: 温度 ${current_temp}°C 超过阈值 ${threshold}°C (设备: ${display_name}[${device_name}])"
        send_notification "$current_temp" "$threshold" "$device_name" "$alias" "$app_name" "$urgency"
        return 1
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 正常: 温度 ${current_temp}°C (设备: ${display_name}[${device_name}], 阈值: ${threshold}°C)"
        return 0
    fi
}

# 从配置文件检测所有设备
check_temperature_from_config() {
    local config_file=$(get_config_file)
    local has_warning=false
    local warning_devices=()
    local warning_details=()
    
    if [[ ! -f "$config_file" ]]; then
        echo "错误: 配置文件不存在: $config_file" >&2
        return 1
    fi
    
    # 读取配置并检测每个设备
    while IFS='|' read -r device_name device_type enabled threshold alias; do
        # 跳过空行
        [[ -z "$device_name" ]] && continue
        
        # 检查是否启用
        if [[ "$enabled" != "true" ]]; then
            continue
        fi
        
        # 检测该设备（不发送通知，只收集告警信息）
        local current_temp
        current_temp=$(get_temperature "$device_name" 2>&1)
        local temp_result=$?
        if [[ $temp_result -ne 0 ]]; then
            # 如果获取温度失败，输出错误信息但继续检测其他设备
            echo "错误: 获取设备 '${device_name}' 温度失败: $current_temp" >&2
            continue
        fi
        
        # 获取设备显示名称
        local display_name
        if [[ -n "$alias" ]]; then
            display_name="$alias"
        else
            display_name=$(detect_device_type "$device_name")
        fi
        
        # 比较温度（使用浮点数比较函数）
        if [[ $(compare_float "$current_temp" ">" "$threshold") -eq 1 ]]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] 警告: 温度 ${current_temp}°C 超过阈值 ${threshold}°C (设备: ${display_name}[${device_name}])"
            has_warning=true
            warning_devices+=("${display_name}")
            warning_details+=("${display_name}: ${current_temp}°C (阈值: ${threshold}°C)")
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] 正常: 温度 ${current_temp}°C (设备: ${display_name}[${device_name}], 阈值: ${threshold}°C)"
        fi
    done < <(read_config "$config_file")
    
    # 如果有告警，合并发送一个通知
    if [[ "$has_warning" == true ]]; then
        local device_count=${#warning_devices[@]}
        local summary="温度警告"
        local body=""
        
        if [[ $device_count -eq 1 ]]; then
            # 单个设备告警
            body="设备: ${warning_devices[0]}\n${warning_details[0]}\n温度已超过设定阈值！"
        else
            # 多个设备告警，合并显示
            body="检测到 ${device_count} 个设备温度超限：\n"
            for detail in "${warning_details[@]}"; do
                body="${body}• ${detail}\n"
            done
            # 移除最后一个\n
            # 移除最后一个\n
            body="${body%\\n}"
            body="${body}\n温度已超过设定阈值！"
        fi
        
        # 发送合并后的通知
        send_merged_notification "$summary" "$body" "$APP_NAME" "$URGENCY"
        return 1
    fi
    return 0
}

# 检测温度并处理（兼容旧版本和配置文件模式）
check_temperature() {
    local config_file=$(get_config_file)
    
    # 如果指定了重新配置参数，强制重新扫描硬件
    if [[ "$RECONFIGURE" == true ]]; then
        echo "正在重新扫描硬件并更新配置文件..." >&2
        # 备份旧配置文件（如果存在）
        if [[ -f "$config_file" ]]; then
            local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
            cp "$config_file" "$backup_file" 2>/dev/null
            echo "已备份旧配置文件到: $backup_file" >&2
        fi
        # 重新扫描并生成配置
        if scan_hardware_and_create_config "$config_file"; then
            echo "配置文件已更新: $config_file" >&2
            return 0
        else
            echo "错误: 无法更新配置文件" >&2
            return 1
        fi
    fi
    
    # 如果指定了设备参数，使用旧版本的单一设备模式
    if [[ -n "$DEVICE" ]] || [[ -n "$THRESHOLD" ]] && [[ "$THRESHOLD" != "${DEFAULT_THRESHOLD}" ]]; then
        # 使用命令行参数模式（向后兼容）
        local device_name="${DEVICE:-$(get_available_devices)}"
        local threshold="${THRESHOLD}"
        local alias="${ALIAS}"
        
        check_single_device "$device_name" "$threshold" "$alias" "$APP_NAME" "$URGENCY"
        return $?
    fi
    
    # 使用配置文件模式
    if [[ -f "$config_file" ]]; then
        check_temperature_from_config
        return $?
    else
        # 配置文件不存在，自动创建
        echo "首次运行，正在扫描硬件并创建配置文件..." >&2
        if scan_hardware_and_create_config "$config_file"; then
            echo "配置文件已创建，请编辑配置文件后重新运行脚本" >&2
            echo "配置文件位置: $config_file" >&2
            return 0
        else
            echo "错误: 无法创建配置文件" >&2
            return 1
        fi
    fi
}

# 后台运行模式
run_background() {
    local config_file
    config_file=$(get_config_file)
    local lock_dir="/tmp/temperature_monitor_background.lock"
    local lock_pid_file="${lock_dir}/pid"

    # 在父进程中先尝试获取全局锁，只有真正抢到锁才启动后台子进程
    if ! mkdir "$lock_dir" 2>/dev/null; then
        # 锁目录已存在，读取其中记录的 PID 检查是否为“脏锁”
        local existing_pid=""
        if [[ -f "$lock_pid_file" ]]; then
            existing_pid=$(cat "$lock_pid_file" 2>/dev/null || echo "")
        fi

        # 只有当 PID 存在且命令行中确实包含 temperature_monitor.sh -b 时，才认为已有实例
        if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
            if ps -p "$existing_pid" -o cmd= 2>/dev/null | grep -q "temperature_monitor.sh" && \
               ps -p "$existing_pid" -o cmd= 2>/dev/null | grep -q -- " -b"; then
                echo "提示: 温度监控脚本已在后台运行 (PID: $existing_pid)" >&2
                echo "如需重新启动，请先停止当前后台进程后再重试。" >&2
                return 0
            fi
        fi

        # 走到这里说明 PID 对应进程已不存在或不是我们的后台实例，视为“脏锁”
        rm -rf "$lock_dir" 2>/dev/null || true

        # 尝试重新获取锁，如果仍失败则认为确有其它实例在运行（极小概率竞争）
        if ! mkdir "$lock_dir" 2>/dev/null; then
            echo "提示: 温度监控脚本已在后台运行" >&2
            echo "如需重新启动，请先停止当前后台进程后再重试。" >&2
            return 0
        fi
    fi

    # 启动后台进程（此时已经确认抢到锁）
    (
        # 确保退出时删除锁目录和 PID 文件
        trap "rm -f '$lock_pid_file' 2>/dev/null || true; rmdir '$lock_dir' 2>/dev/null || true; exit" INT TERM EXIT

        # 获取初始配置
        local current_interval="${INTERVAL}"
        if [[ -f "$config_file" ]]; then
            local config_interval
            config_interval=$(read_global_config "$config_file" "interval" "${DEFAULT_INTERVAL}")
            if [[ -n "$config_interval" ]] && [[ "$config_interval" =~ ^[0-9]+$ ]]; then
                current_interval="$config_interval"
            fi
        fi

        echo "温度监控已启动 (PID: $$)"
        echo "设备: ${DEVICE:-自动检测（配置文件模式）}"
        echo "阈值: ${THRESHOLD:-配置文件}"
        echo "间隔: ${current_interval}秒（从配置文件读取）"
        echo "日志: 查看系统日志或使用 journalctl -f"
        echo "提示: 修改配置文件后，间隔会在下次循环时自动更新"

        while true; do
            # 每次循环前重新读取配置文件中的interval
            if [[ -f "$config_file" ]]; then
                local config_interval
                config_interval=$(read_global_config "$config_file" "interval" "${DEFAULT_INTERVAL}")
                if [[ -n "$config_interval" ]] && [[ "$config_interval" =~ ^[0-9]+$ ]]; then
                    current_interval="$config_interval"
                fi
            fi

            # 执行温度检测（忽略返回值，确保循环继续）
            # 使用 || true 防止 set -e 导致脚本退出
            check_temperature || true

            sleep "$current_interval"
        done
    ) &

    # 在父进程中记录真正的后台进程 PID，供下次启动时校验
    local bg_pid="$!"
    echo "$bg_pid" > "$lock_pid_file" 2>/dev/null || true
    echo "后台进程 PID: $bg_pid"
}

# 主逻辑
main() {
    # 自动创建desktop文件（如果不存在）
    create_desktop_file
    
    # 如果指定了重新配置参数，直接执行重新配置并退出
    if [[ "$RECONFIGURE" == true ]]; then
        check_temperature
        exit $?
    fi
    
    # 如果同时指定了后台和单次检测，单次检测优先
    if [[ "$CHECK_ONCE" == true ]]; then
        check_temperature
        exit $?
    elif [[ "$BACKGROUND" == true ]]; then
        run_background
    else
        # 默认单次检测
        check_temperature
        exit $?
    fi
}

# 执行主函数
main

