#!/usr/bin/env python3
"""把 assets/anim/idle/ 的 10 个 8 帧 WebP 抽帧转成 Phaser spritesheet（8 帧横排 PNG）。

输出：assets/anim/idle/sheets/char_XX_*_idle_sheet.png（640×80，8 帧 × 80×80）
Phaser: loadSpritesheet(key, url, { frameWidth: 80, frameHeight: 80 })
用法：/usr/bin/python3 tools/webp_to_sheet.py
"""
from PIL import Image, ImageSequence
import glob
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'anim', 'idle')
OUT = os.path.join(SRC, 'sheets')

def main():
    os.makedirs(OUT, exist_ok=True)
    for p in sorted(glob.glob(os.path.join(SRC, '*_idle.webp'))):
        name = os.path.basename(p).replace('.webp', '')
        frames = [f.convert('RGBA').copy() for f in ImageSequence.Iterator(Image.open(p))]
        w, h = frames[0].size
        sheet = Image.new('RGBA', (w * len(frames), h))
        for i, fr in enumerate(frames):
            sheet.paste(fr, (i * w, 0))
        out_path = os.path.join(OUT, f'{name}_sheet.png')
        sheet.save(out_path)
        print(f'{name}: {len(frames)} frames -> {out_path} ({sheet.size[0]}x{sheet.size[1]})')

if __name__ == '__main__':
    main()
