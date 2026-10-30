#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>

#ifndef GEOM_TEST
#include <fcntl.h>
#include <malloc.h>
#include <sys/file.h>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <X11/Xatom.h>
#include <X11/Xft/Xft.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XShm.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/extensions/Xfixes.h>
#include <X11/extensions/Xrandr.h>
#include <X11/extensions/shape.h>
#include <X11/keysym.h>
#endif

#define MIN_DIAMETER 96
#define DEFAULT_DIAMETER 360
#define ZOOM_MIN_H 125
#define ZOOM_MAX_H 600
#define FRAME_USEC 16000
#define WHEEL_FAST_US 140000LL
#define LABEL_USEC 800000LL
#define HINT_USEC 2000000LL
#define TOGGLE_GUARD_US 400000LL
#define SAVE_DELAY_US 200000LL
#define DIAMETER_STEP_SLOW 16
#define DIAMETER_STEP_FAST 48
#define ABS_DIAMETER_CAP 4096
#define FILTER_ZOOM_MIN_H 125
#define FILTER_ZOOM_MAX_H 625
#define FILTER_STEP_SLOW 25
#define FILTER_STEP_FAST 50

static int zoom_hundredths(double zoom) {
    if (zoom < 0) {
        zoom = 0;
    }
    return (int)(zoom * 100.0 + 0.5);
}

static double step_zoom(double zoom, int direction, int fast) {
    int hundredths = zoom_hundredths(zoom);
    int step = fast ? 50 : 10;
    if (direction > 0) {
        hundredths = (hundredths / step) * step + step;
    } else if (direction < 0) {
        if (hundredths % step == 0) {
            hundredths -= step;
        } else {
            hundredths = (hundredths / step) * step;
        }
    }
    if (hundredths < ZOOM_MIN_H) {
        hundredths = ZOOM_MIN_H;
    }
    if (hundredths > ZOOM_MAX_H) {
        hundredths = ZOOM_MAX_H;
    }
    return (double)hundredths / 100.0;
}

static double step_filter_zoom(double zoom, int direction, int fast) {
    int hundredths = zoom_hundredths(zoom);
    int step = fast ? FILTER_STEP_FAST : FILTER_STEP_SLOW;
    if (direction > 0) {
        hundredths = (hundredths / step) * step + step;
    } else if (direction < 0) {
        if (hundredths % step == 0) {
            hundredths -= step;
        } else {
            hundredths = (hundredths / step) * step;
        }
    }
    if (hundredths < FILTER_ZOOM_MIN_H) {
        hundredths = FILTER_ZOOM_MIN_H;
    }
    if (hundredths > FILTER_ZOOM_MAX_H) {
        hundredths = FILTER_ZOOM_MAX_H;
    }
    return (double)hundredths / 100.0;
}

static int filter_active(double zoom, double filter_zoom) {
    return zoom_hundredths(zoom) >= zoom_hundredths(filter_zoom);
}

static int wheel_is_fast(long long now_us, long long previous_us) {
    if (previous_us <= 0 || now_us < previous_us) {
        return 0;
    }
    return now_us - previous_us < WHEEL_FAST_US;
}

static int clamp_diameter(int diameter, int max_side) {
    int min_side = MIN_DIAMETER;
    if (max_side > 0 && max_side < min_side) {
        min_side = max_side;
    }
    if (diameter < min_side) {
        diameter = min_side;
    }
    if (max_side > 0 && diameter > max_side) {
        diameter = max_side;
    }
    if (diameter < 1) {
        diameter = 1;
    }
    return diameter;
}

static int step_diameter(int diameter, int direction, int fast, int max_side) {
    int step = fast ? DIAMETER_STEP_FAST : DIAMETER_STEP_SLOW;
    if (direction > 0) {
        diameter += step;
    } else if (direction < 0) {
        diameter -= step;
    }
    return clamp_diameter(diameter, max_side);
}

static int source_side(int diameter, double zoom) {
    int side;
    if (zoom < 1.0) {
        zoom = 1.0;
    }
    side = (int)((double)diameter / zoom + 0.5);
    if (side < 1) {
        side = 1;
    }
    if (side > diameter) {
        side = diameter;
    }
    return side;
}

static int circle_coverage(int x, int y, int diameter) {
    double center = ((double)diameter - 1.0) / 2.0;
    double radius = (double)diameter / 2.0;
    double dx = (double)x - center;
    double dy = (double)y - center;
    double dist = sqrt(dx * dx + dy * dy);
    double edge = radius - 1.0;
    double coverage = (edge + 1.5 - dist) / 1.5;
    if (coverage >= 1.0) {
        return 255;
    }
    if (coverage <= 0.0) {
        return 0;
    }
    return (int)(coverage * 255.0 + 0.5);
}

static int clamp_index(int value, int limit) {
    if (value < 0) {
        return 0;
    }
    if (value >= limit) {
        return limit - 1;
    }
    return value;
}

static const uint8_t *pix3(const uint8_t *src, int sw, int sh, int x, int y) {
    x = clamp_index(x, sw);
    y = clamp_index(y, sh);
    return src + ((size_t)y * (size_t)sw + (size_t)x) * 3;
}

static int luma3(const uint8_t *pixel) {
    return (77 * pixel[0] + 150 * pixel[1] + 29 * pixel[2]) >> 8;
}

static void copy3(uint8_t *out, const uint8_t *pixel) {
    out[0] = pixel[0];
    out[1] = pixel[1];
    out[2] = pixel[2];
}

static void mix3(uint8_t *out, const uint8_t *a, const uint8_t *b, int t) {
    int channel;
    if (t <= 0) {
        copy3(out, a);
        return;
    }
    if (t >= 256) {
        copy3(out, b);
        return;
    }
    for (channel = 0; channel < 3; channel++) {
        out[channel] = (uint8_t)((a[channel] * (256 - t) + b[channel] * t + 128) >> 8);
    }
}

static void split_fixed(int fp, int *whole, int *frac) {
    if (fp >= 0) {
        *whole = fp >> 16;
        *frac = fp & 65535;
        return;
    }
    {
        int n = -fp;
        int hi = n >> 16;
        int rem = n & 65535;
        if (rem == 0) {
            *whole = -hi;
            *frac = 0;
        } else {
            *whole = -hi - 1;
            *frac = 65536 - rem;
        }
    }
}

/* sharp 为 0 时直接取最近像素。为 1 时横竖边取最近像素，斜向只在相邻四个像素里混合。 */
static int magnify_at(const uint8_t *src, int sw, int sh, uint8_t *dst, int dw, int dh, int sharp) {
    int y;
    if (!src || !dst || sw < 1 || sh < 1 || dw < 1 || dh < 1) {
        return 0;
    }
    if (sw > 8192 || sh > 8192 || dw > 8192 || dh > 8192) {
        return 0;
    }
    for (y = 0; y < dh; y++) {
        int sy_fp = (int)(((long long)(y * 2 + 1) * sh * 32768) / dh) - 32768;
        int iy, fy;
        int x;
        split_fixed(sy_fp, &iy, &fy);
        for (x = 0; x < dw; x++) {
            int sx_fp = (int)(((long long)(x * 2 + 1) * sw * 32768) / dw) - 32768;
            int ix, fx;
            const uint8_t *p00;
            const uint8_t *p10;
            const uint8_t *p01;
            const uint8_t *p11;
            int l00, l10, l01, l11;
            int gx, gy;
            uint8_t *out = dst + ((size_t)y * (size_t)dw + (size_t)x) * 3;
            split_fixed(sx_fp, &ix, &fx);
            if (!sharp) {
                int nx = fx >= 32768 ? ix + 1 : ix;
                int ny = fy >= 32768 ? iy + 1 : iy;
                copy3(out, pix3(src, sw, sh, nx, ny));
                continue;
            }
            p00 = pix3(src, sw, sh, ix, iy);
            p10 = pix3(src, sw, sh, ix + 1, iy);
            p01 = pix3(src, sw, sh, ix, iy + 1);
            p11 = pix3(src, sw, sh, ix + 1, iy + 1);
            l00 = luma3(p00);
            l10 = luma3(p10);
            l01 = luma3(p01);
            l11 = luma3(p11);
            gx = abs(l00 - l10) + abs(l01 - l11);
            gy = abs(l00 - l01) + abs(l10 - l11);
            if (gx + gy < 28 || gx * 2 <= gy || gy * 2 <= gx) {
                int nx = fx >= 32768 ? ix + 1 : ix;
                int ny = fy >= 32768 ? iy + 1 : iy;
                copy3(out, pix3(src, sw, sh, nx, ny));
            } else {
                uint8_t top[3];
                uint8_t bot[3];
                int wx = (fx * 256) >> 16;
                int wy = (fy * 256) >> 16;
                mix3(top, p00, p10, wx);
                mix3(bot, p01, p11, wy);
                mix3(out, top, bot, wy);
            }
        }
    }
    return 1;
}

typedef struct {
    int x, y, w, h;
} Rect;

static int push_rect(Rect *out, int count, int x, int y, int w, int h) {
    if (w < 1 || h < 1 || count >= 4) {
        return count;
    }
    out[count].x = x;
    out[count].y = y;
    out[count].w = w;
    out[count].h = h;
    return count + 1;
}

/* 旧方框里、新方框外的区域。新圆先画上，这些矩形才涂透明。 */
static int outside_rects(Rect old, Rect neu, Rect *out) {
    int count = 0;
    int old_r;
    int old_b;
    int neu_r;
    int neu_b;
    int overlap_x;
    int overlap_r;
    if (old.w < 1 || old.h < 1) {
        return 0;
    }
    if (neu.w < 1 || neu.h < 1) {
        out[0] = old;
        return 1;
    }
    old_r = old.x + old.w;
    old_b = old.y + old.h;
    neu_r = neu.x + neu.w;
    neu_b = neu.y + neu.h;
    if (old.x < neu.x) {
        int width = neu.x - old.x;
        if (width > old.w) {
            width = old.w;
        }
        count = push_rect(out, count, old.x, old.y, width, old.h);
    }
    if (old_r > neu_r) {
        int x = neu_r > old.x ? neu_r : old.x;
        count = push_rect(out, count, x, old.y, old_r - x, old.h);
    }
    overlap_x = old.x > neu.x ? old.x : neu.x;
    overlap_r = old_r < neu_r ? old_r : neu_r;
    if (overlap_r > overlap_x && old.y < neu.y) {
        int height = neu.y - old.y;
        if (old.y + height > old_b) {
            height = old_b - old.y;
        }
        count = push_rect(out, count, overlap_x, old.y, overlap_r - overlap_x, height);
    }
    if (overlap_r > overlap_x && old_b > neu_b) {
        int y = neu_b > old.y ? neu_b : old.y;
        count = push_rect(out, count, overlap_x, y, overlap_r - overlap_x, old_b - y);
    }
    return count;
}

#ifdef GEOM_TEST

static int g_failed;

static void expect(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed++;
    }
}

static int count_mid(const uint8_t *rgb, int count) {
    int mid = 0;
    int i;
    for (i = 0; i < count; i++) {
        uint8_t value = rgb[i * 3];
        if (value > 12 && value < 243) {
            mid++;
        }
    }
    return mid;
}

