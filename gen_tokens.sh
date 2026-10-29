#!/bin/bash
# 生成 10 个棋盘棋子 token，每个用对应立绘做参考图保持同一角色
cd "/Users/hyc/Desktop/大富翁" || exit 1
API="python3 .agents/skills/game-assets/meowart_api.py"

# 编号|立绘参考|角色描述
tokens=(
"01|captain|the cheerful pirate captain in a straw hat"
"02|swordsman|the green-haired swordsman with a scar over one eye"
"03|navigator|the orange-haired girl navigator"
"04|cook|the blond cook with hair covering one eye"
"05|sniper|the long-nosed boy sniper"
"06|doctor|the tiny blue-nosed reindeer"
"07|archaeologist|the black-haired woman archaeologist"
"08|shipwright|the blue-haired cyborg man"
"09|musician|the skeleton musician with an afro"
"10|helmsman|the whale-shark fish-man martial artist"
)

for t in "${tokens[@]}"; do
  IFS='|' read -r num key desc <<< "$t"
  ref="$(pwd)/assets/portraits_cut/char_${num}_${key}_portrait.png"
  echo "=== Token char_${num}_${key} ==="
  $API general-image-run \
    --generation-model image-2.5 --aspect-ratio 1:1 --resolution 1K \
    --quality standard --remove-bg-method standard \
    --reference-image "$ref" --output-dir "assets/raw_tokens/char_${num}_${key}" \
    --prompt "16-bit pixel art circular board-game token, head-only close-up chibi face medallion of $desc, centered, simple thick circular rim, crisp chunky pixels, plain solid white background, single token"
  echo ""
done
echo "ALL TOKENS DONE"
