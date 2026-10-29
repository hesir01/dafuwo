#!/bin/bash
# 重新生成 5 张纯特效（旧素材混入了完整人物：路飞/青雉/索隆/乔巴，不可用）
# 教训：提示词必须显式锁 "effect only, no characters, no people, no humans"
# 颜色键底色：每张用不同纯色，加工脚本自动按四角均值抠
# 5 张 × 1 积分 = 5 积分（1K standard），余额 60 足够
cd "/Users/hyc/Desktop/大富翁" || exit 1
API="/usr/bin/python3 .agents/skills/game-assets/meowart_api.py"

# 名称|特色描述
fxs=(
"fx_coin_burst|a burst of golden coins and sparkles exploding outward with star glints, treasure coins flying in all directions"
"fx_haki_lightning|crackling black and red lightning bolts striking downward with electric sparks, dark purple energy arcs"
"fx_ice|sharp ice crystals forming and spreading with frost sparkles and frozen mist, pale blue shards growing from center"
"fx_slash|a glowing green crescent energy slash arc cutting across with speed lines and light trail"
"fx_teleport|a swirling magical portal vortex with glowing purple mist and sparkles being sucked into the center"
)

for t in "${fxs[@]}"; do
  IFS='|' read -r id scene <<< "$t"
  out="assets/raw_fx2/${id}"
  if ls "$out"/*/final_outputs.json >/dev/null 2>&1; then echo "=== $id SKIP (done)"; continue; fi
  echo "=== $id generating..."
  $API general-image-run \
    --generation-model image-2.5 --aspect-ratio 1:1 --resolution 1K \
    --quality standard --remove-bg-method none \
    --output-dir "$out" \
    --prompt "16-bit pixel art sprite sheet of 8 sequential animation frames arranged in one horizontal row, evenly spaced, 8-bit retro game effect, ${scene}, effect only, no characters, no people, no humans, no animals, no faces, plain solid blue background, crisp pixels, no anti-aliasing, limited cohesive palette, no text, no letters, no watermark, no logo, high detail" 2>&1 | grep -E '"status"|"error"' | head -3
done
echo "ALL FX DONE"
