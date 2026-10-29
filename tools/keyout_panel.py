# 把 AI 生成的白底面板素材抠成透明底：只抠除与图像边缘连通的近白区域
from PIL import Image
import numpy as np
from collections import deque

SRC = 'generated-images/Pixel_art_game_UI_panel_frame__2026-10-25T06-52-17.png'
OUT = 'assets/ui/ui_panel_v2.png'

im = Image.open(SRC).convert('RGB')
arr = np.array(im).astype(np.int16)
h, w = arr.shape[:2]

# 近白判定：三通道都 >= 235
near_white = (arr[:, :, 0] >= 235) & (arr[:, :, 1] >= 235) & (arr[:, :, 2] >= 235)

# 从四边出发的 BFS，标记与边缘连通的白色区域
mask = np.zeros((h, w), dtype=bool)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if near_white[y, x] and not mask[y, x]:
            mask[y, x] = True; q.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if near_white[y, x] and not mask[y, x]:
            mask[y, x] = True; q.append((y, x))
while q:
    y, x = q.popleft()
    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
        ny, nx = y+dy, x+dx
        if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not mask[ny, nx]:
            mask[ny, nx] = True; q.append((ny, nx))

print('removed px:', mask.sum(), '/', h*w)

# alpha：背景区 0，边缘 2px 内羽化
alpha = np.where(mask, 0, 255).astype(np.uint8)
# 简单羽化：对 alpha 做一次 3x3 均值（仅弱化硬边）
a_img = Image.fromarray(alpha, 'L').filter(__import__('PIL.ImageFilter', fromlist=['MinFilter']).MinFilter(3))
rgba = im.convert('RGBA')
rgba.putalpha(a_img)
bb = rgba.getchannel('A').getbbox()
rgba = rgba.crop(bb)
rgba.save(OUT)
print('saved', OUT, rgba.size)
