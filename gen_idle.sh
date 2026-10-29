#!/bin/bash
# 批量生成 char_02~10 棋子 idle 循环动画（9 个 × 15 积分 = 135）
# 参数与 char_01 测试完全一致（pixel/480p/8帧/loop/standard 抠底）
# 中断恢复：已存在成品 webp 的角色自动跳过；任务失败用 general-image-poll 思路查 job，勿重复提交
cd "/Users/hyc/Desktop/大富翁" || exit 1
API="/usr/bin/python3 .agents/skills/game-assets/meowart_api.py"

chars=(
"char_02_swordsman"
"char_03_navigator"
"char_04_cook"
"char_05_sniper"
"char_06_doctor"
"char_07_archaeologist"
"char_08_shipwright"
"char_09_musician"
"char_10_helmsman"
)

for c in "${chars[@]}"; do
  out="assets/anim/idle/${c}_idle.webp"
  if [ -f "$out" ]; then echo "=== $c SKIP (exists)"; continue; fi
  echo "=== $c generating..."
  $API meowa-animation-run \
    --image-file "assets/tokens/${c}_token_64.png" \
    --prompt "The character breathes gently in place with a subtle bobbing motion, clothes and hair swaying slightly, staying on the same spot, looping smoothly" \
    --style-mode pixel --resolution 480p --alpha-mode sharp \
    --output-frames 8 --quality-mode standard --remove-bg-method standard \
    --animation-mode loop --optimize-prompt --padding 16 --padding-alignment center \
    --output-dir "assets/anim/raw_${c}_idle" 2>&1 | grep -E '"status"|"error"|credit' | head -5
  # 归档：把本次任务的 webp 拷成标准名
  src=$(ls -t assets/anim/raw_${c}_idle/*/meowa_animation.webp 2>/dev/null | head -1)
  if [ -n "$src" ]; then cp "$src" "$out"; echo "    -> $out OK"; else echo "    !! $c FAILED, check output dir"; fi
done
echo "ALL DONE"
ls -la assets/anim/idle/
