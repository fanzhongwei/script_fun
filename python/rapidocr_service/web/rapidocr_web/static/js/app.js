// RapidOCR Web App - 增强交互脚本
document.addEventListener('DOMContentLoaded', function() {
    // 初始化应用
    initApp();
});

function initApp() {
    // 添加上传区域的拖拽反馈
    const uploadArea = document.getElementById('uploadArea');
    const uploadContainer = document.getElementById('uploadContainer');

    if (uploadArea) {
        // 拖拽进入效果
        uploadArea.addEventListener('dragenter', function(e) {
            e.preventDefault();
            uploadArea.classList.add('dragging');
            uploadContainer.style.transform = 'scale(1.02)';
        });

        // 拖拽离开效果
        uploadArea.addEventListener('dragleave', function(e) {
            e.preventDefault();
            if (!uploadArea.contains(e.relatedTarget)) {
                uploadArea.classList.remove('dragging');
                uploadContainer.style.transform = 'scale(1)';
            }
        });

        // 拖拽结束效果
        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragging');
            uploadContainer.style.transform = 'scale(1)';
        });

        // 点击上传区域触发文件选择
        uploadArea.addEventListener('click', function(e) {
            if (e.target !== uploadArea.querySelector('.upload-btn')) {
                document.getElementById('rapid_ocr').click();
            }
        });
    }

        // 添加键盘快捷键支持
    document.addEventListener('keydown', function(e) {
        // Ctrl+V 粘贴图片
        if (e.ctrlKey && e.key === 'v') {
            console.log('粘贴快捷键触发');
        }

        // Ctrl+O 打开文件选择
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            document.getElementById('rapid_ocr').click();
        }

        // Ctrl+C 不再拦截为复制全部，仅「复制全部」按钮触发

    });

    // 添加图片预览功能
    const fileInput = document.getElementById('rapid_ocr');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                showImagePreview(file);
            }
        });
    }
}

// 显示图片预览
function showImagePreview(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = document.getElementById('detect_img');
        if (img) {
            img.src = e.target.result;
            img.style.display = 'block';

            // 移除之前的尺寸设置
            img.removeAttribute('width');
            img.removeAttribute('height');

            // 添加图片加载完成后的处理
            img.onload = function() {
                if (typeof resetImageView === 'function') {
                    resetImageView();
                }
            };

            // 添加淡入动画
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
                img.style.opacity = '1';
            }, 10);
        }
    };
    reader.readAsDataURL(file);
}

// 增强的通知系统
function showEnhancedNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    const icon = type === 'error' ? 'exclamation-triangle' :
                 type === 'success' ? 'check-circle' : 'info-circle';

    notification.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    document.body.appendChild(notification);

    // 显示动画
    setTimeout(() => notification.classList.add('show'), 100);

    // 自动隐藏
    if (duration > 0) {
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.parentElement.removeChild(notification);
                }
            }, 300);
        }, duration);
    }
}

// 表格行点击不再复制，仅「复制全部」按钮复制

// 旧的结果统计图表功能 - 已弃用
function createStatsChart(detTime, clsTime, recTime) {
    // 此函数已不再使用，保留是为了向后兼容
    console.log('createStatsChart已弃用，使用新的性能统计设计');
}

