# 岛屿/特殊格 1024 源图 → LANCZOS 128px 中间版，并更新 gameData.js 引用
# 解决：1024 源图直接缩到 28-46px 显示，LINEAR 过滤下细节被平均，图标发糊
from PIL import Image
import glob, re, os

for pattern, tag in [('assets/islands/isl_*.png', '128'), ('assets/cells/cell_*.png', '128')]:
    for f in sorted(glob.glob(pattern)):
        base, ext = os.path.splitext(f)
        if base.endswith('_96'):
            continue
        out = f'{base}_{tag}.png'
        im = Image.open(f).convert('RGBA')
        im.resize((128, 128), Image.LANCZOS).save(out)
        print('gen', out)

# 更新 shared/gameData.js：icon 路径 1024 → _128
gd = 'shared/gameData.js'
src = open(gd, encoding='utf-8').read()
n = 0
def repl(m):
    global n
    p = m.group(1)
    if re.search(r'_(96|48|128)\.png$', p):
        return m.group(0)
    n += 1
    return f"icon: '{p[:-4]}_128.png'"
src2 = re.sub(r"icon: '(/islands/[^']+|/cells/[^']+)'", repl, src)
open(gd, 'w', encoding='utf-8').write(src2)
print('gameData.js updated paths:', n)
