import Phaser from 'phaser'
import {
  ISLANDS, CELL_ICONS, TOKEN_ICONS, FRUITS, HAKI, CHARACTERS, EVENTS
} from '../../../shared/gameData.js'
import {
  PALETTE, COLOR_TEXT, TYPE, textStyle, wrap, clamp,
  fitCover, makeButton, onSceneResize
} from '../ui/uiKit.js'
import { openSettingsPanel, playSfx } from '../ui/settings.js'
import { FX_SPRITE_ENABLED } from '../ui/fxConfig.js'

// 加载全部资源，然后进入标题页
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload() {
    const cx = this.scale.width / 2
    const cy = this.scale.height / 2

    this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x0a1628)
    this.add.rectangle(cx, cy - 100, this.scale.width, 200, 0x122947)

    this.add.text(cx, cy - 120, '航海王大富翁', {
      ...textStyle(clamp(this.scale.width * 0.05, 26, 52), COLOR_TEXT.title, { fontStyle: 'bold', stroke: '#3a2008', strokeThickness: 8 })
    }).setOrigin(0.5)
    this.add.text(cx, cy - 70, '— GRAND LINE —', textStyle(16, '#7a9cc0', { fontStyle: 'italic' })).setOrigin(0.5)

    const barW = Math.min(400, this.scale.width - 80)
    const barH = 16
    const barX = cx - barW / 2
    const barY = cy
    const g = this.add.graphics()
    g.fillStyle(0x1a2f47, 1).fillRoundedRect(barX, barY - barH / 2, barW, barH, 8)
    g.lineStyle(2, 0x3a6a96, 1).strokeRoundedRect(barX, barY - barH / 2, barW, barH, 8)
    const fill = this.add.graphics()
    const pct = this.add.text(cx, barY + 28, '0%', textStyle(14, '#9fb6cc')).setOrigin(0.5)

    this.load.on('progress', (v) => {
      fill.clear()
      fill.fillStyle(0x3f8fd0, 1).fillRoundedRect(barX + 2, barY - barH / 2 + 2, (barW - 4) * v, barH - 4, 6)
      pct.setText(Math.round(v * 100) + '%')
    })

    // 岛屿
    ISLANDS.forEach((isl) => { this.load.image(`isl${isl.id}`, isl.icon) })
    // 特殊格
    Object.entries(CELL_ICONS).forEach(([type, url]) => { this.load.image(`cell_${type}`, url) })
    // 棋子：按角色 ID 加载（token1..token10），对局内用 charId 取对应头像
    TOKEN_ICONS.forEach((url, i) => { this.load.image(`token${i + 1}`, url) })
    // 中央头像专用高清版（256 LANCZOS）：64 版在中央画框被放大到 ~96px（2x DPR 192）会糊；
    // 棋子本体在棋盘上只有 ~20-30px，继续用 64 版
    TOKEN_ICONS.forEach((url, i) => {
      this.load.image(`tokenhd${i + 1}`, url.replace('_token_64.png', '_token_256.png'))
    })
    // 棋子 idle 呼吸动画：8 帧横排 sheet（charId 1..10 与 token 同序）
    const IDLE_KEYS = [
      'char_01_captain', 'char_02_swordsman', 'char_03_navigator', 'char_04_cook',
      'char_05_sniper', 'char_06_doctor', 'char_07_archaeologist', 'char_08_shipwright',
      'char_09_musician', 'char_10_helmsman'
    ]
    IDLE_KEYS.forEach((k, i) => {
      this.load.spritesheet(`idle${i + 1}`, `/anim/idle/sheets/${k}_idle_sheet.png`, {
        frameWidth: 80, frameHeight: 80
      })
    })

    // 果实 / 霸气 / 技能 / 事件 图标
    FRUITS.forEach((f) => this.load.image(`fruit_${f.id}`, f.icon))
    HAKI.forEach((h) => this.load.image(`haki_${h.id}`, h.icon))
    CHARACTERS.forEach((c) => this.load.image(`skill_${c.id}`, c.skillIcon))
    // 头像/卡牌背/画框统一用预缩中间版（LANCZOS），避免 1024 直缩到 40-90px 发糊
    const PORTRAITS = [
      '/portraits_cut/char_01_captain_portrait_256.png',
      '/portraits_cut/char_02_swordsman_portrait_256.png',
      '/portraits_cut/char_03_navigator_portrait_256.png',
      '/portraits_cut/char_04_cook_portrait_256.png',
      '/portraits_cut/char_05_sniper_portrait_256.png',
      '/portraits_cut/char_06_doctor_portrait_256.png',
      '/portraits_cut/char_07_archaeologist_portrait_256.png',
      '/portraits_cut/char_08_shipwright_portrait_256.png',
      '/portraits_cut/char_09_musician_portrait_256.png',
      '/portraits_cut/char_10_helmsman_portrait_256.png'
    ]
    PORTRAITS.forEach((url, i) => this.load.image(`portrait_${i + 1}`, url))
    EVENTS.forEach((e) => this.load.image(`event_${e.id}`, e.icon))

    // 美化素材
    this.load.image('sea_tile', '/board/sea_tile.png')
    this.load.image('board_frame', '/board/board_frame_512.png')
    this.load.image('ui_panel', '/ui/ui_panel.png')
    this.load.image('ui_panel_v2', '/ui/ui_panel_v2.png')
    this.load.image('ui_panel_v3', '/ui/ui_panel_v3.png')
    this.load.image('ui_button', '/ui/ui_button.png')
    this.load.image('ui_btn_wood', '/ui/ui_btn_wood.png')
    this.load.image('ui_btn_gold', '/ui/ui_btn_gold.png')
    this.load.image('ui_cardframe', '/ui/ui_cardframe.png')
    this.load.image('card_back', '/ui/card_back_128.png')
    // 最终航行演出用小船（拉夫德鲁胜利绕场一周）
    this.load.image('ship_voyage', '/items/item_ship_01_sheep.png')
    // 骰面表：原图每帧 128×128，但骰子本体只占 96×115，左右还各有一道「切线」装饰。
    // 中央骰子放大到 40px+ 后这两道线会变成两根游离竖杠，故用 dice_sheet_trim（已裁到本体）。
    this.load.spritesheet('dice_sheet', '/dice/dice_sheet_trim.png', {
      frameWidth: 96, frameHeight: 115
    })
    // 特效 sheet：8 帧横排透明 PNG（由 tools/process_fx_sheets.py 从原始底色图加工）
    // 关闭时不加载，省掉 ~1MB 无用请求（开关见 ui/fxConfig.js）
    if (FX_SPRITE_ENABLED) {
      const FX_SHEETS = [
        'fx_coin_burst', 'fx_dice_roll', 'fx_haki_lightning',
        'fx_ice', 'fx_slash', 'fx_teleport'
      ]
      FX_SHEETS.forEach((n) => {
        this.load.spritesheet(n, `/fx/sheets/${n}_sheet.png`, {
          frameWidth: 256, frameHeight: 128
        })
      })
    }

    const sfx = [
      'sfx_dice_roll', 'sfx_dice_doubles', 'sfx_move_step', 'sfx_coin_pay',
      'sfx_coin_burst', 'sfx_buy', 'sfx_upgrade', 'sfx_rent_pay', 'sfx_tax',
      'sfx_card_draw', 'sfx_fruit_use', 'sfx_haki', 'sfx_jail_open',
      'sfx_jail_lock', 'sfx_storm', 'sfx_button_click', 'sfx_victory', 'sfx_defeat'
    ]
    sfx.forEach((n) => this.load.audio(n, `/audio/sfx/${n}.wav`))
    this.load.audio('bgm_game', '/audio/bgm/bgm_game.mp3')
    this.load.audio('bgm_victory', '/audio/bgm/bgm_victory.mp3')
    this.load.image('bg_title', '/backgrounds/bg_menu.png')
    this.load.image('bg_lobby', '/backgrounds/bg_lobby.png')
    this.load.image('bg_pick', '/backgrounds/bg_pick.png')
    this.load.image('bg_result', '/backgrounds/bg_result.png')
  }

  create() {
    this.build()
    onSceneResize(this, (w, h) => {
      if (w === this.W && h === this.H) return
      this.children.removeAll(true)
      this.build()
    })
  }

  build() {
    this.W = this.scale.width
    this.H = this.scale.height
    const cx = this.W / 2
    const cy = this.H / 2

    const bg = this.add.image(0, 0, 'bg_title').setOrigin(0, 0)
    fitCover(bg, this.W, this.H)
    this.add.rectangle(cx, cy, this.W, this.H, 0x000000, 0.35)
    this.buildTitleAmbience(bg)

    const titleSize = clamp(Math.round(this.W * 0.06), 26, 72)
    this.add.text(cx, cy - 80, '航海王大富翁', {
      ...textStyle(titleSize, COLOR_TEXT.title, { fontStyle: 'bold', stroke: '#3a2008', strokeThickness: 10 })
    }).setOrigin(0.5)
    this.add.text(cx, cy - 10, '— GRAND LINE —', textStyle(clamp(this.W * 0.016, 13, 20), COLOR_TEXT.title, { fontStyle: 'italic' })).setOrigin(0.5)

    // CTA 不再依赖闪烁：固定高对比按钮，只保留轻微光效
    const btn = makeButton(this, {
      x: cx, y: cy + 62, w: clamp(this.W - 160, 200, 300), h: 68,
      label: '⚓ 点击出航', color: PALETTE.good, fontSize: TYPE.section,
      wood: true,
      onClick: () => {
        this.playSfx()
        this.scene.start('LobbyScene')
      }
    })
    // 新按钮自带金边，不再叠加外框呼吸光效

    // 设置入口：主菜单右下角，不与主 CTA 抢焦点
    makeButton(this, {
      x: this.W - 86, y: this.H - 42, w: 140, h: 44,
      label: '⚙ 设置', color: PALETTE.neutral, fontSize: TYPE.bodySmall,
      onClick: () => {
        playSfx(this, 'sfx_button_click', 0.6)
        openSettingsPanel(this)
      }
    })

    this.add.text(cx, cy + 132, '2-4人联机 · 10位草帽团角色 · 双胜利路线', {
      ...textStyle(clamp(this.W * 0.014, 12, 16), '#ffffff', { align: 'center', ...wrap(this.W - 60) })
    }).setOrigin(0.5)
  }

  // 标题屏氛围（bg_menu 1536×864，图内坐标经 fitCover 映射）：
  // 落日光晕呼吸 + 海面波光带缓摆 + 海平线远船剪影横穿。vfx_glow 与 LobbyScene 共用。
  buildTitleAmbience(bgImg) {
    const img = bgImg.texture.getSourceImage()
    const scale = Math.max(this.W / img.width, this.H / img.height)
    const pt = (ix, iy) => ({
      x: this.W / 2 + (ix - img.width / 2) * scale,
      y: this.H / 2 + (iy - img.height / 2) * scale
    })
    if (!this.textures.exists('vfx_glow')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 0.30); g.fillCircle(32, 32, 30)
      g.fillStyle(0xffffff, 0.45); g.fillCircle(32, 32, 19)
      g.fillStyle(0xffffff, 1); g.fillCircle(32, 32, 9)
      g.generateTexture('vfx_glow', 64, 64)
      g.destroy()
    }
    // 1) 落日光晕：太阳处暖橙呼吸，倒影竖带一条长光晕轻微起伏
    const sun = pt(950, 334)
    const sunGlow = this.add.image(sun.x, sun.y, 'vfx_glow')
      .setDisplaySize(560 * scale, 560 * scale)
      .setTint(0xffa040).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.30)
    this.tweens.add({
      targets: sunGlow, alpha: { from: 0.24, to: 0.38 }, scale: { from: 1, to: 1.06 },
      duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    })
    const refl = pt(950, 600)
    const reflGlow = this.add.image(refl.x, refl.y, 'vfx_glow')
      .setDisplaySize(200 * scale, 420 * scale)
      .setTint(0xffb85c).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.16)
    this.tweens.add({
      targets: reflGlow, alpha: { from: 0.10, to: 0.22 }, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    })
    // 2) 海面波光带：避开左侧船体，中/右海域三条错速缓摆
    ;[[900, 480, 500, 0.16], [1150, 610, 560, 0.13], [850, 760, 640, 0.10]].forEach(([ix, iy, w, a], i) => {
      const p = pt(ix, iy)
      const band = this.add.rectangle(p.x, p.y, w * scale, 6 + i * 3, 0xffe9c0, a)
      this.tweens.add({
        targets: band, x: p.x - (60 + i * 40) * scale, alpha: a * 0.5,
        duration: 3600 + i * 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      })
    })
    // 3) 海平线远船剪影：180s 一班从右向左，随波轻晃
    const horizon = pt(1470, 420)
    const ship = this.add.image(horizon.x, horizon.y, 'ship_voyage')
      .setDisplaySize(40 * scale, 40 * scale).setTint(0x6a4a30).setAlpha(0.8)
    this.tweens.add({ targets: ship, x: pt(-60, 208).x, duration: 180000, repeat: -1, delay: 8000 })
    this.tweens.add({ targets: ship, y: '+=1.5', duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }

  playSfx() {
    playSfx(this, 'sfx_button_click', 0.7)
  }
}