// 添加图片缩放功能
function initImageViewer() {
    const vp = document.getElementById('imageViewport');
    const stage = document.getElementById('imageStage');
    if (!vp || !stage || vp.dataset.viewerReady === '1') {
        return;
    }
    vp.dataset.viewerReady = '1';

    let scale = 1;
    let tx = 0;
    let ty = 0;
    let dragging = false;
    let lx = 0;
    let ly = 0;

    let userZoomed = false;

    function apply() {
        stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    }

    function fitContain() {
        const img = document.getElementById('detect_img');
        userZoomed = false;
        if (!img || !img.naturalWidth || !vp.clientWidth || !vp.clientHeight) {
            scale = 1;
            tx = 0;
            ty = 0;
            apply();
            return;
        }
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        stage.style.width = nw + 'px';
        stage.style.height = nh + 'px';
        scale = Math.min(vp.clientWidth / nw, vp.clientHeight / nh);
        tx = (vp.clientWidth - nw * scale) / 2;
        ty = (vp.clientHeight - nh * scale) / 2;
        apply();
    }

    window.resetImageView = function () {
        fitContain();
    };

    const img = document.getElementById('detect_img');
    if (img) {
        img.addEventListener('load', fitContain);
    }
    window.addEventListener('resize', function () {
        if (!userZoomed) {
            fitContain();
        }
    });

    vp.addEventListener('wheel', function (e) {
        e.preventDefault();
        userZoomed = true;
        const rect = vp.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const next = Math.max(0.05, Math.min(8, scale * (e.deltaY > 0 ? 0.9 : 1.1)));
        const k = next / scale;
        tx = mx - k * (mx - tx);
        ty = my - k * (my - ty);
        scale = next;
        apply();
    }, { passive: false });

    vp.addEventListener('mousedown', function (e) {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        dragging = true;
        lx = e.clientX;
        ly = e.clientY;
        vp.classList.add('grabbing');
    });

    window.addEventListener('mousemove', function (e) {
        if (!dragging) {
            return;
        }
        tx += e.clientX - lx;
        ty += e.clientY - ly;
        lx = e.clientX;
        ly = e.clientY;
        apply();
    });

    window.addEventListener('mouseup', function () {
        dragging = false;
        vp.classList.remove('grabbing');
    });

    vp.addEventListener('dblclick', function () {
        window.resetImageView();
    });

    window.resetImageView();
}

function drawBoxOverlay(rows) {
    const img = document.getElementById('detect_img');
    const svg = document.getElementById('boxOverlay');
    if (!img || !svg) {
        return;
    }
    const paint = function () {
        const w = img.naturalWidth || 1;
        const h = img.naturalHeight || 1;
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        svg.innerHTML = '';
        (rows || []).forEach(function (row) {
            const pts = row[4] || [];
            if (!pts.length) {
                return;
            }
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' '));
            poly.setAttribute('class', 'ocr-box');
            poly.dataset.idx = String(row[0]);
            svg.appendChild(poly);
        });
    };
    if (!img.complete || !img.naturalWidth) {
        img.addEventListener('load', paint, { once: true });
    } else {
        paint();
    }
}

function addImageZoom() {
    initImageViewer();
}

// 添加键盘导航支持
function addKeyboardNavigation() {
    document.addEventListener('keydown', function(e) {
        const table = document.getElementById('locTable');
        if (table && table.style.display !== 'none') {
            const rows = table.querySelectorAll('tbody tr');
            const currentRow = table.querySelector('tbody tr.selected');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (currentRow) {
                    currentRow.classList.remove('selected');
                    const nextRow = currentRow.nextElementSibling;
                    if (nextRow) {
                        nextRow.classList.add('selected');
                    }
                } else if (rows.length > 0) {
                    rows[0].classList.add('selected');
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (currentRow) {
                    currentRow.classList.remove('selected');
                    const prevRow = currentRow.previousElementSibling;
                    if (prevRow) {
                        prevRow.classList.add('selected');
                    }
                } else if (rows.length > 0) {
                    rows[rows.length - 1].classList.add('selected');
                }
            } else if (e.key === 'Enter' && currentRow) {
                const textCell = currentRow.querySelector('.recognition-result');
                if (textCell) {
                    const text = textCell.textContent.trim();
                    navigator.clipboard.writeText(text);
                    showEnhancedNotification('文本已复制到剪贴板', 'success', 2000);
                }
            }
        }
    });
}

// 初始化所有增强功能
function initEnhancedFeatures() {
    initImageViewer();
    addKeyboardNavigation();
}

window.addEventListener('load', function() {
    initEnhancedFeatures();
});

window.adjustImageSizeAdaptive = function () {};
window.addImageZoom = addImageZoom;
window.initImageViewer = initImageViewer;
window.drawBoxOverlay = drawBoxOverlay;
window.resetImageView = window.resetImageView || function () {};