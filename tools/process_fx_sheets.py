#!/usr/bin/env python3
"""把 assets/fx/ 的 6 张 1024 底色版特效图加工成游戏可用的透明 8 帧横排 sheet。

原始图问题：RGB 无 alpha、底色为纯色（各图不同）、8 帧横向排列但帧位不严格均匀、
内容集中在竖直中部横带。加工步骤：
1. 色键抠底（基于四角主色 + 容差，只处理与底色接近的像素，边缘做平滑 alpha 过渡）
2. 裁掉上下空白 → 每帧按内容等宽切 8 份（原 8 帧为等宽横排生成，直接 8 等分）
3. 每帧内容取 bbox 居中到统一画布（256×128），保持相对大小
4. 重排为标准 8 帧横排 sheet（2048×128），供 Phaser loadSpritesheet frameWidth=256

用法：/usr/bin/python3 tools/process_fx_sheets.py
输出：assets/fx/sheets/fx_<name>_sheet.png（覆盖前先写 .tmp 校验）
"""
from PIL import Image
import glob
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'assets', 'fx')
OUT_DIR = os.path.join(SRC_DIR, 'sheets')
FRAME_W, FRAME_H = 256, 128  # 单帧画布：内容多为横向动作带，128 高足够且游戏内缩放灵活
N_FRAMES = 8

def key_out_bg(im, tol=42, feather=18):
    """色键抠底：四角均值为主色，与主色距离 < tol 全透，tol..tol+feather 线性过渡。"""
    im = im.convert('RGB')
    w, h = im.size
    corners = [im.getpixel(p) for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    px = im.load()
    out = Image.new('RGBA', im.size)
    op = out.load()
    t2 = tol + feather
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            d = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            if d <= tol:
                continue
            a = 255 if d >= t2 else int(255 * (d - tol) / feather)
            op[x, y] = (r, g, b, a)
    return out

def process(path, name_override=None):
    name = name_override or os.path.basename(path).replace('.png', '')
    im = key_out_bg(Image.open(path))
    w, h = im.size
    # 整体内容 bbox（粗定位竖直范围），帧内再精裁
    band = im.getbbox()
    top, bottom = max(band[1] - 6, 0), min(band[3] + 6, h)
    frames = []
    for i in range(N_FRAMES):
        x0, x1 = w * i // N_FRAMES, w * (i + 1) // N_FRAMES
        fr = im.crop((x0, top, x1, bottom))
        bb = fr.getbbox()
        if bb is None:
            fr = Image.new('RGBA', (FRAME_W, FRAME_H))
        else:
            pad = 4
            bb = (max(bb[0] - pad, 0), max(bb[1] - pad, 0),
                  min(bb[2] + pad, fr.width), min(bb[3] + pad, fr.height))
            content = fr.crop(bb)
            # 等比缩放进统一帧画布（LANCZOS 保持像素图锐利可用 NEAREST，但源是 1024 大图，LANCZOS 更干净）
            scale = min(FRAME_W / content.width, FRAME_H / content.height, 1.0)
            nw, nh = max(int(content.width * scale), 1), max(int(content.height * scale), 1)
            content = content.resize((nw, nh), Image.LANCZOS)
            fr = Image.new('RGBA', (FRAME_W, FRAME_H))
            fr.paste(content, ((FRAME_W - nw) // 2, FRAME_H - nh - 2), content)  # 底部对齐
        frames.append(fr)
    sheet = Image.new('RGBA', (FRAME_W * N_FRAMES, FRAME_H))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * FRAME_W, 0))
    out_path = os.path.join(OUT_DIR, f'{name}_sheet.png')
    tmp = out_path.replace('.png', '.tmp.png')
    sheet.save(tmp)
    os.replace(tmp, out_path)
    print(f'{name}: {w}x{h} -> {sheet.size[0]}x{sheet.size[1]} ({N_FRAMES} frames x {FRAME_W}x{FRAME_H})')

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--from-raw2':
        # 从 raw_fx2 的任务目录取图，按目录名（fx_xxx）命名输出
        raw = os.path.join(ROOT, 'assets', 'raw_fx2')
        for d in sorted(os.listdir(raw)):
            dd = os.path.join(raw, d)
            if not os.path.isdir(dd):
                continue
            pngs = glob.glob(os.path.join(dd, '*', 'result_images_0_url.png'))
            if pngs:
                process(pngs[0], name_override=d)
    else:
        for p in sorted(glob.glob(os.path.join(SRC_DIR, 'fx_*.png'))):
            process(p)

if __name__ == '__main__':
    main()
