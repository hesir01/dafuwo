#!/usr/bin/env python3
# 骰子素材后处理：Meowa 生成的六骰横排图 → 运行时 6 帧 spritesheet（每帧 96×115）。
# 用法：python3 tools/process_dice.py <生成图.png> [--out assets/dice/dice_sheet_trim.png]
# 步骤：alpha 列投影切出 6 个骰子 → 逐个裁 bbox → 等比缩放适配 96×115 → 横排拼接。
import argparse
import sys
from PIL import Image

FRAME_W, FRAME_H = 96, 115
MARGIN = 2  # 帧内安全边


def segments_from_alpha(img):
    """按 alpha>8 的列投影切分连通段，返回 [(x0, x1)]"""
    w, h = img.size
    a = img.getchannel("A")
    pix = a.load()
    cols = [any(pix[x, y] > 8 for y in range(0, h, 2)) for x in range(w)]
    segs, start = [], None
    for x, on in enumerate(cols + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            if x - start > 8:  # 忽略碎屑
                segs.append((start, x))
            start = None
    return segs


def crop_bbox(img):
    bbox = img.getchannel("A").getbbox()
    return img.crop(bbox) if bbox else img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--out", default="assets/dice/dice_sheet_trim.png")
    ap.add_argument("--expect", type=int, default=6, help="期望骰子数量")
    args = ap.parse_args()

    img = Image.open(args.src).convert("RGBA")
    segs = segments_from_alpha(img)
    print(f"检测到 {len(segs)} 个连通段（期望 {args.expect}）")
    if len(segs) != args.expect:
        print("段数不符，退出（先人工检查生成图）")
        sys.exit(1)

    # 统一基准缩放：生成图近大远小，逐帧独立缩放会导致帧间忽大忽小（翻滚动画跳变）。
    # 以最大 bbox 为基准计算公共 scale，全部骰子等比缩放到同一视觉尺寸。
    dies = [crop_bbox(img.crop((x0, 0, x1, img.height))) for (x0, x1) in segs]
    mw, mh = FRAME_W - MARGIN * 2, FRAME_H - MARGIN * 2
    bw = max(d.width for d in dies)
    bh = max(d.height for d in dies)
    scale = min(mw / bw, mh / bh)
    frames = []
    for die in dies:
        nw, nh = max(1, round(die.width * scale)), max(1, round(die.height * scale))
        die = die.resize((nw, nh), Image.LANCZOS)
        frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
        frame.paste(die, ((FRAME_W - nw) // 2, (FRAME_H - nh) // 2), die)
        frames.append(frame)

    sheet = Image.new("RGBA", (FRAME_W * len(frames), FRAME_H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * FRAME_W, 0))
    sheet.save(args.out)
    print(f"已写出 {args.out}（{sheet.width}×{sheet.height}，{len(frames)} 帧）")


if __name__ == "__main__":
    main()
