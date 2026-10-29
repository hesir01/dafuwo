#!/bin/bash
# 批量生成 22 个岛屿图标（无参考图，standard 1积分/张，免费抠图）
# east_01 已用测试图，本脚本生成其余 21 个
cd "/Users/hyc/Desktop/大富翁" || exit 1
API="python3 .agents/skills/game-assets/meowart_api.py"

PRE="16-bit pixel art island map icon, One Piece anime-inspired, top-down view, chibi stylized, vibrant saturated colors, clean dark outline, crisp pixels, no anti-aliasing, limited cohesive palette, "
SUF=", plain background, no text, no letters, no symbols on flags, no watermark, no logo, single island, high detail"

# 编号|key|特色场景
islands=(
"east_02|orange|a peaceful coastal village surrounded by orange orchards and small houses, surrounded by a little sea"
"east_03|syrup|a quiet sloping hillside village with a mansion and green fields, surrounded by a little sea"
"east_04|cocoyasi|a coconut-and-tangerine grove village by the sea with windmill houses, surrounded by a little sea"
"east_05|baratie|a fancy floating restaurant ship on the ocean with lights and masts, surrounded by a little sea"
"east_06|loguetown|a foggy harbor town built around a tall execution platform, beginning-and-end town, surrounded by a little sea"
"grand_01|whisky|a desert frontier town with tall cacti and western-style houses, surrounded by a little sea"
"grand_02|littlegarden|a prehistoric jungle island with dinosaurs, a giant volcano and bones, surrounded by a little sea"
"grand_03|drum|a snowy mountain island with white drum-shaped castles on the peaks, surrounded by a little sea"
"grand_04|alabasta|a vast desert kingdom with sand dunes, a palace and a river city, surrounded by a little sea"
"grand_05|skypiea|a floating island above the clouds with angel beach, ruins and a golden bell, surrounded by a little sea of clouds"
"grand_06|water7|a bright water city of canals, fountains, bridges and a big shipyard, surrounded by a little sea"
"grand_07|ennis|a nighttime marine courthouse island with massive gates and waterfalls, surrounded by a little sea"
"grand_08|thriller|a gigantic gothic ghost ship shrouded in fog with bats and zombies, surrounded by a little sea"
"grand_09|sabaody|a tropical archipelago of giant bubble trees, groves and amusement rides, surrounded by a little sea"
"new_01|fishman|an underwater bubble island of coral reefs, mermaids and glowing sea"
"new_02|punk|a strange island half burning with fire and half frozen in ice, with lab buildings, surrounded by a little sea"
"new_03|dressrosa|a sunny Spanish-style kingdom with a colosseum, flowers and living toys, surrounded by a little sea"
"new_04|zou|a forest city carried on the back of a colossal walking elephant in mist"
"new_05|wholecake|a whimsical island made of cakes, candy and cream with a giant wedding cake, surrounded by a little sea"
"new_06|wano|a feudal-Japan island with cherry blossoms, pagodas and a samurai castle, surrounded by a little sea"
"new_07|egghead|a futuristic high-tech lab island with an egg-shaped dome and holograms, surrounded by a little sea"
)

for t in "${islands[@]}"; do
  IFS='|' read -r id key scene <<< "$t"
  echo "=== Island isl_${id}_${key} ==="
  $API general-image-run \
    --generation-model image-2.5 --aspect-ratio 1:1 --resolution 1K \
    --quality standard --remove-bg-method standard \
    --output-dir "assets/raw_islands/isl_${id}_${key}" \
    --prompt "${PRE}${scene}${SUF}" 2>&1 | grep -E '"status"|credit_cost|error'
  echo ""
done
echo "ALL ISLANDS DONE"
