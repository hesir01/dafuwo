#!/bin/bash
# 批量生成核心玩法图标：8特殊格 + 10果实 + 3霸气 + 5道具 + 骰子 = 27张
# 无参考图，standard 1积分/张，免费抠图
cd "/Users/hyc/Desktop/大富翁" || exit 1
API="python3 .agents/skills/game-assets/meowart_api.py"

CELL_PRE="16-bit pixel art board cell icon, One Piece anime-inspired, top-down view, chibi style, vibrant saturated colors, clean dark outline, crisp pixels, no anti-aliasing, limited cohesive palette, "
ITEM_PRE="16-bit pixel art game item icon, One Piece anime-inspired, chibi style, vibrant saturated colors, clean dark outline, crisp pixels, no anti-aliasing, limited cohesive palette, "
BG_SUF=", plain background, no text, no letters, no watermark, no logo, single object, high detail"
WHITE_SUF=", plain white background, no text, no letters, no watermark, no logo, single object, high detail"

# 类型|目录|文件名|前缀|后缀|特色
icons=(
"CELL|cells|cell_reverse_mountain|a huge steep mountain with five waterways rushing upward, rapids and spray"
"CELL|cells|cell_event|an open rolled nautical chart with a wrist compass and a glowing question-mark scroll"
"CELL|cells|cell_devil_fruit|a glowing mysterious devil fruit with spiral patterns resting on a pedestal with sparkles"
"CELL|cells|cell_impel_down|a dark underwater prison tower with iron bars and menacing guards"
"CELL|cells|cell_heavenly_tribute|a golden treasure chest and coins being handed up as a tax offering"
"CELL|cells|cell_port|a friendly wooden harbor dock with a lighthouse, anchor and supply crates"
"CELL|cells|cell_poneglyph|a giant dark indestructible stone cube covered in mysterious carved glyphs and glowing faintly"
"CELL|cells|cell_laugh_tale|a legendary sunny island at the end of the sea with a giant treasure and rainbow"
"ITEM|fruits|fruit_01_dark|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, pitch-black fruit with dark smoke and gravity swirls"
"ITEM|fruits|fruit_02_quake|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, pale white-blue fruit surrounded by cracking shockwave rings"
"ITEM|fruits|fruit_03_light|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, glowing golden-yellow fruit radiating light beams and sparkles"
"ITEM|fruits|fruit_04_ice|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, frosty icy-blue fruit covered in crystals and cold mist"
"ITEM|fruits|fruit_05_magma|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, red-orange molten fruit dripping with glowing lava"
"ITEM|fruits|fruit_06_paw|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, soft pink fruit shaped like cushioned paw pads"
"ITEM|fruits|fruit_07_mochi|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, pink-and-white sticky mochi-like fruit with a glossy sheen"
"ITEM|fruits|fruit_08_op|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, pale heart-shaped fruit with a faint translucent operating-room dome"
"ITEM|fruits|fruit_09_flower|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, pink-purple fruit blooming with spreading flower petals"
"ITEM|fruits|fruit_10_chop|a single mysterious devil fruit covered in spiral swirl patterns with a curled stem, bright orange fruit that looks split into floating chopped pieces"
"ITEM|haki|haki_01_armament|a clenched fist covered in black hardening coating with dark smoke"
"ITEM|haki|haki_02_observation|a stylized eye surrounded by foresight ripple rings and dark blue aura"
"ITEM|haki|haki_03_conqueror|a crown silhouette bursting with red-and-black conqueror lightning"
"ITEM|items|item_poneglyph|a small dark ancient stone cube covered in mysterious carved glyphs with a faint blue glow"
"ITEM|items|item_coin|a shiny gold coin with a simple berry-like embossed mark and sparkle"
"ITEM|items|item_logpose|a wrist compass with a floating glass needle, brass and leather"
"ITEM|items|item_ship_01_sheep|side view, a small cute pirate ship with a white sheep figurehead and orange-and-white sails"
"ITEM|items|item_ship_02_lion|side view, a sleek pirate ship with a lion figurehead and sunny yellow-green sails"
"ITEM|dice|dice_faces|a set of six white dice faces with black pips arranged in a row"
)

for t in "${icons[@]}"; do
  IFS='|' read -r typ dir name scene <<< "$t"
  if [ "$typ" = "CELL" ]; then PRE="$CELL_PRE"; SUF="$BG_SUF"; else PRE="$ITEM_PRE"; SUF="$WHITE_SUF"; fi
  echo "=== $name ==="
  $API general-image-run \
    --generation-model image-2.5 --aspect-ratio 1:1 --resolution 1K \
    --quality standard --remove-bg-method standard \
    --output-dir "assets/raw_${dir}/${name}" \
    --prompt "${PRE}${scene}${SUF}" 2>&1 | grep -E '"status"|credit_cost|"error"'
  echo ""
done
echo "ALL ICONS DONE"
