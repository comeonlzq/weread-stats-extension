# -*- coding: utf-8 -*-
"""生成扩展图标：深色圆角方块 + 绿色上升柱状图（统计主题）。
仅用标准库（zlib/struct），以 4x 超采样抗锯齿。"""
import zlib, struct, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
SS = 4  # 超采样倍数


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def in_round_rect(px, py, x0, y0, w, h, r):
    if not (x0 <= px < x0 + w and y0 <= py < y0 + h):
        return False
    cx = min(max(px, x0 + r), x0 + w - r)
    cy = min(max(py, y0 + r), y0 + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(size):
    S = size * SS
    # 背景：深蓝渐变 #0F172A -> #1B2A44
    top, bot = (15, 23, 42), (27, 42, 68)
    # 柱状图绿色渐变 #4ADE80 -> #16A34A
    g_top, g_bot = (74, 222, 128), (22, 163, 74)

    m = S * 0.06          # 圆角方块边距
    bw = S * 0.135        # 柱宽
    gap = S * 0.075       # 柱间距
    base = S * 0.80       # 柱底
    heights = [0.30, 0.46, 0.62]
    total_w = bw * 3 + gap * 2
    x_start = (S - total_w) / 2

    rows = []
    for y in range(S):
        row = bytearray()
        for x in range(S):
            if in_round_rect(x, y, m, m, S - 2 * m, S - 2 * m, S * 0.22):
                c = lerp(top, bot, y / S)
                for i, hf in enumerate(heights):
                    bx = x_start + i * (bw + gap)
                    bh = S * hf
                    if in_round_rect(x, y, bx, base - bh, bw, bh, bw / 2):
                        c = lerp(g_top, g_bot, (base - y) / max(bh, 1))
                        break
                row += bytes(c) + b'\xff'
            else:
                row += b'\x00\x00\x00\x00'
        rows.append(bytes(row))

    # 超采样降采样
    out = []
    for y in range(size):
        line = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    px = rows[y * SS + dy][(x * SS + dx) * 4:(x * SS + dx) * 4 + 4]
                    r += px[0]; g += px[1]; b += px[2]; a += px[3]
            n = SS * SS
            line += bytes((r // n, g // n, b // n, a // n))
        out.append(bytes(line))
    return out


def write_png(path, size, rows):
    def chunk(typ, data):
        c = typ + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    raw = b''.join(b'\x00' + r for r in rows)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(os.path.join(OUT, 'icon%d.png' % size), size, render(size))
        print('icon%d.png ok' % size)


if __name__ == '__main__':
    main()
