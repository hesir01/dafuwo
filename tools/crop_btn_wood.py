# 从 ui_button_crop.png 裁出按钮木板主体（含左右金属包角），供 NineSlice 拉伸
from PIL import Image

SRC = 'assets/ui/ui_button_crop.png'
OUT = 'assets/ui/ui_btn_wood.png'

im = Image.open(SRC).convert('RGBA')
crop = im.crop((136, 239, 920, 586))  # 784x347

def patch(dst_box, src_box):
    piece = crop.crop(src_box)
    crop.paste(piece, (dst_box[0], dst_box[1]))

# 第一轮：手臂/木桶大块残留
patch((0, 0, 205, 58), (210, 0, 415, 58))
patch((525, 0, 655, 50), (260, 0, 390, 50))

# 收紧右侧（罗盘）与底部（黑边）
crop = crop.crop((0, 0, 738, 332))

# 第二轮：裁掉顶部黑背景（顶边金属条从 y=35 开始）
crop = crop.crop((0, 35, 738, 332))  # 738x297

# 第三轮：顶边小残留（红袖 x185..250、木桶 x610..690），用干净顶边段覆盖
patch((180, 0, 255, 28), (300, 0, 375, 28))
patch((600, 0, 695, 25), (300, 0, 395, 25))
patch((50, 0, 140, 26), (320, 0, 410, 26))

crop.save(OUT)
print('saved', OUT, crop.size)
