#!/bin/bash
# 批量生成其余 9 个角色立绘，以路飞为参考图保持风格一致
cd "/Users/hyc/Desktop/大富翁" || exit 1
REF="$(pwd)/assets/raw/16-bit_pixel_art_character_portrait_front-facing_half-body_a_cheerful_teen_pirate_captain_wearing_a_straw_hat_f5a8129c/result_images_0_url.png"
API="python3 .agents/skills/game-assets/meowart_api.py"

chars=(
"char_02_swordsman|a stern green-haired swordsman with short spiky green hair, scar across the closed left eye, three earrings on the left ear, dark green robe, three katanas at the waist, arms crossed"
"char_03_navigator|a pretty orange-haired girl navigator, shoulder-length orange hair, blue-and-white striped top, jeans, small pinwheel tattoo on the shoulder, holding a horizontal blue staff weapon across the body, sly smile"
"char_04_cook|a blond male cook with hair covering one eye, curly eyebrow, small goatee, black suit and shirt, a cigarette, dynamic kicking pose, cool expression"
"char_05_sniper|a long-nosed boy sniper with brown curly hair, goggles around the neck, green bandana and overalls, leather satchel, holding a wooden slingshot, nervous but brave expression"
"char_06_doctor|a tiny cute blue-nosed reindeer mascot with small antlers, wearing a pink fuzzy top hat marked with a white cross, little backpack, big round eyes, kawaii"
"char_07_archaeologist|an elegant tall woman archaeologist with long straight black hair and blue eyes, purple long-sleeve outfit with a long coat, calm confident smile, arms crossed"
"char_08_shipwright|a big muscular cyborg man with blue sunglasses-shaped hair, robotic metal arms and exposed machinery, open colorful hawaiian shirt, cola bottle, striking a proud SUPER pose"
"char_09_musician|a tall living skeleton musician with a black afro, gentleman suit and cravat, holding a cane-sword, laughing heartily, elegant funny pose"
"char_10_helmsman|a large powerful whale-shark fish-man martial artist with blue skin, tusks, webbed hands, sun-shaped tattoo, wearing a martial-arts vest and sash, calm stoic expression, sumo stance"
)

for c in "${chars[@]}"; do
  name="${c%%|*}"
  desc="${c#*|}"
  echo "=== Generating $name ==="
  $API general-image-run \
    --generation-model image-2.5 --aspect-ratio 1:1 --resolution 1K \
    --quality standard --remove-bg-method standard \
    --reference-image "$REF" --output-dir "assets/raw/$name" \
    --prompt "16-bit pixel art character portrait, front-facing half-body, $desc, crisp chunky pixels, plain solid light-blue background, centered, single character"
  echo ""
done
echo "ALL DONE"
