# Meowa 产出的金边木牌按钮 → 清理杂点 / 裁 bbox / alpha 整流 → assets/ui/ui_btn_gold.png
from PIL import Image
import sys

SRC = 'assets/raw_ui/btn/pixel_art_game_UI_button_asset_long_horizontal_wooden_plank_banner_viewed_straight_from_the_front_three_warm_b_c1e8d422/result_images_0_url.png'
OUT = 'assets/ui/ui_btn_gold.png'

im = Image.open(SRC).convert('RGBA')
px = im.load()
W, H = im.size

# 1) alpha 整流 + 清除孤立杂点：先把弱 alpha 归零
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, 0 if a < 50 else (255 if a > 200 else a))

# 2) 连通域去杂：从边缘 flood-fill 透明区，保留最大不透明主体，删掉主体外的小碎屑
from collections import deque
visited = [[False] * W for _ in range(H)]
labels = [[0] * W for _ in range(H)]  # 0=背景/未定 1=主物体
comp_id = 0
sizes = {}
for sy in range(H):
    for sx in range(W):
        if visited[sy][sx] or labels[sy][sx]:
            continue
        a0 = px[sx, sy][3]
        visited[sy][sx] = True
        comp_id += 1
        q = deque([(sx, sy)])
        n = 0
        while q:
            x, y = q.popleft()
            n += 1
            labels[y][x] = comp_id
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and not visited[ny][nx]:
                    visited[ny][nx] = True
                    if (px[nx, ny][3] > 0) == (a0 > 0):
                        q.append((nx, ny))
        sizes[comp_id] = (n, a0 > 0)

# 最大不透明连通域
main = max((cid for cid, (n, op) in sizes.items() if op), key=lambda c: sizes[c][0])
for y in range(H):
    for x in range(W):
        if labels[y][x] != main and px[x, y][3] > 0:
            px[x, y] = (0, 0, 0, 0)

# 3) 裁 bbox（留 2px 余量防裁掉抗锯齿边）
bbox = im.getbbox()
if bbox:
    l, t, r, b = bbox
    im = im.crop((max(0, l - 2), max(0, t - 2), min(W, r + 2), min(H, b + 2)))
im.save(OUT)
print('saved', OUT, im.size)