int main(void) {
    double zoom = 2.0;
    int i;
    int opaque = 0;
    int clear = 0;
    int partial = 0;
    expect(zoom_hundredths(step_zoom(2.0, 1, 0)) == 210, "慢滚一格从 2 到 2.1");
    expect(zoom_hundredths(step_zoom(2.0, -1, 0)) == 190, "慢滚一格从 2 到 1.9");
    expect(zoom_hundredths(step_zoom(2.0, 1, 1)) == 250, "快拨一格从 2 到 2.5");
    expect(zoom_hundredths(step_zoom(2.0, -1, 1)) == 150, "快拨一格从 2 到 1.5");
    for (i = 0; i < 4; i++) {
        zoom = step_zoom(zoom, 1, 1);
    }
    expect(zoom_hundredths(zoom) == 400, "快拨四格从 2 到 4");
    zoom = 2.0;
    for (i = 0; i < 8; i++) {
        zoom = step_zoom(zoom, 1, 1);
    }
    expect(zoom_hundredths(zoom) == 600, "快拨八格从 2 到 6");
    expect(zoom_hundredths(step_zoom(zoom, 1, 1)) == 600, "到 6 后不再增加");
    expect(zoom_hundredths(step_zoom(1.25, -1, 0)) == 125, "不低于 1.25");
    expect(zoom_hundredths(step_zoom(5.9, 1, 1)) == 600, "快拨从 5.9 贴到 6");
    zoom = 2.0;
    for (i = 0; i < 40; i++) {
        zoom = step_zoom(zoom, 1, 0);
    }
    expect(zoom_hundredths(zoom) == 600, "慢滚四十格从 2 到 6");
    expect(!wheel_is_fast(1000, 0), "第一格算慢滚");
    expect(!wheel_is_fast(200000, 1000), "间隔大算慢滚");
    expect(wheel_is_fast(100000, 1000), "间隔小算快拨");
    expect(!wheel_is_fast(1000, 5000), "时间倒退算慢滚");
    expect(step_diameter(360, 1, 0, 1080) == 376, "慢滚直径加 16");
    expect(step_diameter(360, -1, 0, 1080) == 344, "慢滚直径减 16");
    expect(step_diameter(360, 1, 1, 1080) == 408, "快拨直径加 48");
    expect(step_diameter(360, -1, 1, 1080) == 312, "快拨直径减 48");
    expect(step_diameter(100, -1, 1, 1080) == MIN_DIAMETER, "直径不低于 96");
    expect(step_diameter(1050, 1, 1, 1080) == 1080, "直径快拨不超过较短边");
    expect(source_side(360, 2.0) == 180, "2 倍取样边长");
    expect(source_side(360, 6.0) == 60, "6 倍取样边长");
    expect(clamp_diameter(40, 1080) == MIN_DIAMETER, "直径下限 96");
    expect(clamp_diameter(2000, 1080) == 1080, "直径不超过较短边");
    expect(clamp_diameter(360, 1080) == 360, "合法直径保持不变");
    for (int y = 0; y < 64; y++) {
        for (int x = 0; x < 64; x++) {
            int coverage = circle_coverage(x, y, 64);
            if (coverage == 0) {
                clear++;
            } else if (coverage == 255) {
                opaque++;
            } else {
                partial++;
            }
        }
    }
    expect(circle_coverage(32, 32, 64) == 255, "圆心不透明");
    expect(circle_coverage(0, 0, 64) == 0, "窗口角透明");
    expect(opaque > 0 && clear > 0 && partial > 0, "圆边有半透明过渡");
    {
        uint8_t src[8 * 8 * 3];
        uint8_t dst[16 * 16 * 3];
        int mid = 0;
        int flat_ok;
        memset(src, 0, sizeof src);
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                uint8_t value = x > y ? 255 : 0;
                src[(y * 8 + x) * 3] = value;
                src[(y * 8 + x) * 3 + 1] = value;
                src[(y * 8 + x) * 3 + 2] = value;
            }
        }
        expect(magnify_at(src, 8, 8, dst, 16, 16, 1), "斜线放大成功");
        mid = count_mid(dst, 16 * 16);
        expect(mid > 8, "斜线放大后有过渡色");
        memset(src, 40, sizeof src);
        expect(magnify_at(src, 8, 8, dst, 16, 16, 1), "纯色放大成功");
        flat_ok = dst[0] > 20 && dst[0] < 60 && dst[1] > 20 && dst[1] < 60;
        expect(flat_ok, "纯色放大后仍接近原色");
    }
    {
        uint8_t src[4 * 4 * 3];
        uint8_t dst[24 * 24 * 3];
        memset(src, 128, sizeof src);
        expect(magnify_at(src, 4, 4, dst, 24, 24, 1), "6 倍放大成功");
    }
    {
        uint8_t src[8 * 8 * 3];
        uint8_t dst[16 * 16 * 3];
        memset(src, 0, sizeof src);
        for (int y = 0; y < 8; y++) {
            for (int x = 4; x < 8; x++) {
                src[(y * 8 + x) * 3] = 255;
                src[(y * 8 + x) * 3 + 1] = 255;
                src[(y * 8 + x) * 3 + 2] = 255;
            }
        }
        expect(magnify_at(src, 8, 8, dst, 16, 16, 1), "竖边放大成功");
        expect(count_mid(dst, 16 * 16) == 0, "竖边放大后仍是纯色");
    }
    {
        uint8_t src[8 * 8 * 3];
        uint8_t dst[16 * 16 * 3];
        memset(src, 0, sizeof src);
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                uint8_t value = x > y ? 255 : 0;
                src[(y * 8 + x) * 3] = value;
                src[(y * 8 + x) * 3 + 1] = value;
                src[(y * 8 + x) * 3 + 2] = value;
            }
        }
        expect(magnify_at(src, 8, 8, dst, 16, 16, 0), "低于阈值时斜线放大成功");
        expect(count_mid(dst, 16 * 16) == 0, "低于阈值时斜线没有过渡色");
        expect(filter_active(1.5, 2.0) == 0, "1.5 倍低于阈值 2");
        expect(filter_active(2.0, 2.0) == 1, "2 倍不低于阈值 2");
        expect(filter_active(6.0, 6.25) == 0, "6.25 表示始终直接取像素");
        expect(filter_active(1.25, 1.25) == 1, "1.25 表示始终走边缘判断");
    }
    expect(zoom_hundredths(step_filter_zoom(2.0, 1, 0)) == 225, "慢滚阈值从 2 到 2.25");
    expect(zoom_hundredths(step_filter_zoom(2.0, 1, 1)) == 250, "快拨阈值从 2 到 2.5");
    expect(zoom_hundredths(step_filter_zoom(2.0, -1, 0)) == 175, "慢滚阈值从 2 到 1.75");
    expect(zoom_hundredths(step_filter_zoom(1.25, -1, 1)) == 125, "阈值不低于 1.25");
    expect(zoom_hundredths(step_filter_zoom(6.0, 1, 1)) == 625, "阈值快拨不超过 6.25");
    expect(zoom_hundredths(step_filter_zoom(6.25, 1, 0)) == 625, "阈值到 6.25 后不再增加");
    expect(zoom_hundredths(step_filter_zoom(8.0, 0, 0)) == 625, "过高阈值夹到 6.25");
    expect(zoom_hundredths(step_filter_zoom(0.5, 0, 0)) == 125, "过低阈值夹到 1.25");
    {
        Rect old_box;
        Rect new_box;
        Rect extra[4];
        int count;
        int x;
        int y;
        int mismatch = 0;
        old_box.x = 0;
        old_box.y = 0;
        old_box.w = 100;
        old_box.h = 100;
        new_box.x = 10;
        new_box.y = 10;
        new_box.w = 80;
        new_box.h = 80;
        count = outside_rects(old_box, new_box, extra);
        for (y = -2; y < 120; y++) {
            for (x = -2; x < 120; x++) {
                int in_old = x >= old_box.x && y >= old_box.y && x < old_box.x + old_box.w && y < old_box.y + old_box.h;
                int in_new = x >= new_box.x && y >= new_box.y && x < new_box.x + new_box.w && y < new_box.y + new_box.h;
                int want = in_old && !in_new;
                int got = 0;
                int i;
                for (i = 0; i < count; i++) {
                    if (x >= extra[i].x && y >= extra[i].y && x < extra[i].x + extra[i].w && y < extra[i].y + extra[i].h) {
                        got = 1;
                    }
                }
                if (want != got) {
                    mismatch++;
                }
            }
        }
        expect(mismatch == 0, "缩小后只擦退出新方框的像素");
        expect(count > 0, "缩小后确有一圈要擦");
        new_box.x = 0;
        new_box.y = 0;
        new_box.w = 120;
        new_box.h = 120;
        count = outside_rects(old_box, new_box, extra);
        expect(count == 0, "放大后旧方框被新方框盖住，不必再擦");
    }
    if (g_failed) {
        fprintf(stderr, "%d 项断言失败\n", g_failed);
        return 1;
    }
    printf("几何断言通过\n");
    return 0;
}

#else

typedef struct {
    Window id;
    int x, y, w, h;
    int mapped;
    int depth;
    int rshift, gshift, bshift, ashift;
} TopWin;

