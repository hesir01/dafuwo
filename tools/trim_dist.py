# dist 瘦身：只删「运行时不会请求」的产物，源文件 assets/ 不动（随时可 vite build 还原）
# 原则：白名单目录/后缀保留，黑名单整目录删除；删除前打印统计，可加 --dry 预演
import os, sys, shutil, glob

ROOT = 'dist'
DRY = '--dry' in sys.argv

# 1) 整目录删除：素材原稿 / 未接入的中间产物
KILL_DIRS = [
    'raw_islands', 'raw_final', 'raw_fruits', 'raw_cells', 'raw', 'raw_ui',
    'portraits',            # 运行时用 portraits_cut
    'generated-images'
]

# 2) 逐文件删除：已被预缩版取代的大图（gameData / BootScene 改指 _128/_96/_256/_512 后不再请求）
KILL_FILES = [
    'board/board_frame.png', 'board/sea_center.png', 'board/tile_sea.png',
    'dice/dice_faces.png'
]
# 大图原稿：保留带尺寸后缀的中间版
KILL_PATTERNS = [
    ('islands', '_128'),        # 删 1024 原图与 _96
    ('cells', '_128'),
    ('fruits', '_96'),          # 删 1024 原图与 _48
    ('haki', '_96'),
    ('portraits_cut', '_256'),  # 删 1024 原图（含 regen/256 子目录里的旧图）
]

freed = 0
killed = 0

def rm(path):
    global freed, killed
    if not os.path.exists(path):
        return
    if os.path.isdir(path):
        size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)
    else:
        size = os.path.getsize(path)
    freed += size
    killed += 1
    if not DRY:
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

for d in KILL_DIRS:
    rm(os.path.join(ROOT, d))

# 3) 通用规则：所有 raw* 原稿目录、未接入的 items/、根目录的检查用概览图
for entry in sorted(os.listdir(ROOT)):
    p = os.path.join(ROOT, entry)
    if os.path.isdir(p) and entry.startswith('raw'):
        rm(p)
rm(os.path.join(ROOT, 'items'))
for f in glob.glob(os.path.join(ROOT, '*.png')):
    rm(f)

for f in KILL_FILES:
    rm(os.path.join(ROOT, f))

for folder, keep in KILL_PATTERNS:
    for f in glob.glob(os.path.join(ROOT, folder, '*.png')):
        base = os.path.splitext(os.path.basename(f))[0]
        if not base.endswith(keep):
            rm(f)
    # 子目录（regen / 256 等中间产物整目录删）
    for sub in glob.glob(os.path.join(ROOT, folder, '*')):
        if os.path.isdir(sub):
            rm(sub)

print(('[dry] ' if DRY else '') + f'删除 {killed} 项，释放 {freed/1024/1024:.1f} MB')
