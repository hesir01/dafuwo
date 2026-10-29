# 全量素材清晰度预处理：把所有「大源图 → 小尺寸显示」的图片按显示尺寸 LANCZOS 预缩中间版
# 目的：Phaser 默认 LINEAR 过滤下，1024 源图直缩到 30-90px 会把像素细节平均掉 → 发糊
# 预缩后只做 1-2 倍缩放，GPU 采样直接命中有效像素，边缘明显锐利
#
# 规则：目标尺寸 ≈ 实际最大显示尺寸 × 2（覆盖 2x DPR 截图/高分屏），且不超过源图尺寸
from PIL import Image
import os

JOBS = [
    # (glob, 目标边长, 后缀)
    ('assets/portraits_cut/char_*_portrait.png', 256, '_256'),   # 头像 40-84px、选人卡 ~150px
    ('assets/tokens/char_*_token.png', 256, '_256'),             # 中央头像最大 96px（2x DPR 192），64 版放大会糊
    ('assets/fruits/fruit_*.png', 96, '_96'),                    # 手牌图标 ~35px、弹窗 48px
    ('assets/haki/haki_*.png', 96, '_96'),                       # 同上
    ('assets/ui/card_back.png', 128, '_128'),                    # 手牌背 64px
    ('assets/board/board_frame.png', 512, '_512'),               # 中央画框 ~420-480px
]

SKIP = ('_256', '_128', '_96', '_48', '_512')

for pattern, size, tag in JOBS:
    import glob
    for f in sorted(glob.glob(pattern)):
        base, ext = os.path.splitext(f)
        if any(base.endswith(s) for s in SKIP):
            continue
        im = Image.open(f).convert('RGBA')
        w, h = im.size
        # 等比缩：取长边到目标尺寸
        s = size / max(w, h)
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
        out = f'{base}{tag}.png'
        im.resize((nw, nh), Image.LANCZOS).save(out)
        print('gen', out, (nw, nh))