static const uint8_t k_glyph[12][7] = {
    {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E},
    {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E},
    {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
    {0x0E, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0E},
    {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02},
    {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
    {0x0E, 0x10, 0x1E, 0x11, 0x11, 0x11, 0x0E},
    {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},
    {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
    {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x01, 0x0E},
    {0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C},
    {0x00, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x00},
};

typedef struct {
    Display *dpy;
    int screen;
    Window root;
    Window win;
    Visual *visual;
    int depth;
    Colormap cmap;
    GC gc;
    XImage *frame;
    XShmSegmentInfo frame_shm;
    int frame_w;
    int frame_h;
    int full_put;
    int shm_event;
    int frame_epoch;
    int frame_acked;
    int rshift, gshift, bshift, ashift;

    unsigned esc_code;
    int esc_grabbed;
    int wheel_grabbed;
    int pointer_grabbed;
    char hotkey[64];
    char size_key[16];
    unsigned int size_mod;

    double zoom;
    double filter_zoom;
    int pref_d;
    int shown_d;
    int max_d;
    int center_x, center_y;
    Rect rect;
    Rect monitor;
    int monitor_ready;
    int monitor_rw;
    int monitor_rh;
    int have_rect;
    int mapped;
    int cursor_hidden;
    int ever_shown;
    long long label_until;
    long long hint_until;
    long long toggle_after;
    int label_mode;
    int label_on_frame;
    int size_down;
    int shift_down;
    int hint_y;
    int hint_h;
    long long last_wheel_us;
    long long save_at;
    int need_paint;

    TopWin *tops;
    int ntop;
    int tops_ready;
    int tops_dirty;
    int root_w, root_h;
    uint8_t *hint_alpha;
    int hint_w;
    uint8_t *src_buf;
    uint8_t *dst_buf;
    size_t src_cap;
    size_t dst_cap;

    char conf_path[4096];
    int filter_from_wheel;
} App;

static int g_x_error;
static int g_quiet_x;
static int g_lock_fd = -1;
static volatile sig_atomic_t g_stop;
static volatile sig_atomic_t g_toggle;

static int on_x_error(Display *dpy, XErrorEvent *event) {
    char text[128];
    g_x_error = event->error_code;
    if (g_quiet_x || event->error_code == BadAccess) {
        return 0;
    }
    XGetErrorText(dpy, event->error_code, text, sizeof text);
    fprintf(stderr, "X 错误: %s\n", text);
    return 0;
}

static void on_signal(int sig) {
    (void)sig;
    g_stop = 1;
}

static void on_toggle(int sig) {
    (void)sig;
    g_toggle = 1;
}

static void release_lock(void) {
    if (g_lock_fd >= 0) {
        close(g_lock_fd);
        g_lock_fd = -1;
    }
}

static int claim_primary(void) {
    char exe[4096];
    char path[4200];
    ssize_t length;
    char *slash;
    int fd;
    int tries;
    length = readlink("/proc/self/exe", exe, sizeof exe - 1);
    if (length < 0) {
        return 1;
    }
    exe[length] = '\0';
    slash = strrchr(exe, '/');
    if (!slash) {
        return 1;
    }
    *slash = '\0';
    if (snprintf(path, sizeof path, "%s/magnifier.lock", exe) >= (int)sizeof path) {
        return 1;
    }
    fd = open(path, O_RDWR | O_CREAT, 0600);
    if (fd < 0) {
        return 1;
    }
    if (flock(fd, LOCK_EX | LOCK_NB) != 0) {
        if (errno != EWOULDBLOCK && errno != EAGAIN) {
            close(fd);
            return 1;
        }
        for (tries = 0; tries < 15; tries++) {
            char buf[64];
            ssize_t n;
            char *end = NULL;
            long pid;
            if (lseek(fd, 0, SEEK_SET) < 0) {
                break;
            }
            n = read(fd, buf, sizeof buf - 1);
            if (n > 0) {
                buf[n] = '\0';
                pid = strtol(buf, &end, 10);
                if (pid > 1 && pid != (long)getpid()) {
                    kill((pid_t)pid, SIGUSR1);
                    close(fd);
                    return 0;
                }
            }
            usleep(20000);
        }
        close(fd);
        return 0;
    }
    if (ftruncate(fd, 0) == 0) {
        dprintf(fd, "%ld\n", (long)getpid());
    }
    g_lock_fd = fd;
    return 1;
}

static int session_is_x11(void) {
    const char *session = getenv("XDG_SESSION_TYPE");
    if (!getenv("DISPLAY")) {
        return 0;
    }
    if (!session || !session[0]) {
        return 1;
    }
    return strcasecmp(session, "x11") == 0;
}

static char *trim(char *text) {
    char *end;
    while (*text && isspace((unsigned char)*text)) {
        text++;
    }
    end = text + strlen(text);
    while (end > text && isspace((unsigned char)end[-1])) {
        *--end = '\0';
    }
    return text;
}

static long long mono_us(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)now.tv_sec * 1000000LL + (long long)now.tv_nsec / 1000LL;
}

static int mask_shift(unsigned long mask) {
    int shift = 0;
    if (mask == 0) {
        return 0;
    }
    while ((mask & 1UL) == 0) {
        mask >>= 1;
        shift++;
    }
    return shift;
}

static void format_zoom_number(char *buf, size_t size, double zoom) {
    int hundredths = zoom_hundredths(zoom);
    int whole = hundredths / 100;
    int frac = hundredths % 100;
    if (frac == 0) {
        snprintf(buf, size, "%d", whole);
    } else if (frac % 10 == 0) {
        snprintf(buf, size, "%d.%d", whole, frac / 10);
    } else {
        snprintf(buf, size, "%d.%02d", whole, frac);
    }
}

static void format_filter_label(char *buf, size_t size, double filter_zoom) {
    int hundredths = zoom_hundredths(filter_zoom);
    if (hundredths < 0) {
        hundredths = 0;
    }
    snprintf(buf, size, "%d.%02d", hundredths / 100, hundredths % 100);
}

static void set_conf_path(App *app) {
    char exe[4096];
    char dir[4000];
    ssize_t length = readlink("/proc/self/exe", exe, sizeof exe - 1);
    char *slash;
    if (length < 0) {
        snprintf(app->conf_path, sizeof app->conf_path, "magnifier.conf");
        return;
    }
    exe[length] = '\0';
    slash = strrchr(exe, '/');
    if (!slash || (size_t)(slash - exe) >= sizeof dir) {
        snprintf(app->conf_path, sizeof app->conf_path, "magnifier.conf");
        return;
    }
    *slash = '\0';
    memcpy(dir, exe, (size_t)(slash - exe) + 1);
    snprintf(app->conf_path, sizeof app->conf_path, "%s/magnifier.conf", dir);
}

static int parse_hotkey(const char *text, int *mods, KeySym *keysym) {
    char buf[128];
    char *save = NULL;
    char *token;
    char key[32];
    snprintf(buf, sizeof buf, "%s", text);
    for (char *p = buf; *p; p++) {
        *p = (char)tolower((unsigned char)*p);
    }
    *mods = 0;
    key[0] = '\0';
    token = strtok_r(buf, "+", &save);
    while (token) {
        token = trim(token);
        if (!strcmp(token, "ctrl") || !strcmp(token, "control")) {
            *mods |= ControlMask;
        } else if (!strcmp(token, "alt")) {
            *mods |= Mod1Mask;
        } else if (!strcmp(token, "shift")) {
            *mods |= ShiftMask;
        } else if (!strcmp(token, "super") || !strcmp(token, "win") || !strcmp(token, "mod4")) {
            *mods |= Mod4Mask;
        } else if (strlen(token) < sizeof key) {
            snprintf(key, sizeof key, "%s", token);
        }
        token = strtok_r(NULL, "+", &save);
    }
    if (!key[0]) {
        return 0;
    }
    *keysym = XStringToKeysym(key);
    return *keysym != NoSymbol;
}

static int parse_size_key(const char *text, unsigned int *mod) {
    char buf[32];
    size_t n = 0;
    const char *p = text;
    while (*p == ' ' || *p == '\t') {
        p++;
    }
    while (p[n] && p[n] != ' ' && p[n] != '\t' && p[n] != '#' && n + 1 < sizeof buf) {
        buf[n] = (char)tolower((unsigned char)p[n]);
        n++;
    }
    buf[n] = '\0';
    if (!strcmp(buf, "alt") || !strcmp(buf, "mod1")) {
        *mod = Mod1Mask;
        return 1;
    }
    if (!strcmp(buf, "ctrl") || !strcmp(buf, "control")) {
        *mod = ControlMask;
        return 1;
    }
    if (!strcmp(buf, "shift")) {
        *mod = ShiftMask;
        return 1;
    }
    if (!strcmp(buf, "super") || !strcmp(buf, "win") || !strcmp(buf, "mod4")) {
        *mod = Mod4Mask;
        return 1;
    }
    return 0;
}

static const char *size_key_token(unsigned int mod) {
    if (mod == ControlMask) {
        return "ctrl";
    }
    if (mod == ShiftMask) {
        return "shift";
    }
    if (mod == Mod4Mask) {
        return "super";
    }
    return "alt";
}

static const char *size_key_label(unsigned int mod) {
    if (mod == ControlMask) {
        return "Ctrl";
    }
    if (mod == ShiftMask) {
        return "Shift";
    }
    if (mod == Mod4Mask) {
        return "Super";
    }
    return "Alt";
}

static int read_filter_zoom_file(App *app, double *out) {
    FILE *file;
    char line[256];
    int found = 0;
    double value = 0;
    file = fopen(app->conf_path, "r");
    if (!file) {
        return 0;
    }
    while (fgets(line, sizeof line, file)) {
        char *text = trim(line);
        char *eq;
        char *key;
        char *item;
        if (!text[0] || text[0] == '#') {
            continue;
        }
        eq = strchr(text, '=');
        if (!eq) {
            continue;
        }
        *eq = '\0';
        key = trim(text);
        item = trim(eq + 1);
        if (!strcmp(key, "filter_zoom")) {
            char *end = NULL;
            double parsed = strtod(item, &end);
            if (end != item) {
                value = step_filter_zoom(parsed, 0, 0);
                found = 1;
            }
        }
    }
    fclose(file);
    if (!found) {
        return 0;
    }
    *out = value;
    return 1;
}

static int read_size_key_file(App *app, unsigned int *mod) {
    FILE *file;
    char line[256];
    int found = 0;
    unsigned int value = 0;
    file = fopen(app->conf_path, "r");
    if (!file) {
        return 0;
    }
    while (fgets(line, sizeof line, file)) {
        char *text = trim(line);
        char *eq;
        char *key;
        char *item;
        if (!text[0] || text[0] == '#') {
            continue;
        }
        eq = strchr(text, '=');
        if (!eq) {
            continue;
        }
        *eq = '\0';
        key = trim(text);
        item = trim(eq + 1);
        if (!strcmp(key, "size_key") && parse_size_key(item, &value)) {
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        return 0;
    }
    *mod = value;
    return 1;
}

static int save_config(App *app) {
    char tmp[4200];
    char zoom_text[32];
    char filter_text[32];
    double filter_value = app->filter_zoom;
    FILE *file;
    if (!app->filter_from_wheel) {
        double from_file = 0;
        if (read_filter_zoom_file(app, &from_file)) {
            filter_value = from_file;
        }
    }
    snprintf(tmp, sizeof tmp, "%s.tmp", app->conf_path);
    file = fopen(tmp, "w");
    if (!file) {
        fprintf(stderr, "无法写入配置: %s\n", app->conf_path);
        return 0;
    }
    format_zoom_number(zoom_text, sizeof zoom_text, app->zoom);
    format_zoom_number(filter_text, sizeof filter_text, filter_value);
    {
        unsigned int size_mod = app->size_mod;
        if (!read_size_key_file(app, &size_mod)) {
            size_mod = app->size_mod;
        }
        fputs("# 放大镜配置。以 # 开头的行是说明，程序不读取。\n"
              "# size_key 保存后，下一次滚轮就按新键。filter_zoom 在下一次改倍率时生效。不必重启。\n"
              "# 滚轮调过的倍率、直径和阈值会写回下面的值，说明会保留。\n"
              "#\n"
              "# hotkey：建议绑到桌面快捷键上的组合。程序不抓取这个键。\n"
              "#         可用 ctrl、alt、shift、super，用加号连接，例如 ctrl+alt+space。\n",
              file);
        fprintf(file, "hotkey=%s\n", app->hotkey);
        fputs("#\n"
              "# zoom：放大倍率，范围 1.25 到 6。没按住改大小的键、也没按住 Shift 时，滚轮改这项。\n",
              file);
        fprintf(file, "zoom=%s\n", zoom_text);
        fputs("#\n"
              "# diameter：圆的直径，单位像素。最小 96，最大不超过指针所在显示器较短的一边。\n",
              file);
        fprintf(file, "diameter=%d\n", app->pref_d);
        fputs("#\n"
              "# filter_zoom：算法阈值，范围 1.25 到 6.25。\n"
              "#              当前倍率低于它时直接取最近的像素；不低于时横竖保持清晰，斜线才做过渡。\n"
              "#              1.25 表示始终做边缘判断，6.25 表示始终直接取像素。\n"
              "#              size_key 不是 shift 时，按住 Shift 滚轮改这项。默认 size_key 是 shift，这时 Shift 只改直径。\n",
              file);
        fprintf(file, "filter_zoom=%s\n", filter_text);
        fputs("#\n"
              "# size_key：按住这个键再滚轮，改变圆的直径。可选 alt、ctrl、shift、super，默认 shift。\n"
              "#           保存后下一次滚轮即生效，不必重启。\n"
              "#           选 ctrl 时，Ctrl+滚轮改直径，不再送给下面的窗口。\n"
              "#           选别的键时，Ctrl+滚轮仍送给下面的窗口。\n",
              file);
        fprintf(file, "size_key=%s\n", size_key_token(size_mod));
    }
    if (fclose(file) != 0) {
        return 0;
    }
    if (rename(tmp, app->conf_path) != 0) {
        fprintf(stderr, "无法更新配置: %s\n", app->conf_path);
        return 0;
    }
    app->filter_from_wheel = 0;
    return 1;
}

static void set_default_config(App *app) {
    snprintf(app->hotkey, sizeof app->hotkey, "ctrl+alt+space");
    snprintf(app->size_key, sizeof app->size_key, "shift");
    app->size_mod = ShiftMask;
    app->zoom = 2.0;
    app->filter_zoom = 2.0;
    app->pref_d = DEFAULT_DIAMETER;
}

static int parse_diameter(const char *value, int *out) {
    char *end = NULL;
    long parsed = strtol(value, &end, 10);
    if (end == value || parsed <= 0 || parsed > 100000) {
        return 0;
    }
    *out = (int)parsed;
    return 1;
}

static int load_config(App *app) {
    FILE *file;
    int dirty = 0;
    int saw_zoom = 0;
    int saw_filter = 0;
    int saw_diameter = 0;
    int saw_size = 0;
    int saw_w = 0;
    int saw_h = 0;
    int old_w = 0;
    int old_h = 0;
    char line[256];
    set_default_config(app);
    file = fopen(app->conf_path, "r");
    if (!file) {
        return save_config(app);
    }
    while (fgets(line, sizeof line, file)) {
        char *text = trim(line);
        char *eq;
        char *key;
        char *value;
        if (!text[0] || text[0] == '#') {
            continue;
        }
        eq = strchr(text, '=');
        if (!eq) {
            continue;
        }
        *eq = '\0';
        key = trim(text);
        value = trim(eq + 1);
        if (!strcmp(key, "hotkey") && value[0]) {
            snprintf(app->hotkey, sizeof app->hotkey, "%s", value);
        } else if (!strcmp(key, "zoom")) {
            char *end = NULL;
            double parsed = strtod(value, &end);
            saw_zoom = 1;
            if (end == value) {
                app->zoom = 2.0;
                dirty = 1;
            } else {
                double clamped = step_zoom(parsed, 0, 0);
                if (zoom_hundredths(clamped) != zoom_hundredths(parsed)) {
                    dirty = 1;
                }
                app->zoom = clamped;
            }
        } else if (!strcmp(key, "filter_zoom")) {
            char *end = NULL;
            double parsed = strtod(value, &end);
            saw_filter = 1;
            if (end == value) {
                app->filter_zoom = 2.0;
                dirty = 1;
            } else {
                double clamped = step_filter_zoom(parsed, 0, 0);
                if (zoom_hundredths(clamped) != zoom_hundredths(parsed)) {
                    dirty = 1;
                }
                app->filter_zoom = clamped;
            }
        } else if (!strcmp(key, "diameter")) {
            int parsed = 0;
            saw_diameter = 1;
            if (!parse_diameter(value, &parsed)) {
                app->pref_d = DEFAULT_DIAMETER;
                dirty = 1;
            } else {
                app->pref_d = parsed;
            }
        } else if (!strcmp(key, "size_key") && value[0]) {
            unsigned int mod = 0;
            saw_size = 1;
            if (!parse_size_key(value, &mod)) {
                app->size_mod = ShiftMask;
                dirty = 1;
            } else {
                app->size_mod = mod;
                if (strcmp(value, size_key_token(mod)) != 0) {
                    dirty = 1;
                }
            }
        } else if (!strcmp(key, "width")) {
            saw_w = 1;
            old_w = atoi(value);
        } else if (!strcmp(key, "height")) {
            saw_h = 1;
            old_h = atoi(value);
        }
    }
    fclose(file);
    if (!saw_zoom) {
        app->zoom = 2.0;
        dirty = 1;
    }
    if (!saw_filter) {
        app->filter_zoom = 2.0;
        dirty = 1;
    }
    if (!saw_size) {
        app->size_mod = ShiftMask;
        dirty = 1;
    }
    snprintf(app->size_key, sizeof app->size_key, "%s", size_key_token(app->size_mod));
    if (!saw_diameter) {
        if (saw_w && saw_h && old_w > 0 && old_h > 0) {
            app->pref_d = old_w < old_h ? old_w : old_h;
        } else if (saw_w && old_w > 0) {
            app->pref_d = old_w;
        } else if (saw_h && old_h > 0) {
            app->pref_d = old_h;
        } else {
            app->pref_d = DEFAULT_DIAMETER;
        }
        dirty = 1;
    }
    if (saw_w || saw_h) {
        dirty = 1;
    }
    {
        int clamped = clamp_diameter(app->pref_d, ABS_DIAMETER_CAP);
        if (clamped != app->pref_d) {
            app->pref_d = clamped;
            dirty = 1;
        }
    }
    {
        int mods = 0;
        KeySym keysym = NoSymbol;
        char normalized[64];
        if (!parse_hotkey(app->hotkey, &mods, &keysym)) {
            snprintf(app->hotkey, sizeof app->hotkey, "ctrl+alt+space");
            dirty = 1;
        } else {
            snprintf(normalized, sizeof normalized, "%s", app->hotkey);
            for (char *p = normalized; *p; p++) {
                *p = (char)tolower((unsigned char)*p);
            }
            if (strcmp(normalized, app->hotkey) != 0) {
                snprintf(app->hotkey, sizeof app->hotkey, "%s", normalized);
                dirty = 1;
            }
        }
    }
    if (dirty && !save_config(app)) {
        return 0;
    }
    return 1;
}

static int grab_button_ok(App *app, unsigned int button, unsigned int mods, unsigned int mask) {
    g_x_error = 0;
    XGrabButton(app->dpy, button, mods, app->root, False, mask, GrabModeSync, GrabModeAsync, None, None);
    XSync(app->dpy, False);
    return g_x_error == 0;
}

static void grab_wheel(App *app) {
    unsigned int locks[] = {0, LockMask, Mod2Mask, Mod5Mask, LockMask | Mod2Mask, LockMask | Mod5Mask, Mod2Mask | Mod5Mask,
                            LockMask | Mod2Mask | Mod5Mask};
    unsigned int extras[] = {ControlMask, Mod1Mask, Mod4Mask};
    int size_ok = 1;
    int shift_ok = 1;
    if (app->wheel_grabbed || app->pointer_grabbed) {
        return;
    }
    if (!grab_button_ok(app, Button4, 0, ButtonPressMask) || !grab_button_ok(app, Button5, 0, ButtonPressMask)) {
        XUngrabButton(app->dpy, Button4, AnyModifier, app->root);
        XUngrabButton(app->dpy, Button5, AnyModifier, app->root);
        fprintf(stderr, "滚轮调节不可用\n");
        return;
    }
    app->wheel_grabbed = 1;
    for (unsigned int button = Button4; button <= Button5; button++) {
        for (size_t i = 0; i < sizeof locks / sizeof locks[0]; i++) {
            size_t extra_i;
            if (locks[i] != 0) {
                grab_button_ok(app, button, locks[i], ButtonPressMask);
            }
            if (!grab_button_ok(app, button, locks[i] | app->size_mod, ButtonPressMask)) {
                size_ok = 0;
            }
            if (app->size_mod != ShiftMask) {
                if (!grab_button_ok(app, button, locks[i] | ShiftMask, ButtonPressMask)) {
                    shift_ok = 0;
                }
                if (!grab_button_ok(app, button, locks[i] | app->size_mod | ShiftMask, ButtonPressMask)) {
                    size_ok = 0;
                }
            }
            for (extra_i = 0; extra_i < sizeof extras / sizeof extras[0]; extra_i++) {
                if (extras[extra_i] == app->size_mod) {
                    continue;
                }
                if (!grab_button_ok(app, button, locks[i] | app->size_mod | extras[extra_i], ButtonPressMask)) {
                    size_ok = 0;
                }
                if (app->size_mod != ShiftMask) {
                    if (!grab_button_ok(app, button, locks[i] | app->size_mod | extras[extra_i] | ShiftMask, ButtonPressMask)) {
                        size_ok = 0;
                    }
                }
            }
        }
    }
    if (!size_ok) {
        fprintf(stderr, "%s+滚轮改大小不可用\n", size_key_label(app->size_mod));
    }
    if (app->size_mod != ShiftMask && !shift_ok) {
        fprintf(stderr, "Shift+滚轮改阈值不可用\n");
    }
}

static void ungrab_wheel(App *app) {
    if (!app->wheel_grabbed) {
        return;
    }
    XUngrabButton(app->dpy, Button4, AnyModifier, app->root);
    XUngrabButton(app->dpy, Button5, AnyModifier, app->root);
    app->wheel_grabbed = 0;
}

/* 主动抓住指针后，先放开移动，下一颗按键再停住，这样点击可以交回去，滚轮仍到得了这里。 */
static int arm_pointer(App *app) {
    int status = XGrabPointer(app->dpy, app->root, False, ButtonPressMask | ButtonReleaseMask, GrabModeSync, GrabModeAsync,
                              None, None, CurrentTime);
    if (status != GrabSuccess) {
        app->pointer_grabbed = 0;
        return 0;
    }
    app->pointer_grabbed = 1;
    XAllowEvents(app->dpy, SyncPointer, CurrentTime);
    return 1;
}

static void allow_button(App *app, Time time, int replay) {
    if (app->pointer_grabbed) {
        if (replay) {
            XAllowEvents(app->dpy, ReplayPointer, time);
            XSync(app->dpy, False);
            app->pointer_grabbed = 0;
            XUngrabPointer(app->dpy, CurrentTime);
            if (!arm_pointer(app)) {
                grab_wheel(app);
            }
            return;
        }
        XAllowEvents(app->dpy, SyncPointer, time);
        return;
    }
    if (app->wheel_grabbed) {
        XAllowEvents(app->dpy, AsyncPointer, time);
    }
}

static void grab_escape(App *app) {
    unsigned int extras[] = {LockMask, Mod2Mask, Mod5Mask, LockMask | Mod2Mask, LockMask | Mod5Mask, Mod2Mask | Mod5Mask,
                             LockMask | Mod2Mask | Mod5Mask};
    if (app->esc_grabbed) {
        return;
    }
    if (!app->esc_code) {
        app->esc_code = XKeysymToKeycode(app->dpy, XK_Escape);
    }
    if (!app->esc_code) {
        return;
    }
    g_x_error = 0;
    XGrabKey(app->dpy, (int)app->esc_code, 0, app->root, False, GrabModeAsync, GrabModeAsync);
    XSync(app->dpy, False);
    if (g_x_error == BadAccess) {
        XUngrabKey(app->dpy, (int)app->esc_code, AnyModifier, app->root);
        return;
    }
    app->esc_grabbed = 1;
    for (size_t i = 0; i < sizeof extras / sizeof extras[0]; i++) {
        g_x_error = 0;
        XGrabKey(app->dpy, (int)app->esc_code, extras[i], app->root, False, GrabModeAsync, GrabModeAsync);
        XSync(app->dpy, False);
    }
}

static void ungrab_escape(App *app) {
    if (!app->esc_grabbed || !app->esc_code) {
        return;
    }
    XUngrabKey(app->dpy, (int)app->esc_code, AnyModifier, app->root);
    app->esc_grabbed = 0;
}

static void hide_cursor(App *app) {
    if (app->cursor_hidden) {
        return;
    }
    XFixesHideCursor(app->dpy, app->root);
    app->cursor_hidden = 1;
}

static void show_cursor(App *app) {
    if (!app->cursor_hidden) {
        return;
    }
    XFixesShowCursor(app->dpy, app->root);
    app->cursor_hidden = 0;
}

static int query_pointer(App *app, int *x, int *y, unsigned int *mask) {
    Window root_ret;
    Window child;
    int wx, wy;
    unsigned int local = 0;
    int ok = XQueryPointer(app->dpy, app->root, &root_ret, &child, x, y, &wx, &wy, &local);
    if (mask) {
        *mask = local;
    }
    return ok;
}

static Rect monitor_at(App *app, int x, int y) {
    Rect fallback = {0, 0, DisplayWidth(app->dpy, app->screen), DisplayHeight(app->dpy, app->screen)};
    XRRScreenResources *resources;
    int event_base = 0;
    int error_base = 0;
    Rect found = fallback;
    int got = 0;
    if (!XRRQueryExtension(app->dpy, &event_base, &error_base)) {
        return fallback;
    }
    resources = XRRGetScreenResourcesCurrent(app->dpy, app->root);
    if (!resources) {
        resources = XRRGetScreenResources(app->dpy, app->root);
    }
    if (!resources) {
        return fallback;
    }
    for (int i = 0; i < resources->ncrtc; i++) {
        XRRCrtcInfo *info = XRRGetCrtcInfo(app->dpy, resources, resources->crtcs[i]);
        if (!info) {
            continue;
        }
        if (info->width > 0 && info->height > 0) {
            Rect mon = {info->x, info->y, (int)info->width, (int)info->height};
            if (!got) {
                found = mon;
                got = 1;
            }
            if (x >= mon.x && y >= mon.y && x < mon.x + mon.w && y < mon.y + mon.h) {
                found = mon;
                XRRFreeCrtcInfo(info);
                break;
            }
        }
        XRRFreeCrtcInfo(info);
    }
    XRRFreeScreenResources(resources);
    return got ? found : fallback;
}

static void update_max_d(App *app, int x, int y) {
    int rw = DisplayWidth(app->dpy, app->screen);
    int rh = DisplayHeight(app->dpy, app->screen);
    int inside = app->monitor_ready && rw == app->monitor_rw && rh == app->monitor_rh && x >= app->monitor.x &&
                 y >= app->monitor.y && x < app->monitor.x + app->monitor.w && y < app->monitor.y + app->monitor.h;
    Rect mon;
    int short_side;
    if (!inside) {
        app->monitor = monitor_at(app, x, y);
        app->monitor_ready = 1;
        app->monitor_rw = rw;
        app->monitor_rh = rh;
    }
    mon = app->monitor;
    short_side = mon.w < mon.h ? mon.w : mon.h;
    if (short_side < 1) {
        short_side = app->root_w < app->root_h ? app->root_w : app->root_h;
    }
    app->max_d = short_side > 0 ? short_side : DEFAULT_DIAMETER;
}

static int top_find(App *app, Window id) {
    int i;
    for (i = 0; i < app->ntop; i++) {
        if (app->tops[i].id == id) {
            return i;
        }
    }
    return -1;
}

static int read_top(Display *dpy, Window id, TopWin *out) {
    XWindowAttributes attr;
    g_x_error = 0;
    g_quiet_x = 1;
    if (!XGetWindowAttributes(dpy, id, &attr) || g_x_error || attr.class != InputOutput) {
        g_quiet_x = 0;
        g_x_error = 0;
        return 0;
    }
    g_quiet_x = 0;
    out->id = id;
    out->x = attr.x + attr.border_width;
    out->y = attr.y + attr.border_width;
    out->w = (int)attr.width;
    out->h = (int)attr.height;
    out->mapped = attr.map_state == IsViewable;
    out->depth = attr.depth;
    {
        unsigned long rmask = 0;
        unsigned long gmask = 0;
        unsigned long bmask = 0;
        unsigned long color_mask;
        if (attr.visual) {
            rmask = attr.visual->red_mask;
            gmask = attr.visual->green_mask;
            bmask = attr.visual->blue_mask;
        }
        out->rshift = mask_shift(rmask);
        out->gshift = mask_shift(gmask);
        out->bshift = mask_shift(bmask);
        color_mask = rmask | gmask | bmask;
        if (attr.depth < 32 || color_mask == 0 || color_mask == 0xffffffffUL) {
            out->ashift = -1;
        } else {
            out->ashift = mask_shift((~color_mask) & 0xffffffffUL);
        }
    }
    return out->w > 0 && out->h > 0;
}

static void refresh_tops(App *app) {
    Window root_ret, parent, *kids = NULL;
    unsigned count = 0;
    unsigned i;
    int used = 0;
    TopWin *neu;
    if (app->tops_ready && !app->tops_dirty) {
        return;
    }
    if (!XQueryTree(app->dpy, app->root, &root_ret, &parent, &kids, &count)) {
        app->tops_dirty = 0;
        app->tops_ready = 1;
        return;
    }
    neu = calloc(count > 0 ? count : 1, sizeof(TopWin));
    if (!neu) {
        if (kids) {
            XFree(kids);
        }
        return;
    }
    for (i = 0; i < count; i++) {
        int old;
        if (kids[i] == app->win) {
            continue;
        }
        old = top_find(app, kids[i]);
        if (old >= 0) {
            neu[used++] = app->tops[old];
        } else if (read_top(app->dpy, kids[i], &neu[used])) {
            used++;
        }
    }
    if (kids) {
        XFree(kids);
    }
    free(app->tops);
    app->tops = neu;
    app->ntop = used;
    app->tops_dirty = 0;
    app->tops_ready = 1;
}

static void on_structure(App *app, XEvent *event) {
    if (event->type == ConfigureNotify) {
        Window id = event->xconfigure.window;
        int known;
        if (id == app->win) {
            return;
        }
        known = top_find(app, id);
        if (known >= 0) {
            app->tops[known].x = event->xconfigure.x + event->xconfigure.border_width;
            app->tops[known].y = event->xconfigure.y + event->xconfigure.border_width;
            app->tops[known].w = event->xconfigure.width;
            app->tops[known].h = event->xconfigure.height;
        }
        app->tops_dirty = 1;
    } else if (event->type == MapNotify && event->xmap.window != app->win) {
        int known = top_find(app, event->xmap.window);
        if (known >= 0) {
            app->tops[known].mapped = 1;
        }
    } else if (event->type == UnmapNotify && event->xunmap.window != app->win) {
        int known = top_find(app, event->xunmap.window);
        if (known >= 0) {
            app->tops[known].mapped = 0;
        }
    }
    app->tops_dirty = 1;
    /* 合成器只刷新这层窗口提交过的区域。窗口大变化时若仍只贴圆的方框，圆外会停在旧画面，要等指针移过才露出来。 */
    if (app->mapped) {
        app->full_put = 1;
    }
}

static int image_is_native32(XImage *image) {
    unsigned int probe = 1;
    int host_lsb = *((unsigned char *)&probe) == 1;
    int image_lsb = image->byte_order == LSBFirst;
    return image->bits_per_pixel == 32 && host_lsb == image_lsb && image->bytes_per_line >= image->width * 4;
}

static int pixel_of(XImage *image, int x, int y, int rshift, int gshift, int bshift, int ashift, int *r, int *g, int *b, int *a) {
    unsigned long raw;
    if (x < 0 || y < 0 || x >= image->width || y >= image->height) {
        return 0;
    }
    if (image_is_native32(image)) {
        uint32_t value;
        memcpy(&value, (uint8_t *)image->data + (size_t)y * (size_t)image->bytes_per_line + (size_t)x * 4, 4);
        raw = value;
    } else {
        raw = XGetPixel(image, x, y);
    }
    *r = (int)((raw >> rshift) & 255);
    *g = (int)((raw >> gshift) & 255);
    *b = (int)((raw >> bshift) & 255);
    if (ashift < 0) {
        *a = 255;
    } else {
        *a = (int)((raw >> ashift) & 255);
    }
    return 1;
}

static int on_screen_filled(const uint8_t *got, int side, int sx, int sy, int root_w, int root_h) {
    int y, x;
    for (y = 0; y < side; y++) {
        for (x = 0; x < side; x++) {
            int cx = sx + x;
            int cy = sy + y;
            if (cx < 0 || cy < 0 || cx >= root_w || cy >= root_h) {
                continue;
            }
            if (!got[(size_t)y * (size_t)side + (size_t)x]) {
                return 0;
            }
        }
    }
    return 1;
}

static void fill_holes(uint8_t *dst, const uint8_t *got, int side, int sx, int sy, int root_w, int root_h) {
    int y, x;
    for (y = 0; y < side; y++) {
        for (x = 0; x < side; x++) {
            size_t at = (size_t)y * (size_t)side + (size_t)x;
            int cx, cy, ox, oy;
            if (got[at]) {
                continue;
            }
            cx = sx + x;
            cy = sy + y;
            if (cx < 0) {
                cx = 0;
            }
            if (cy < 0) {
                cy = 0;
            }
            if (root_w > 0 && cx >= root_w) {
                cx = root_w - 1;
            }
            if (root_h > 0 && cy >= root_h) {
                cy = root_h - 1;
            }
            ox = cx - sx;
            oy = cy - sy;
            if (ox >= 0 && oy >= 0 && ox < side && oy < side && got[(size_t)oy * (size_t)side + (size_t)ox]) {
                memcpy(dst + at * 3, dst + ((size_t)oy * (size_t)side + (size_t)ox) * 3, 3);
            }
        }
    }
}

static int capture_source(App *app, int cx, int cy, int side, uint8_t *dst) {
    int sx, sy, i;
    uint8_t *got;
    if (side < 1 || !dst) {
        return 0;
    }
    app->root_w = DisplayWidth(app->dpy, app->screen);
    app->root_h = DisplayHeight(app->dpy, app->screen);
    refresh_tops(app);
    sx = cx - side / 2;
    sy = cy - side / 2;
    got = calloc((size_t)side * (size_t)side, 1);
    if (!got) {
        return 0;
    }
    memset(dst, 0, (size_t)side * (size_t)side * 3);
    g_quiet_x = 1;
    for (i = app->ntop - 1; i >= 0; i--) {
        TopWin *top = &app->tops[i];
        int x1, y1, x2, y2;
        Pixmap pix;
        XImage *image;
        int row, col;
        if (!top->mapped || top->w < 1 || top->h < 1) {
            continue;
        }
        x1 = sx > top->x ? sx : top->x;
        y1 = sy > top->y ? sy : top->y;
        x2 = sx + side < top->x + top->w ? sx + side : top->x + top->w;
        y2 = sy + side < top->y + top->h ? sy + side : top->y + top->h;
        if (x2 <= x1 || y2 <= y1) {
            continue;
        }
        g_x_error = 0;
        pix = XCompositeNameWindowPixmap(app->dpy, top->id);
        if (g_x_error || !pix) {
            g_x_error = 0;
            continue;
        }
        image = XGetImage(app->dpy, pix, x1 - top->x, y1 - top->y, (unsigned)(x2 - x1), (unsigned)(y2 - y1), AllPlanes, ZPixmap);
        XFreePixmap(app->dpy, pix);
        if (g_x_error || !image) {
            g_x_error = 0;
            if (image) {
                XDestroyImage(image);
            }
            continue;
        }
        for (row = 0; row < image->height; row++) {
            for (col = 0; col < image->width; col++) {
                int dx = x1 - sx + col;
                int dy = y1 - sy + row;
                int r, g, b, a;
                size_t at;
                if (dx < 0 || dy < 0 || dx >= side || dy >= side) {
                    continue;
                }
                at = (size_t)dy * (size_t)side + (size_t)dx;
                if (got[at]) {
                    continue;
                }
                if (!pixel_of(image, col, row, top->rshift, top->gshift, top->bshift, top->ashift, &r, &g, &b, &a) || a == 0) {
                    continue;
                }
                dst[at * 3] = (uint8_t)r;
                dst[at * 3 + 1] = (uint8_t)g;
                dst[at * 3 + 2] = (uint8_t)b;
                got[at] = 1;
            }
        }
        XDestroyImage(image);
        if (on_screen_filled(got, side, sx, sy, app->root_w, app->root_h)) {
            break;
        }
    }
    g_quiet_x = 0;
    g_x_error = 0;
    fill_holes(dst, got, side, sx, sy, app->root_w, app->root_h);
    free(got);
    return 1;
}

static void free_frame(App *app) {
    if (app->frame && app->dpy && app->frame_acked < app->frame_epoch) {
        XSync(app->dpy, False);
        app->frame_acked = app->frame_epoch;
    }
    if (app->frame) {
        XShmDetach(app->dpy, &app->frame_shm);
        if (app->frame_shm.shmaddr && app->frame_shm.shmaddr != (char *)-1) {
            shmdt(app->frame_shm.shmaddr);
        }
        app->frame->data = NULL;
        XDestroyImage(app->frame);
        app->frame = NULL;
    }
    memset(&app->frame_shm, 0, sizeof app->frame_shm);
    app->frame_w = 0;
    app->frame_h = 0;
}

static void release_lens_memory(App *app) {
    free_frame(app);
    free(app->src_buf);
    free(app->dst_buf);
    free(app->tops);
    app->src_buf = NULL;
    app->dst_buf = NULL;
    app->src_cap = 0;
    app->dst_cap = 0;
    app->tops = NULL;
    app->ntop = 0;
    app->tops_ready = 0;
    app->tops_dirty = 1;
    malloc_trim(0);
}

static int ensure_frame(App *app, int width, int height) {
    size_t bytes;
    if (width < 1 || height < 1) {
        return 0;
    }
    if (app->frame && app->frame_w == width && app->frame_h == height) {
        return 1;
    }
    free_frame(app);
    app->frame = XShmCreateImage(app->dpy, app->visual, (unsigned)app->depth, ZPixmap, NULL, &app->frame_shm, (unsigned)width,
                                 (unsigned)height);
    if (!app->frame) {
        return 0;
    }
    bytes = (size_t)app->frame->bytes_per_line * (size_t)height;
    app->frame_shm.shmid = shmget(IPC_PRIVATE, bytes, IPC_CREAT | 0600);
    if (app->frame_shm.shmid < 0) {
        app->frame->data = NULL;
        XDestroyImage(app->frame);
        app->frame = NULL;
        return 0;
    }
    app->frame_shm.shmaddr = app->frame->data = shmat(app->frame_shm.shmid, NULL, 0);
    app->frame_shm.readOnly = False;
    if (app->frame_shm.shmaddr == (char *)-1) {
        shmctl(app->frame_shm.shmid, IPC_RMID, NULL);
        app->frame->data = NULL;
        XDestroyImage(app->frame);
        app->frame = NULL;
        return 0;
    }
    g_x_error = 0;
    XShmAttach(app->dpy, &app->frame_shm);
    XSync(app->dpy, False);
    shmctl(app->frame_shm.shmid, IPC_RMID, NULL);
    if (g_x_error) {
        free_frame(app);
        return 0;
    }
    memset(app->frame->data, 0, bytes);
    app->frame_w = width;
    app->frame_h = height;
    app->full_put = 1;
    app->have_rect = 0;
    return 1;
}

static int glyph_index(char ch) {
    if (ch >= '0' && ch <= '9') {
        return ch - '0';
    }
    if (ch == '.') {
        return 10;
    }
    if (ch == 'x' || ch == 'X') {
        return 11;
    }
    return -1;
}

static void blend_rgb(uint8_t *rgb, int diameter, int x, int y, int r, int g, int b, int alpha) {
    uint8_t *pixel;
    if (alpha <= 0 || x < 0 || y < 0 || x >= diameter || y >= diameter) {
        return;
    }
    if (alpha > 255) {
        alpha = 255;
    }
    pixel = rgb + ((size_t)y * (size_t)diameter + (size_t)x) * 3;
    pixel[0] = (uint8_t)((pixel[0] * (255 - alpha) + r * alpha) / 255);
    pixel[1] = (uint8_t)((pixel[1] * (255 - alpha) + g * alpha) / 255);
    pixel[2] = (uint8_t)((pixel[2] * (255 - alpha) + b * alpha) / 255);
}

static void draw_label(uint8_t *rgb, int diameter, const char *text, int y0) {
    int length = (int)strlen(text);
    int scale = 2;
    int glyph_w = 5;
    int gap = 1;
    int text_w;
    int x0;
    int n;
    if (length <= 0 || diameter < 48) {
        return;
    }
    if (y0 < 0) {
        y0 = diameter / 6;
    }
    text_w = length * (glyph_w + gap) * scale - gap * scale;
    x0 = (diameter - text_w) / 2;
    for (n = 0; n < length; n++) {
        int index = glyph_index(text[n]);
        int row, col;
        if (index < 0) {
            continue;
        }
        for (row = 0; row < 7; row++) {
            for (col = 0; col < 5; col++) {
                int sx, sy;
                if (((k_glyph[index][row] >> (4 - col)) & 1) == 0) {
                    continue;
                }
                for (sy = 0; sy < scale; sy++) {
                    for (sx = 0; sx < scale; sx++) {
                        int px = x0 + (n * (glyph_w + gap) + col) * scale + sx;
                        int py = y0 + row * scale + sy;
                        blend_rgb(rgb, diameter, px + 1, py + 1, 0, 0, 0, 70);
                        blend_rgb(rgb, diameter, px, py, 245, 245, 245, 150);
                    }
                }
            }
        }
    }
}

static void draw_hint(uint8_t *rgb, int diameter, App *app) {
    int x0 = app->hint_w > 0 ? (diameter - app->hint_w) / 2 : diameter / 12;
    int y0 = diameter / 10;
    int x, y;
    if (y0 < 8) {
        y0 = 8;
    }
    app->hint_y = y0;
    if (!app->hint_alpha || app->hint_w < 1 || app->hint_h < 1) {
        return;
    }
    for (y = 0; y < app->hint_h; y++) {
        for (x = 0; x < app->hint_w; x++) {
            int alpha = app->hint_alpha[(size_t)y * (size_t)app->hint_w + (size_t)x];
            if (alpha <= 0) {
                continue;
            }
            blend_rgb(rgb, diameter, x0 + x, y0 + y, 255, 255, 255, alpha * 160 / 255);
        }
    }
}

static void prepare_hint(App *app) {
    char text[64];
    const char *fonts[] = {"Noto Sans CJK SC:pixelsize=15", "Source Han Sans CN:pixelsize=15", "WenQuanYi Micro Hei:pixelsize=15",
                           "sans-serif:pixelsize=15:lang=zh-cn", "sans-serif:pixelsize=15:lang=zh"};
    snprintf(text, sizeof text, "滚轮倍率 · %s滚轮大小", size_key_label(app->size_mod));
    XftFont *font = NULL;
    XGlyphInfo ext;
    Pixmap pix = None;
    XftDraw *draw = NULL;
    XftColor color;
    XRenderColor render_color;
    XImage *image = NULL;
    GC gc = NULL;
    int i;
    int w;
    int h;
    int x;
    int y;
    int color_ok = 0;
    memset(&color, 0, sizeof color);
    memset(&ext, 0, sizeof ext);
    for (i = 0; i < (int)(sizeof fonts / sizeof fonts[0]); i++) {
        font = XftFontOpenName(app->dpy, app->screen, fonts[i]);
        if (font) {
            break;
        }
    }
    if (!font) {
        return;
    }
    XftTextExtentsUtf8(app->dpy, font, (const FcChar8 *)text, (int)strlen(text), &ext);
    {
        int origin_x = -ext.x;
        int pad_x = origin_x < 0 ? -origin_x : 0;
        origin_x += pad_x;
        w = ext.width + pad_x;
        h = ext.height;
        if (ext.y < 0) {
            if (-ext.y + 1 > h) {
                h = -ext.y + 1;
            }
        } else if (ext.y + 1 > h) {
            h = ext.y + 1;
        }
        if (w < 1 || h < 1 || w > 1600 || h > 128) {
            XftFontClose(app->dpy, font);
            return;
        }
        /* 基线统一放到像素图内部。有的字体 y 为正，直接用 -y 会画到图外。 */
        ext.x = (short)(-origin_x);
        ext.y = ext.y < 0 ? ext.y : (short)(-ext.y);
    }
    if (w < 1 || h < 1 || w > 1600 || h > 128) {
        XftFontClose(app->dpy, font);
        return;
    }
    g_quiet_x = 1;
    g_x_error = 0;
    pix = XCreatePixmap(app->dpy, app->win, (unsigned)w, (unsigned)h, (unsigned)app->depth);
    if (!g_x_error && pix) {
        XGCValues values;
        values.foreground = 0;
        gc = XCreateGC(app->dpy, pix, GCForeground, &values);
        if (gc) {
            XFillRectangle(app->dpy, pix, gc, 0, 0, (unsigned)w, (unsigned)h);
        }
        draw = XftDrawCreate(app->dpy, pix, app->visual, app->cmap);
    }
    render_color.red = 65535;
    render_color.green = 65535;
    render_color.blue = 65535;
    render_color.alpha = 65535;
    if (draw && XftColorAllocValue(app->dpy, app->visual, app->cmap, &render_color, &color)) {
        color_ok = 1;
        XftDrawStringUtf8(draw, &color, font, -ext.x, -ext.y, (const FcChar8 *)text, (int)strlen(text));
        image = XGetImage(app->dpy, pix, 0, 0, (unsigned)w, (unsigned)h, AllPlanes, ZPixmap);
    }
    g_quiet_x = 0;
    if (!g_x_error && image) {
        uint8_t *alpha = calloc((size_t)w * (size_t)h, 1);
        if (alpha) {
            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    int r, g, b, a;
                    if (!pixel_of(image, x, y, app->rshift, app->gshift, app->bshift, app->ashift, &r, &g, &b, &a)) {
                        continue;
                    }
                    if (a == 0 && (r || g || b)) {
                        a = (r + g + b) / 3;
                    }
                    alpha[(size_t)y * (size_t)w + (size_t)x] = (uint8_t)a;
                }
            }
            free(app->hint_alpha);
            app->hint_alpha = alpha;
            app->hint_w = w;
            app->hint_h = h;
        }
    }
    g_x_error = 0;
    if (image) {
        XDestroyImage(image);
    }
    if (color_ok) {
        XftColorFree(app->dpy, app->visual, app->cmap, &color);
    }
    if (draw) {
        XftDrawDestroy(draw);
    }
    if (gc) {
        XFreeGC(app->dpy, gc);
    }
    if (pix) {
        XFreePixmap(app->dpy, pix);
    }
    XftFontClose(app->dpy, font);
}

static void reload_size_key(App *app) {
    unsigned int mod = 0;
    if (!read_size_key_file(app, &mod) || mod == app->size_mod) {
        return;
    }
    app->size_mod = mod;
    snprintf(app->size_key, sizeof app->size_key, "%s", size_key_token(mod));
    if (app->wheel_grabbed && !app->pointer_grabbed) {
        ungrab_wheel(app);
        grab_wheel(app);
    }
    if (app->dpy && app->win) {
        prepare_hint(app);
    }
}

static uint32_t pack_pixel(App *app, int r, int g, int b, int a) {
    if (r < 0) {
        r = 0;
    }
    if (g < 0) {
        g = 0;
    }
    if (b < 0) {
        b = 0;
    }
    if (a < 0) {
        a = 0;
    }
    if (r > 255) {
        r = 255;
    }
    if (g > 255) {
        g = 255;
    }
    if (b > 255) {
        b = 255;
    }
    if (a > 255) {
        a = 255;
    }
    r = r * a / 255;
    g = g * a / 255;
    b = b * a / 255;
    return ((uint32_t)r << app->rshift) | ((uint32_t)g << app->gshift) | ((uint32_t)b << app->bshift) |
           ((uint32_t)a << app->ashift);
}

static uint8_t *need_buf(uint8_t **buf, size_t *cap, size_t bytes) {
    uint8_t *next;
    if (*buf && *cap >= bytes) {
        return *buf;
    }
    next = realloc(*buf, bytes);
    if (!next) {
        return NULL;
    }
    *buf = next;
    *cap = bytes;
    return next;
}

static void ack_frame(App *app) {
    if (app->frame_acked < app->frame_epoch) {
        app->frame_acked++;
    }
}

static void wait_frame(App *app) {
    while (app->frame_acked < app->frame_epoch) {
        if (XPending(app->dpy)) {
            XEvent event;
            XPeekEvent(app->dpy, &event);
            if (event.type == app->shm_event) {
                XNextEvent(app->dpy, &event);
                ack_frame(app);
                continue;
            }
        }
        XSync(app->dpy, False);
        app->frame_acked = app->frame_epoch;
        while (XPending(app->dpy)) {
            XEvent event;
            XPeekEvent(app->dpy, &event);
            if (event.type != app->shm_event) {
                break;
            }
            XNextEvent(app->dpy, &event);
        }
        break;
    }
}

static void present_frame(App *app, int x, int y, int w, int h) {
    if (w < 1 || h < 1) {
        return;
    }
    XShmPutImage(app->dpy, app->win, app->gc, app->frame, x, y, x, y, (unsigned)w, (unsigned)h, True);
    app->frame_epoch++;
    XFlush(app->dpy);
}

static Rect clip_rect(Rect box, int limit_w, int limit_h) {
    int x2 = box.x + box.w;
    int y2 = box.y + box.h;
    if (box.x < 0) {
        box.x = 0;
    }
    if (box.y < 0) {
        box.y = 0;
    }
    if (x2 > limit_w) {
        x2 = limit_w;
    }
    if (y2 > limit_h) {
        y2 = limit_h;
    }
    box.w = x2 - box.x;
    box.h = y2 - box.y;
    if (box.w < 0) {
        box.w = 0;
    }
    if (box.h < 0) {
        box.h = 0;
    }
    return box;
}

static Rect union_rect(Rect a, Rect b) {
    int x1, y1, x2, y2;
    Rect out;
    if (a.w < 1 || a.h < 1) {
        return b;
    }
    if (b.w < 1 || b.h < 1) {
        return a;
    }
    x1 = a.x < b.x ? a.x : b.x;
    y1 = a.y < b.y ? a.y : b.y;
    x2 = a.x + a.w > b.x + b.w ? a.x + a.w : b.x + b.w;
    y2 = a.y + a.h > b.y + b.h ? a.y + a.h : b.y + b.h;
    out.x = x1;
    out.y = y1;
    out.w = x2 - x1;
    out.h = y2 - y1;
    return out;
}

static void clear_box(App *app, Rect box) {
    int y;
    if (!app->frame) {
        return;
    }
    box = clip_rect(box, app->frame_w, app->frame_h);
    if (box.w < 1 || box.h < 1) {
        return;
    }
    for (y = 0; y < box.h; y++) {
        uint8_t *row = (uint8_t *)app->frame->data + (size_t)(box.y + y) * (size_t)app->frame->bytes_per_line + (size_t)box.x * 4;
        memset(row, 0, (size_t)box.w * 4);
    }
}

static int ensure_overlay(App *app) {
    int width = DisplayWidth(app->dpy, app->screen);
    int height = DisplayHeight(app->dpy, app->screen);
    if (width < 1 || height < 1) {
        return 0;
    }
    if (app->frame && app->frame_w == width && app->frame_h == height) {
        return 1;
    }
    /* 桌面尺寸变了才改窗口。平时不挪，避免旧画面先跟着窗口走。 */
    if (app->win && (app->root_w != width || app->root_h != height)) {
        XMoveResizeWindow(app->dpy, app->win, 0, 0, (unsigned)width, (unsigned)height);
    }
    app->root_w = width;
    app->root_h = height;
    return ensure_frame(app, width, height);
}

static void note_save(App *app) {
    app->save_at = mono_us() + SAVE_DELAY_US;
}

/* 只在滚轮改倍率时调用。把文件里的最新阈值读进内存，镜头重显示时不读。 */
static int reload_filter_zoom(App *app) {
    double value = 0;
    if (!read_filter_zoom_file(app, &value)) {
        return 0;
    }
    if (zoom_hundredths(value) == zoom_hundredths(app->filter_zoom)) {
        return 0;
    }
    app->filter_zoom = value;
    return 1;
}

static void flush_save(App *app, int force) {
    if (!app->save_at) {
        return;
    }
    if (!force && mono_us() < app->save_at) {
        return;
    }
    save_config(app);
    app->save_at = 0;
}

static void paint(App *app) {
    int diameter = app->shown_d;
    int side = source_side(diameter, app->zoom);
    uint8_t *src;
    uint8_t *dst;
    int x, y;
    int origin_x, origin_y;
    long long now;
    char label[16];
    Rect placed;
    Rect damage;
    if (diameter < 1 || !app->win) {
        return;
    }
    if (!ensure_overlay(app)) {
        fprintf(stderr, "无法准备放大画面\n");
        return;
    }
    src = need_buf(&app->src_buf, &app->src_cap, (size_t)side * (size_t)side * 3);
    dst = need_buf(&app->dst_buf, &app->dst_cap, (size_t)diameter * (size_t)diameter * 3);
    if (!src || !dst) {
        fprintf(stderr, "内存不足，无法放大\n");
        return;
    }
    if (!capture_source(app, app->center_x, app->center_y, side, src)) {
        return;
    }
    if (!magnify_at(src, side, side, dst, diameter, diameter, filter_active(app->zoom, app->filter_zoom))) {
        return;
    }
    now = mono_us();
    {
        int show_hint = app->size_down || now < app->hint_until;
        int show_diameter = app->size_down || (!app->shift_down && now < app->label_until && app->label_mode == 2);
        int show_filter = !app->size_down && (app->shift_down || (now < app->label_until && app->label_mode == 3));
        int show_zoom = !app->size_down && !app->shift_down && now < app->label_until && app->label_mode == 1;
        int number_y;
        if (show_hint) {
            draw_hint(dst, diameter, app);
        }
        number_y = app->hint_h > 0 ? app->hint_y + app->hint_h + 4 : -1;
        if (show_diameter) {
            char shown[20];
            snprintf(shown, sizeof shown, "%d", app->shown_d);
            draw_label(dst, diameter, shown, show_hint ? number_y : -1);
            app->label_on_frame = 1;
        } else if (show_filter) {
            char shown[20];
            format_filter_label(shown, sizeof shown, app->filter_zoom);
            draw_label(dst, diameter, shown, show_hint ? number_y : -1);
            app->label_on_frame = 1;
        } else if (show_zoom) {
            char shown[20];
            format_zoom_number(label, sizeof label, app->zoom);
            snprintf(shown, sizeof shown, "%sx", label);
            draw_label(dst, diameter, shown, show_hint ? number_y : -1);
            app->label_on_frame = 1;
        } else {
            app->label_on_frame = 0;
        }
    }
    wait_frame(app);
    origin_x = app->center_x - diameter / 2;
    origin_y = app->center_y - diameter / 2;
    for (y = 0; y < diameter; y++) {
        int fy = origin_y + y;
        float center = ((float)diameter - 1.0f) / 2.0f;
        float radius = (float)diameter / 2.0f;
        if (fy < 0 || fy >= app->frame_h) {
            continue;
        }
        for (x = 0; x < diameter; x++) {
            int fx = origin_x + x;
            uint8_t *sample = dst + ((size_t)y * (size_t)diameter + (size_t)x) * 3;
            uint8_t *row;
            float dx = (float)x - center;
            float dy = (float)y - center;
            float dist = sqrtf(dx * dx + dy * dy);
            float rim = (dist - (radius - 3.5f)) / 2.5f;
            int r = sample[0];
            int g = sample[1];
            int b = sample[2];
            int coverage = circle_coverage(x, y, diameter);
            uint32_t pixel;
            if (fx < 0 || fx >= app->frame_w) {
                continue;
            }
            if (dist <= 1.7f) {
                r = 16;
                g = 16;
                b = 16;
            } else if (dist <= 3.1f) {
                r = 245;
                g = 245;
                b = 245;
            }
            if (rim < 0.f) {
                rim = 0.f;
            }
            if (rim > 1.f) {
                rim = 1.f;
            }
            r = (int)((1.f - rim) * (float)r + rim * 176.f + 0.5f);
            g = (int)((1.f - rim) * (float)g + rim * 176.f + 0.5f);
            b = (int)((1.f - rim) * (float)b + rim * 176.f + 0.5f);
            pixel = pack_pixel(app, r, g, b, coverage);
            row = (uint8_t *)app->frame->data + (size_t)fy * (size_t)app->frame->bytes_per_line;
            memcpy(row + (size_t)fx * 4, &pixel, 4);
        }
    }
    placed.x = origin_x;
    placed.y = origin_y;
    placed.w = diameter;
    placed.h = diameter;
    placed = clip_rect(placed, app->frame_w, app->frame_h);
    /* 新圆已经画上。只擦旧方框里、新方框外的像素，圆内不会整块先涂空。 */
    if (app->have_rect) {
        Rect extra[4];
        int extra_count = outside_rects(app->rect, placed, extra);
        int extra_i;
        for (extra_i = 0; extra_i < extra_count; extra_i++) {
            clear_box(app, extra[extra_i]);
        }
    }
    if (app->full_put) {
        damage.x = 0;
        damage.y = 0;
        damage.w = app->frame_w;
        damage.h = app->frame_h;
    } else if (app->have_rect) {
        damage = clip_rect(union_rect(app->rect, placed), app->frame_w, app->frame_h);
    } else {
        damage = placed;
    }
    present_frame(app, damage.x, damage.y, damage.w, damage.h);
    app->rect = placed;
    app->have_rect = placed.w > 0 && placed.h > 0;
    app->full_put = 0;
    app->need_paint = 0;
}

static void show_lens(App *app) {
    int px = 0;
    int py = 0;
    long long now;
    if (!query_pointer(app, &px, &py, NULL)) {
        px = DisplayWidth(app->dpy, app->screen) / 2;
        py = DisplayHeight(app->dpy, app->screen) / 2;
    }
    update_max_d(app, px, py);
    app->shown_d = clamp_diameter(app->pref_d, app->max_d);
    app->center_x = px;
    app->center_y = py;
    now = mono_us();
    app->hint_until = now + HINT_USEC;
    if (app->toggle_after < now + TOGGLE_GUARD_US) {
        app->toggle_after = now + TOGGLE_GUARD_US;
    }
    app->mapped = 1;
    app->ever_shown = 1;
    app->need_paint = 1;
    paint(app);
    XSync(app->dpy, False);
    XMapRaised(app->dpy, app->win);
    hide_cursor(app);
    grab_escape(app);
    if (!arm_pointer(app)) {
        grab_wheel(app);
    }
    XRaiseWindow(app->dpy, app->win);
    XFlush(app->dpy);
}

static void hide_lens(App *app) {
    XUngrabPointer(app->dpy, CurrentTime);
    app->pointer_grabbed = 0;
    show_cursor(app);
    ungrab_escape(app);
    ungrab_wheel(app);
    if (app->mapped) {
        XUnmapWindow(app->dpy, app->win);
        app->mapped = 0;
        XSync(app->dpy, False);
    }
    release_lens_memory(app);
}

static void toggle_lens(App *app) {
    if (app->mapped) {
        hide_lens(app);
    } else {
        show_lens(app);
    }
}

static int wheel_action(App *app, unsigned int state) {
    int x = 0;
    int y = 0;
    unsigned int live = 0;
    unsigned int mods = state;
    reload_size_key(app);
    if (query_pointer(app, &x, &y, &live)) {
        mods |= live;
    }
    if (app->size_mod && (mods & app->size_mod)) {
        return 1;
    }
    if (app->size_mod != ShiftMask && (mods & ShiftMask)) {
        return 2;
    }
    if (mods & (ControlMask | Mod1Mask | ShiftMask | Mod4Mask)) {
        return 3;
    }
    return 0;
}

static void on_wheel(App *app, XButtonEvent *event, int action) {
    long long now;
    int fast;
    int direction;
    if (!app->mapped) {
        return;
    }
    now = mono_us();
    fast = wheel_is_fast(now, app->last_wheel_us);
    app->last_wheel_us = now;
    direction = event->button == Button4 ? 1 : -1;
    if (action == 1) {
        int next;
        update_max_d(app, app->center_x, app->center_y);
        next = step_diameter(app->pref_d, direction, fast, app->max_d);
        if (next == app->pref_d && next == app->shown_d) {
            return;
        }
        app->pref_d = next;
        app->shown_d = next;
        app->label_mode = 2;
        app->label_until = now + LABEL_USEC;
        note_save(app);
        paint(app);
        return;
    }
    if (action == 2) {
        double next = step_filter_zoom(app->filter_zoom, direction, fast);
        if (zoom_hundredths(next) == zoom_hundredths(app->filter_zoom)) {
            return;
        }
        app->filter_zoom = next;
        app->filter_from_wheel = 1;
        app->label_mode = 3;
        app->label_until = now + LABEL_USEC;
        note_save(app);
        paint(app);
        return;
    }
    {
        double next;
        int filter_changed = 0;
        if (!app->filter_from_wheel) {
            filter_changed = reload_filter_zoom(app);
        }
        next = step_zoom(app->zoom, direction, fast);
        if (zoom_hundredths(next) == zoom_hundredths(app->zoom) && !filter_changed) {
            return;
        }
        if (zoom_hundredths(next) != zoom_hundredths(app->zoom)) {
            app->zoom = next;
            app->label_mode = 1;
            app->label_until = now + LABEL_USEC;
            note_save(app);
        } else {
            app->label_mode = 3;
            app->label_until = now + LABEL_USEC;
        }
        paint(app);
    }
}

static int escape_match(App *app, XKeyEvent *event) {
    unsigned int care = ControlMask | Mod1Mask | ShiftMask | Mod4Mask;
    return app->esc_code && event->keycode == app->esc_code && (event->state & care) == 0;
}

static void handle_event(App *app, XEvent *event) {
    if (event->type == app->shm_event) {
        ack_frame(app);
        return;
    }
    if (event->type == ConfigureNotify || event->type == MapNotify || event->type == UnmapNotify || event->type == CreateNotify ||
        event->type == DestroyNotify || event->type == ReparentNotify || event->type == CirculateNotify || event->type == GravityNotify) {
        on_structure(app, event);
        return;
    }
    if (event->type == KeyPress && app->mapped && escape_match(app, &event->xkey)) {
        hide_lens(app);
        return;
    }
    if (event->type == ButtonPress || event->type == ButtonRelease) {
        XButtonEvent *button = &event->xbutton;
        int wheel = button->button == Button4 || button->button == Button5;
        int action = wheel ? wheel_action(app, button->state) : 3;
        int replay = !wheel || action == 3;
        allow_button(app, button->time, replay);
        if (event->type == ButtonPress && wheel && !replay) {
            on_wheel(app, button, action);
        }
        return;
    }
    if (!app->mapped) {
        return;
    }
    if (event->type == Expose && event->xexpose.count == 0) {
        paint(app);
    }
}

static void tick(App *app) {
    int px = 0;
    int py = 0;
    unsigned int mask = 0;
    if (!app->mapped) {
        return;
    }
    reload_size_key(app);
    if (!query_pointer(app, &px, &py, &mask)) {
        return;
    }
    app->size_down = app->size_mod && (mask & app->size_mod) != 0;
    app->shift_down = app->size_mod != ShiftMask && (mask & ShiftMask) != 0;
    update_max_d(app, px, py);
    app->shown_d = clamp_diameter(app->pref_d, app->max_d);
    app->center_x = px;
    app->center_y = py;
    paint(app);
}

static int create_window(App *app) {
    XVisualInfo query;
    XVisualInfo *list;
    int count = 0;
    int chosen = -1;
    XSetWindowAttributes attrs;
    XGCValues gcvalues;
    XWMHints hints;
    Region empty;
    Atom state, above, skip;
    Atom atoms[2];
    int i;
    memset(&query, 0, sizeof query);
    query.screen = app->screen;
    query.depth = 32;
    query.class = TrueColor;
    list = XGetVisualInfo(app->dpy, VisualScreenMask | VisualDepthMask | VisualClassMask, &query, &count);
    for (i = 0; i < count; i++) {
        unsigned long rgb = list[i].red_mask | list[i].green_mask | list[i].blue_mask;
        if (list[i].red_mask && list[i].green_mask && list[i].blue_mask && rgb != 0xffffffffUL) {
            chosen = i;
            break;
        }
    }
    if (chosen < 0) {
        if (list) {
            XFree(list);
        }
        fprintf(stderr, "需要支持透明的 32 位色显示\n");
        return 0;
    }
    app->visual = list[chosen].visual;
    app->depth = (int)list[chosen].depth;
    app->rshift = mask_shift(list[chosen].red_mask);
    app->gshift = mask_shift(list[chosen].green_mask);
    app->bshift = mask_shift(list[chosen].blue_mask);
    app->ashift = mask_shift((~(list[chosen].red_mask | list[chosen].green_mask | list[chosen].blue_mask)) & 0xffffffffUL);
    XFree(list);
    app->cmap = XCreateColormap(app->dpy, app->root, app->visual, AllocNone);
    memset(&attrs, 0, sizeof attrs);
    attrs.override_redirect = True;
    attrs.colormap = app->cmap;
    attrs.background_pixmap = None;
    attrs.border_pixel = 0;
    attrs.event_mask = ExposureMask;
    app->root_w = DisplayWidth(app->dpy, app->screen);
    app->root_h = DisplayHeight(app->dpy, app->screen);
    if (app->root_w < 1) {
        app->root_w = 1;
    }
    if (app->root_h < 1) {
        app->root_h = 1;
    }
    app->win = XCreateWindow(app->dpy, app->root, 0, 0, (unsigned)app->root_w, (unsigned)app->root_h, 0, app->depth, InputOutput,
                             app->visual, CWOverrideRedirect | CWColormap | CWBackPixmap | CWBorderPixel | CWEventMask, &attrs);
    XStoreName(app->dpy, app->win, "magnifier");
    {
        XClassHint hint;
        hint.res_name = "magnifier";
        hint.res_class = "Magnifier";
        XSetClassHint(app->dpy, app->win, &hint);
    }
    memset(&hints, 0, sizeof hints);
    hints.flags = InputHint;
    hints.input = False;
    XSetWMHints(app->dpy, app->win, &hints);
    state = XInternAtom(app->dpy, "_NET_WM_STATE", False);
    above = XInternAtom(app->dpy, "_NET_WM_STATE_ABOVE", False);
    skip = XInternAtom(app->dpy, "_NET_WM_STATE_SKIP_TASKBAR", False);
    atoms[0] = above;
    atoms[1] = skip;
    XChangeProperty(app->dpy, app->win, state, XA_ATOM, 32, PropModeReplace, (unsigned char *)atoms, 2);
    empty = XCreateRegion();
    XShapeCombineRegion(app->dpy, app->win, ShapeInput, 0, 0, empty, ShapeSet);
    XDestroyRegion(empty);
    gcvalues.graphics_exposures = False;
    app->gc = XCreateGC(app->dpy, app->win, GCGraphicsExposures, &gcvalues);
    app->shown_d = app->pref_d;
    XSelectInput(app->dpy, app->root, SubstructureNotifyMask);
    return 1;
}

static void cleanup(App *app) {
    if (!app->dpy) {
        return;
    }
    flush_save(app, 1);
    XUngrabPointer(app->dpy, CurrentTime);
    app->pointer_grabbed = 0;
    show_cursor(app);
    ungrab_escape(app);
    ungrab_wheel(app);
    release_lens_memory(app);
    free(app->hint_alpha);
    app->hint_alpha = NULL;
    release_lock();
    if (app->gc) {
        XFreeGC(app->dpy, app->gc);
    }
    if (app->win) {
        XDestroyWindow(app->dpy, app->win);
    }
    if (app->cmap) {
        XFreeColormap(app->dpy, app->cmap);
    }
    XCloseDisplay(app->dpy);
    app->dpy = NULL;
}

static int run(App *app) {
    int xfd = ConnectionNumber(app->dpy);
    struct sigaction action;
    long long next_frame = 0;
    memset(&action, 0, sizeof action);
    action.sa_handler = on_signal;
    sigaction(SIGINT, &action, NULL);
    sigaction(SIGTERM, &action, NULL);
    sigaction(SIGHUP, &action, NULL);
    while (!g_stop) {
        if (g_toggle) {
            long long now = mono_us();
            g_toggle = 0;
            if (now >= app->toggle_after) {
                app->toggle_after = now + TOGGLE_GUARD_US;
                toggle_lens(app);
            }
        }
        while (XPending(app->dpy)) {
            XEvent event;
            XNextEvent(app->dpy, &event);
            handle_event(app, &event);
        }
        if (app->mapped && app->win) {
            XRaiseWindow(app->dpy, app->win);
        }
        if (g_stop) {
            break;
        }
        flush_save(app, 0);
        if (app->mapped && mono_us() >= next_frame) {
            tick(app);
            next_frame = mono_us() + FRAME_USEC;
        }
        {
            fd_set fds;
            struct timeval timeout;
            struct timeval *wait_for = NULL;
            long long now = mono_us();
            long long wait_us = -1;
            FD_ZERO(&fds);
            FD_SET(xfd, &fds);
            if (app->mapped) {
                wait_us = next_frame - now;
                if (wait_us < 0) {
                    wait_us = 0;
                }
                if (wait_us > FRAME_USEC) {
                    wait_us = FRAME_USEC;
                }
            }
            if (app->save_at) {
                long long save_wait = app->save_at - now;
                if (save_wait < 0) {
                    save_wait = 0;
                }
                if (wait_us < 0 || save_wait < wait_us) {
                    wait_us = save_wait;
                }
            }
            if (wait_us >= 0) {
                timeout.tv_sec = (time_t)(wait_us / 1000000LL);
                timeout.tv_usec = (suseconds_t)(wait_us % 1000000LL);
                wait_for = &timeout;
            }
            XFlush(app->dpy);
            if (select(xfd + 1, &fds, NULL, NULL, wait_for) < 0) {
                if (errno == EINTR) {
                    continue;
                }
                break;
            }
        }
    }
    return 0;
}

int main(void) {
    App app;
    int shape_event = 0;
    int shape_error = 0;
    int fixes_event = 0;
    int fixes_error = 0;
    int composite_event = 0;
    int composite_error = 0;
    struct sigaction action;
    memset(&app, 0, sizeof app);
    if (!session_is_x11()) {
        fprintf(stderr, "需要 X11 会话才能运行放大镜\n");
        return 1;
    }
    memset(&action, 0, sizeof action);
    action.sa_handler = on_toggle;
    sigaction(SIGUSR1, &action, NULL);
    if (!claim_primary()) {
        return 0;
    }
    XSetErrorHandler(on_x_error);
    app.dpy = XOpenDisplay(NULL);
    if (!app.dpy) {
        fprintf(stderr, "需要 X11 会话才能运行放大镜\n");
        release_lock();
        return 1;
    }
    app.screen = DefaultScreen(app.dpy);
    app.root = RootWindow(app.dpy, app.screen);
    if (!XShmQueryExtension(app.dpy)) {
        fprintf(stderr, "需要 X11 的共享内存扩展\n");
        XCloseDisplay(app.dpy);
        release_lock();
        return 1;
    }
    app.shm_event = XShmGetEventBase(app.dpy);
    if (!XShapeQueryExtension(app.dpy, &shape_event, &shape_error)) {
        fprintf(stderr, "需要 X11 的形状扩展\n");
        XCloseDisplay(app.dpy);
        release_lock();
        return 1;
    }
    if (!XFixesQueryExtension(app.dpy, &fixes_event, &fixes_error)) {
        fprintf(stderr, "需要 X11 的光标扩展\n");
        XCloseDisplay(app.dpy);
        release_lock();
        return 1;
    }
    if (!XCompositeQueryExtension(app.dpy, &composite_event, &composite_error)) {
        fprintf(stderr, "需要窗口合成扩展\n");
        XCloseDisplay(app.dpy);
        release_lock();
        return 1;
    }
    set_conf_path(&app);
    if (!load_config(&app)) {
        XCloseDisplay(app.dpy);
        release_lock();
        return 1;
    }
    if (!create_window(&app)) {
        XCloseDisplay(app.dpy);
        release_lock();
        return 1;
    }
    prepare_hint(&app);
    show_lens(&app);
    run(&app);
    cleanup(&app);
    return 0;
}

#endif
