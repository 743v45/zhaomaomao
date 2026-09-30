#!/usr/bin/env python3
"""去除近纯色背景 → 透明底 PNG（猫棋素材处理，配合 AI_CAT_BRIEF 使用）。

用法:
  python3 scripts/remove-bg.py IN.png OUT.png [--tol 32] [--pad 8]
      [--erase-rect L,T,R,B]   # 比例 0~1，先把该矩形填成背景色（去水印用）
      [--preview]              # 同时输出 OUT.preview.png（棋盘格底预览）

原理：取图像四角中位数当背景色，从四边向内泛洪填充（BFS，容差内视为背景），
1px 软化边缘，裁剪到内容 bbox。仅适用于纯色/近纯色背景图。
"""
import argparse
from collections import deque

from PIL import Image, ImageFilter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inp')
    ap.add_argument('out')
    ap.add_argument('--tol', type=int, default=32, help='背景色容差（欧氏距离平方比较的每通道值）')
    ap.add_argument('--pad', type=int, default=8, help='裁剪 bbox 外边距')
    ap.add_argument('--erase-rect', default=None, help='L,T,R,B（比例），先把矩形填成背景色，用于去水印')
    ap.add_argument('--preview', action='store_true', help='输出棋盘格底预览图')
    a = ap.parse_args()

    im = Image.open(a.inp).convert('RGBA')
    W, H = im.size
    px = im.load()

    corners = [px[0, 0][:3], px[W - 1, 0][:3], px[0, H - 1][:3], px[W - 1, H - 1][:3]]
    bg = tuple(sorted(ch)[1] for ch in zip(*corners))  # 各通道中位数

    if a.erase_rect:
        l, t, r, b = (float(x) for x in a.erase_rect.split(','))
        for y in range(int(t * H), min(H - 1, int(b * H)) + 1):
            for x in range(int(l * W), min(W - 1, int(r * W)) + 1):
                px[x, y] = (*bg, 255)

    tol2 = a.tol * a.tol
    seen = bytearray(W * H)
    q = deque()
    for x in range(W):
        q.append((x, 0)); q.append((x, H - 1))
    for y in range(H):
        q.append((0, y)); q.append((W - 1, y))
    while q:
        x, y = q.popleft()
        i = y * W + x
        if seen[i]:
            continue
        c = px[x, y]
        if (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2 > tol2:
            continue
        seen[i] = 1
        px[x, y] = (255, 255, 255, 0)
        if x > 0: q.append((x - 1, y))
        if x < W - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < H - 1: q.append((x, y + 1))

    # 1px 软化：与透明相邻的不透明像素 alpha 降一半，消硬边白絮
    alpha = im.split()[3]
    opa = alpha.load()
    edge = []
    for y in range(H):
        for x in range(W):
            if opa[x, y] == 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and opa[nx, ny] == 0:
                    edge.append((x, y))
                    break
    for x, y in edge:
        r_, g_, b_, _ = px[x, y]
        px[x, y] = (r_, g_, b_, 128)

    bbox = im.getbbox()
    if bbox:
        im = im.crop((max(0, bbox[0] - a.pad), max(0, bbox[1] - a.pad),
                      min(W, bbox[2] + a.pad), min(H, bbox[3] + a.pad)))
    im.save(a.out)
    print(f'saved {a.out} size={im.size}')

    if a.preview:
        w, h = im.size
        cell = 24
        bgim = Image.new('RGB', (w, h), (255, 255, 255))
        p = bgim.load()
        for y in range(h):
            for x in range(w):
                if (x // cell + y // cell) % 2:
                    p[x, y] = (242, 236, 226)
        bgim.paste(im, (0, 0), im)
        bgim.save(a.out.replace('.png', '.preview.png'))
        print(f'preview {a.out.replace(".png", ".preview.png")}')


if __name__ == '__main__':
    main()
