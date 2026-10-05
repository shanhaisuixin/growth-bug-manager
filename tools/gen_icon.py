"""自行绘制应用图标，输出 PNG。
只用标准库手写 PNG 编码器 + 简易距离场光栅化，不依赖 Pillow，也不使用任何第三方素材。
生成物属于本项目自有资产。
用法：python tools/gen_icon.py
"""
import math
import os
import struct
import zlib

ACCENT_TOP = (0x7F, 0xAE, 0x8A)
ACCENT_BOT = (0x5D, 0x87, 0x68)
WHITE = (255, 255, 255)

SS = 3  # 超采样倍数，用于抗锯齿


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def smoothstep(edge0, edge1, x):
    t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def rounded_rect(x, y, x0, y0, x1, y1, r):
    """返回该点到圆角矩形的带符号距离，负数表示在内部"""
    cx = clamp(x, x0 + r, x1 - r)
    cy = clamp(y, y0 + r, y1 - r)
    return math.hypot(x - cx, y - cy) - r


def segment(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return math.hypot(x - ax, y - ay)
    t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0.0, 1.0)
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy))


def polyline(x, y, pts):
    d = 1e9
    for i in range(len(pts) - 1):
        d = min(d, segment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
    return d


def render(size):
    s = float(size)
    r = s * 112.0 / 512.0
    line_w = s * 18.0 / 512.0
    dot_r = s * 18.0 / 512.0

    # 折线与短柱的位置（按 512 坐标系缩放）
    path = [(148, 292), (226, 244), (304, 196), (364, 154)]
    path = [(px * s / 512.0, py * s / 512.0) for px, py in path]
    bars = [((148, 292), (148, 348)), ((226, 244), (226, 348)), ((304, 196), (304, 348))]
    bars = [((a[0] * s / 512.0, a[1] * s / 512.0), (b[0] * s / 512.0, b[1] * s / 512.0)) for a, b in bars]
    bar_w = s * 16.0 / 512.0

    rows = bytearray()
    inv = 1.0 / (SS * SS)
    for py in range(size):
        row = bytearray()
        for px in range(size):
            ar = ag = ab = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    fx = px + (sx + 0.5) / SS
                    fy = py + (sy + 0.5) / SS

                    # 圆角矩形底色（对角渐变）
                    d = rounded_rect(fx, fy, 0, 0, s, s, r)
                    cov = 1.0 - smoothstep(-0.5, 0.5, d)
                    if cov <= 0:
                        continue
                    mix = clamp((fx / s + (1.0 - fy / s)) * 0.5, 0.0, 1.0)
                    rr = ACCENT_BOT[0] + (ACCENT_TOP[0] - ACCENT_BOT[0]) * mix
                    gg = ACCENT_BOT[1] + (ACCENT_TOP[1] - ACCENT_BOT[1]) * mix
                    bb = ACCENT_BOT[2] + (ACCENT_TOP[2] - ACCENT_BOT[2]) * mix

                    # 短柱（55% 白）
                    for a, b in bars:
                        c = 1.0 - smoothstep(-0.5, 0.5, segment(fx, fy, a[0], a[1], b[0], b[1]) - bar_w * 0.5)
                        if c > 0:
                            k = c * 0.55
                            rr = rr * (1 - k) + WHITE[0] * k
                            gg = gg * (1 - k) + WHITE[1] * k
                            bb = bb * (1 - k) + WHITE[2] * k

                    # 上升折线
                    c = 1.0 - smoothstep(-0.5, 0.5, polyline(fx, fy, path) - line_w * 0.5)
                    # 端点圆
                    ex, ey = path[-1]
                    c = max(c, 1.0 - smoothstep(-0.5, 0.5, math.hypot(fx - ex, fy - ey) - dot_r))
                    if c > 0:
                        rr = rr * (1 - c) + WHITE[0] * c
                        gg = gg * (1 - c) + WHITE[1] * c
                        bb = bb * (1 - c) + WHITE[2] * c

                    ar += rr * cov
                    ag += gg * cov
                    ab += bb * cov
            alpha = 0.0
            row += bytes((int(ar * inv), int(ag * inv), int(ab * inv), int(alpha)))
            # alpha 由覆盖比例决定
            cov_total = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    fx = px + (sx + 0.5) / SS
                    fy = py + (sy + 0.5) / SS
                    cov_total += 1.0 - smoothstep(-0.5, 0.5, rounded_rect(fx, fy, 0, 0, s, s, r))
            a = int(round(cov_total * inv * 255))
            row[-1] = clamp(a, 0, 255)
        rows += b'\x00' + bytes(row)
    return bytes(rows)


def flatten(raw, size):
    """把带 alpha 的行数据压成不透明的 RGB。

    iOS 的应用图标**不允许带透明通道**（有 alpha 会直接被 Xcode 拒掉，
    主屏上还会显示成黑底）。这里的做法是把半透明白边合成到白底上。"""
    out = bytearray()
    stride = size * 4
    for py in range(size):
        start = py * (stride + 1)
        row = raw[start + 1:start + 1 + stride]      # 去掉每行的 filter 字节
        flat = bytearray()
        for px in range(size):
            r, g, b, a = row[px * 4:px * 4 + 4]
            k = a / 255.0
            flat += bytes((int(r * k + 255 * (1 - k)),
                           int(g * k + 255 * (1 - k)),
                           int(b * k + 255 * (1 - k))))
        out += b'\x00' + bytes(flat)
    return bytes(out)


def write_png(path, size, raw, color_type=6):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack('>IIBBBBB', size, size, 8, color_type, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', header)
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def upscale_rgb(flat, size, factor=2):
    """双线性放大不透明的 RGB 行数据。

    1024 直接超采样渲染要跑四五分钟（SS=3 × 100 万像素的纯 Python），
    而这张图全是平滑渐变，放大两倍根本看不出来。所以渲染 512 再放大。"""
    big = size * factor
    src = []
    stride = size * 3
    for py in range(size):
        start = py * (stride + 1)
        src.append(flat[start + 1:start + 1 + stride])

    def get(x, y, ch):
        x = clamp(x, 0, size - 1)
        y = clamp(y, 0, size - 1)
        return src[y][x * 3 + ch]

    out = bytearray()
    for by in range(big):
        sy = by / factor
        y0 = int(sy)
        fy = sy - y0
        row = bytearray()
        for bx in range(big):
            sx = bx / factor
            x0 = int(sx)
            fx = sx - x0
            for ch in range(3):
                a = get(x0, y0, ch) * (1 - fx) + get(x0 + 1, y0, ch) * fx
                b = get(x0, y0 + 1, ch) * (1 - fx) + get(x0 + 1, y0 + 1, ch) * fx
                row.append(int(a * (1 - fy) + b * fy))
        out += b'\x00' + bytes(row)
    return bytes(out)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.normpath(os.path.join(here, '..'))
    out_dir = os.path.join(root, 'web', 'assets')

    for size in (180, 192, 512):
        raw = render(size)
        p = os.path.join(out_dir, 'icon-%d.png' % size)
        write_png(p, size, raw)
        print('生成', p, os.path.getsize(p), 'bytes')

    # iOS 应用图标：1024 单张就够了（Xcode 14 起支持 single-size app icon），
    # 而且必须**不带透明通道** —— 有 alpha Xcode 会直接拒。
    appicon = os.path.join(root, 'ios', 'GBM', 'Assets.xcassets', 'AppIcon.appiconset')
    os.makedirs(appicon, exist_ok=True)
    base = 512
    raw512 = render(base)
    flat = flatten(raw512, base)
    big = upscale_rgb(flat, base, 2)
    p = os.path.join(appicon, 'icon-1024.png')
    write_png(p, base * 2, big, color_type=2)
    print('生成', p, os.path.getsize(p), 'bytes（不透明）')


if __name__ == '__main__':
    main()
