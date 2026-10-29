import Phaser from 'phaser'
import {
  BOARD, ISLAND_BY_ID, ISLAND_SHORT, FRUIT_BY_ID, HAKI_BY_ID,
  CHARACTER_BY_ID, ECONOMY, MONOPOLY_GROUPS, EVENT_BY_ID
} from '../../../shared/gameData.js'
import {
  createGame, roll, buy, declineBuy, buyHistory, declineHistory,
  upgrade, endTurn, getCurrentPlayer, useSkill, useFruit, useHaki,
  confirmFruitTarget, cancelTarget, decisionReroll, decisionEventCancel,
  decisionTrade, decisionFlower, finalVoyage, getHistoryIds, proposeTrade
} from '../../../shared/engine.js'
import { aiStep } from '../../../shared/aiPlayer.js'
import {
  PALETTE, COLOR_TEXT, TYPE, textStyle, monoStyle, wrap,
  makePanel, makeButton, buildModal, showToast, onSceneResize, clamp, emitAck, makeRounded
} from '../ui/uiKit.js'
import { playSfx as sfxPlay, ensureBgm, loadSettings } from '../ui/settings.js'
import { FX_SPRITE_ENABLED } from '../ui/fxConfig.js'
import { openQuickChat, showBubble } from '../ui/chat.js'

// 岛屿格：羊皮纸底色混入海域色，让三大航线的色块身份更明显
const SEA_COLOR = { east: 0x3f93d6, grand: 0xe0652a, new: 0x9b59c4 }
const PARCHMENT = 0xecd9b0
// 玩家标记色（岛主旗点 / 卡片边框），顺序对应玩家 id
const PLAYER_COLORS = [0xd9453a, 0x2f7fd0, 0x3aa05a, 0xe0a32e]
// 同一身份色的「文字档」：色相不变、亮度提高，专供 13px 日志正文使用。
// 直接用上面的深色在深棕底上对比度只有 ~4:1，小字号会发闷；这一档 ≈5:1 且仍能一眼认出是谁。
const PLAYER_TEXT_COLORS = ['#ef5a48', '#6cb2f5', '#6bd58f', '#ffc35c']

function mixColor(a, b, t) {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t)
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t)
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t)
  return (r << 16) | (g << 8) | bl
}

const TURN_SECONDS = 30
// 骰面贴图（dice_sheet_trim）的宽高比：96×115，缩放时按此保比例，否则等距立方体会被压扁
const DICE_ASPECT = 115 / 96

function cellColor(cell) {
  if (cell.type === 'island') return PARCHMENT
  const map = {
    go: 0x2e8b6f, event: 0xc9a13b, fruit: 0x7a4bb0, tax: 0xb06a2a,
    port: 0x3f8b5a, jail: 0x4a4a55, history: 0x8a6a3a, laugh_tale: 0xd4af37,
    random_island: 0x4a7099
  }
  return map[cell.type] ?? 0x333333
}

const CELL_NAMES = {
  go: '起点', jail: '推进城', history: '历史正文', laugh_tale: '拉夫德鲁',
  event: '事件', fruit: '果实', tax: '税收', port: '港口', random_island: '随机岛'
}

function cardName(card) {
  // 联机脱敏卡：对手的果实/霸气只下发数量（kind:'hidden'），不暴露具体是什么
  if (card.kind === 'hidden') return '？？？'
  if (card.kind === 'fruit') return FRUIT_BY_ID[card.defId]?.name ?? '恶魔果实'
  if (card.kind === 'haki') return HAKI_BY_ID[card.defId]?.name ?? '霸气'
  return '路标历史正文'
}

function cardDesc(card) {
  if (card.kind === 'hidden') return '对手的暗牌（果实/霸气，不可查看）'
  if (card.kind === 'fruit') return FRUIT_BY_ID[card.defId]?.desc ?? ''
  if (card.kind === 'haki') return HAKI_BY_ID[card.defId]?.desc ?? ''
  return '集齐 4 块并抵达拉夫德鲁即可直接获胜'
}

function cardIcon(card) {
  if (card.kind === 'fruit') return `fruit_${card.defId}`
  if (card.kind === 'haki') return `haki_${card.defId}`
  if (card.kind === 'hidden') return 'card_back'
  return 'cell_history'
}

function playerAssets(state, pl) {
  let v = pl.cash
  pl.islandIds.forEach((id) => {
    const isl = ISLAND_BY_ID[id]
    const st = state.islandState[id]
    v += isl.price + (st?.level ?? 0) * (isl.upgradeCost ?? 0)
  })
  v += getHistoryIds(pl).length * 200
  return v
}

export default class BoardScene extends Phaser.Scene {
  constructor() {
    super('BoardScene')
  }

  create(data) {
    this.socket = this.game.registry.get('socket')
    this.online = !!(data && data.state && !data.solo)
    // 联机座位号（服务器下发）：用于判定「是否我的回合」
    this.mySeat = (data && typeof data.seat === 'number') ? data.seat : null
    if (data && data.state) {
      this.state = data.state
    } else {
      this.state = createGame([
        { id: 0, name: '路飞', charId: 1, tokenIndex: 0 },
        { id: 1, name: '索隆', charId: 2, tokenIndex: 1 },
        { id: 2, name: '娜美', charId: 3, tokenIndex: 2 },
        { id: 3, name: '山治', charId: 4, tokenIndex: 3 }
      ])
    }
    this.animating = false
    this.autoPlay = data && typeof data.autoPlay === 'boolean' ? data.autoPlay : !this.online
    this.tokenSprites = []
    this.victoryShown = false
    this.modal = null
    this.customPanel = null
    this.cardTip = null
    this.turnDeadline = 0
    this.timerKey = ''
    this.autoStepAt = 0

    this.buildUI()
    this.setupKeyboard()

    if (this.online) {
      this.socket.off('game:state')
      this.socket.on('game:state', async (state) => {
        const prev = this.state
        this.state = state
        // 联机也有移动动画：检测「谁从哪走到哪」，补播逐格移动（否则棋子瞬移）
        // 顺序严格为：掷骰动画（点数定格）→ 逐格移动 → 到达反馈
        const mover = this.detectMove(prev, state)
        if (mover) {
          this.animating = true
          const spr = this.tokenSprites[mover.seat]
          if (spr) {
            if (state.lastDice) await this.animateDiceRoll(state.lastDice.d1, state.lastDice.d2)
            await this.animateSteps(spr, mover.from, mover.steps, mover.seat)
          }
          this.animating = false
          // 到达反馈不阻塞结算弹窗，与 refresh 并行
          this.playArrivalFx(mover.seat)
        }
        this.refresh()
      })
      // 联机聊天 / 表情：在对应玩家卡片上冒气泡
      this.socket.off('chat:message')
      this.socket.on('chat:message', (msg) => this.showChatBubble(msg))

      // 有人点了「再来一局」：房间回到未开始的选角阶段，跟随进入选角
      // （本端可能还停在结算面板；game:restart 由任意真人触发，不一定是自己）
      this.socket.off('room:update')
      this.socket.on('room:update', (room) => {
        if (room && !room.started && this.victoryShown) this.scene.start('SelectScene')
      })
    }
    ensureBgm(this)
    onSceneResize(this, (w, h) => {
      if (w === this.W && h === this.H) return
      this.rebuildUI()
    })
    this.refresh()
  }

  // ---------- 布局 ----------
  computeLayout() {
    this.W = this.scale.width
    this.H = this.scale.height
    this.margin = clamp(Math.round(Math.min(this.W, this.H) * 0.03), 16, 32)
    this.gap = 16
    // 桌面 / 横屏为正式布局；竖屏给出明确的“请横屏”提示
    this.portraitBlocked = this.H > this.W
    if (this.portraitBlocked) return

    const panelW = clamp(Math.round(this.W * 0.26), 320, 420)
    const sideW = clamp(Math.round(this.W * 0.16), 184, 240)
    const usableW = this.W - this.margin * 2 - this.gap * 2 - panelW - sideW
    const size = Math.max(240, Math.min(this.H - this.margin * 2 - 8, usableW))
    this.cell = clamp(Math.floor(size / 11), 24, 92)
    const grid = this.cell * 11
    // cellPos 的 X0/Y0 是「底/右行格子中心」，格子带实际占位比 grid 上移半格
    // （顶行上缘 = boardTop - cell/2）→ boardLeft/boardTop 各补半格，让棋盘在窗口居中
    this.boardLeft = this.margin + sideW + this.gap + Math.floor((usableW - grid) / 2) + Math.floor(this.cell / 2)
    this.boardTop = Math.floor((this.H - grid) / 2) + Math.floor(this.cell / 2)
    this.X0 = this.boardLeft + this.cell * 10
    this.Y0 = this.boardTop + this.cell * 10
    this.boardCX = this.X0 - this.cell * 5
    this.boardCY = this.Y0 - this.cell * 5

    this.panel = {
      x: this.W - this.margin - panelW,
      y: this.margin,
      w: panelW,
      h: this.H - this.margin * 2
    }
    // 左栏：玩家资产卡片（参考对标布局）
    this.side = {
      x: this.margin,
      y: this.margin,
      w: sideW,
      h: this.H - this.margin * 2
    }
  }

  cellPos(i) {
    i = ((i % 40) + 40) % 40
    const c = this.cell
    if (i <= 10) return { x: this.X0 - i * c, y: this.Y0 }
    if (i <= 20) return { x: this.X0 - 10 * c, y: this.Y0 - (i - 10) * c }
    if (i <= 30) return { x: this.X0 - 10 * c + (i - 20) * c, y: this.Y0 - 10 * c }
    return { x: this.X0, y: this.Y0 - 10 * c + (i - 30) * c }
  }

  buildUI() {
    this.computeLayout()
    this.drawBackdrop()
    if (this.portraitBlocked) { this.drawRotateNotice(); return }
    this.drawBoard()
    this.createTokens()
    this.buildSide()
    this.buildPanel()
  }

  rebuildUI() {
    this.tweens.killAll()
    this.children.removeAll(true)
    // 窗口尺寸变化重建时清掉本场景注册的 idle 动画（createTokens 会重建同名动画）
    this.anims.remove('idle1-wait'); this.anims.remove('idle2-wait'); this.anims.remove('idle3-wait')
    this.anims.remove('idle4-wait'); this.anims.remove('idle5-wait'); this.anims.remove('idle6-wait')
    this.anims.remove('idle7-wait'); this.anims.remove('idle8-wait'); this.anims.remove('idle9-wait')
    this.anims.remove('idle10-wait')
    this.tokenSprites = []
    this.ownerDots = {}
    this.islandParts = null
    this.islandCard = null
    this.islandCardShield = null
    this.modal = null
    this.customPanel = null
    this.cardTip = null
    this.buttons = {}
    this.playerCards = null
    this.cellPanel = null
    this.cellTxt = null
    this.cellIcon = null
    this.cellMode = null
    this.centerPips = null   // 已移除：正文进度只在左栏玩家卡显示，避免同屏重复
    this.centerPipLabel = null
    this.centerTimerArc = null
    this.centerTimerRing = null
    this.centerTimerArcDrawn = false
    this.diceTotalTxt = null
    this.diceChipRect = null
    if (this.centerAvatarMask) { this.centerAvatarMask.destroy(); this.centerAvatarMask = null }
    this.centerAvatarBaseScale = 1
    this.actionBanner = null
    this.actionBannerBg = null
    this.actionBannerTxt = null
    this._bannerTween = null
    this.logArea = null
    this.logLines = null
    this.logLineObjs = []
    this.logContentH = 0
    this.logNewCount = 0
    this._logCount = 0
    this.logScroll = 0
    this.logPinned = true
    this.logScrollTrack = null
    this.logScrollThumb = null
    this.logWheelZone = null
    this.buildUI()
    this.refresh()
  }

  drawBackdrop() {
    // 深海夜色调压暗背景，让羊皮纸棋盘和木色右栏更突出（参考对标的做法）
    this.add.tileSprite(0, 0, this.W, this.H, 'sea_tile').setOrigin(0, 0)
    this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x0b2038, 0.55)
    this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.14)
  }

  drawRotateNotice() {
    const cx = this.W / 2
    const cy = this.H / 2
    const pw = Math.min(420, this.W - 48)
    makePanel(this, cx, cy, pw, 220)
    this.add.text(cx, cy - 60, '请横屏游玩', textStyle(TYPE.title, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0.5)
    this.add.text(cx, cy - 8, '当前为竖屏，棋盘与操作区无法完整显示。', textStyle(TYPE.bodySmall, COLOR_TEXT.body, { align: 'center', ...wrap(pw - 48) })).setOrigin(0.5)
    this.add.text(cx, cy + 32, '把设备转为横屏后会自动继续当前对局。', textStyle(TYPE.bodySmall, COLOR_TEXT.muted, { align: 'center', ...wrap(pw - 48) })).setOrigin(0.5)
  }

  // ---------- 棋盘 ----------
  drawBoard() {
    const { boardCX: cx, boardCY: cy, cell: c } = this
    const mid = c * 10
    // 中央海面：无缝海浪 + 轻微压暗，把视觉焦点让给中央画框
    const sea = this.add.tileSprite(cx, cy, mid, mid, 'sea_tile')
    sea.setTileScale(0.75)
    this.add.rectangle(cx, cy, mid + 10, mid + 10).setStrokeStyle(5, 0x6b4a2a)
    this.add.rectangle(cx, cy, mid + 2, mid + 2).setStrokeStyle(2, 0xb98a52)
    this.add.rectangle(cx, cy, mid, mid, 0x0b2038, 0.25)
    this.drawCenterpiece(cx, cy, mid, c)

    BOARD.forEach((cell, i) => {
      const { x, y } = this.cellPos(i)
      const isCorner = [0, 10, 20, 30].includes(i)
      const size = c - 2
      const fill = cell.type === 'island'
        ? mixColor(PARCHMENT, SEA_COLOR[ISLAND_BY_ID[cell.islandId].sea], 0.3)
        : cellColor(cell)
      this.drawBevelCell(x, y, size, fill, cell)

      // 格内排版固定为「上方图标 + 下方名牌」两段，名牌框被夹在格子内，
      // 换行/长名字都不会压到相邻格或棋盘外（旧版按 y+c*0.16 起排，第二行直接溢出到格子下方）
      const iconScale = isCorner ? 0.54 : 0.45
      const iconY = y - c * 0.16
      const labelTop = y + c * 0.1
      const boxTop = labelTop
      const boxH = Math.max(7, (y + size / 2 - 3) - labelTop)
      const boxW = size - 8

      if (cell.type === 'island') {
        const isl = ISLAND_BY_ID[cell.islandId]
        const islIcon = this.add.image(x, iconY, `isl${isl.id}`).setDisplaySize(c * iconScale, c * iconScale)
        const fs = clamp(Math.round(c * 0.19), 9, 16)
        const label = this.fitCellLabel(ISLAND_SHORT[isl.id] ?? isl.name, x, boxTop, boxW, boxH, fs, '#3a2812')
        // 名牌底条：保证任何海域色上都读得清（宽度跟着实际名牌走）
        let nameBg = null
        if (label) {
          nameBg = this.add.rectangle(x, label.y + label.height / 2, Math.min(size - 4, label.width + 8), label.height + 1, 0x2a1a0e, 0.2)
          this.children.moveBelow(nameBg, label)
        }
        // 注册岛屿部件：悬停放大只缩图标——名牌是严格贴着格子算出来的，
        // 再放大 18% 会顶出格子（旧版把名牌一起缩放就是这个越界来源）
        if (!this.islandParts) this.islandParts = {}
        islIcon.baseScale = islIcon.scaleX
        this.islandParts[isl.id] = [islIcon]
        // 岛主旗点：一眼看出岛屿归属
        const dot = this.add.circle(x + size / 2 - 8, y - size / 2 + 8, 5, 0xffffff)
          .setStrokeStyle(2, 0xf5ead0).setVisible(false).setDepth(2)
        if (!this.ownerDots) this.ownerDots = {}
        this.ownerDots[isl.id] = dot
        // 点击岛屿：放大 + 详细信息卡（悬停仍有轻量 tooltip）
        this.addIslandClick(x, y, size, cell.islandId)
      } else {
        const key = `cell_${cell.type}`
        if (this.textures.exists(key)) {
          this.add.image(x, iconY, key).setDisplaySize(c * iconScale, c * iconScale)
        }
        const label = CELL_NAMES[cell.type] ?? ''
        if (label) this.fitCellLabel(label, x, boxTop, boxW, boxH, clamp(Math.round(c * 0.17), 10, 13), '#fff3d6')
        if (cell.type !== 'island') this.addCellHit(x, y, size, () => `${CELL_NAMES[cell.type] ?? cell.type}：第 ${i} 格`)
      }
    })
  }

  // 格子名牌自适应：在给定框内按字号从大到小试排（先单行、再自动换行），
  // 宽高都放得下才采用；最小字号 8 仍放不下就整块不画（悬停 tooltip / 岛屿详情卡仍有全名），
  // 绝不把文字排出格子外。
  fitCellLabel(text, x, boxTop, boxW, boxH, maxFs, color) {
    const label = this.add.text(x, boxTop, text, {
      ...textStyle(maxFs, color, { fontStyle: 'bold', align: 'center' })
    }).setOrigin(0.5, 0)
    for (let fs = maxFs; fs >= 8; fs--) {
      label.setFontSize(fs)
      label.setWordWrapWidth(boxW, true)
      label.setText(text)
      if (label.width <= boxW + 0.5 && label.height <= boxH + 0.5) {
        label.setY(boxTop + (boxH - label.height) / 2)
        label.labelFs = fs
        return label
      }
    }
    label.destroy()
    return null
  }

  addCellHit(x, y, size, tipFn) {
    const hit = this.add.rectangle(x, y, size, size, 0xffffff, 0.001).setInteractive({ useHandCursor: false })
    hit.on('pointerover', () => this.showTip(x, y - size * 0.8, tipFn()))
    hit.on('pointerout', () => this.hideTip())
  }

  // 中央航海图核心区 = 指挥台：木质画框内放「谁在行动 + 现在做什么 + 操作按钮」
  // 设计取舍：右栏只留信息（回合 / 当前格 / 日志 / 手牌），真正要点的东西都在视线中心，
  // 不用在大画框与右栏之间来回扫视。羊皮纸太小（小窗口）时自动回落右栏布局。
  drawCenterpiece(cx, cy, mid, c) {
    const F = Math.floor(mid * 0.76)
    this.add.image(cx, cy, 'board_frame').setDisplaySize(F, F)
    const inner = F * 0.33 // 画框内羊皮纸安全半宽

    // 羊皮纸安全矩形：宽 1.86*inner，上下各留 0.94*inner
    const W = inner * 1.86
    const H = inner * 1.88
    const left = cx - W / 2
    const top = cy - H / 2
    this.centerRect = { x: left, y: top, w: W, h: H }
    // 只有画框够大才把操作搬进中央（900×540 这类小窗羊皮纸仅 ~125px 宽，塞不下 6 个按钮）
    this.centerConsole = inner >= 100

    // 先算尺寸再定位：内容块在羊皮纸上垂直居中，避免全部挤在画框上半部
    const gap = clamp(Math.round(inner * 0.05), 4, 8)
    const bannerH = clamp(Math.round(inner * 0.27), 30, 40)
    const btnH = clamp(Math.round(inner * 0.24), 26, 38)

    // ---- 身份块：左头像（外圈倒计时）+ 右名字 / 骰子 / 技能 ----
    const avD = clamp(Math.round(inner * 0.56), 40, 96)
    // 倒计时环画在头像外圈：定位时必须把环的粗细一起算进占位，
    // 否则环会压到木质画框上（旧版按 avD/2 定位，环外沿比羊皮纸左边界还靠外 ~12px）
    const ringR = avD * 0.55 + clamp(Math.round(inner * 0.055), 5, 9)
    const ringW = clamp(Math.round(inner * 0.05), 3, 7)
    const ringOuter = ringR + ringW / 2 + 2 // +2：最后 5 秒脉冲光晕的余量
    const pad = clamp(Math.round(inner * 0.035), 2, 6) // 与羊皮纸左边缘留一点呼吸
    const blockW = ringOuter * 2 + pad

    // 文字列（头像右侧）竖排三行：名字 / 技能状态 / 骰子对 + 点数牌。
    // 旧版把骰面塞在名字同一行右端，这一列只有 ~100px 宽：骰面被压到 18px（看不清点数），
    // 名字也被挤成一两个字一行。骰子独占一行后，两者都能拿到整列宽度。
    const colX = left + blockW + clamp(Math.round(inner * 0.07), 6, 12)
    const colW = Math.max(30, (left + W - 4) - colX)
    const nameSize = clamp(Math.round(inner * 0.145), 12, 22)
    const skillSize = clamp(Math.round(inner * 0.075), 9, 12)
    const nameH = Math.round(nameSize * 1.3)
    const skillH = Math.round(skillSize * 1.45)

    // 骰面边长：理想值 inner*0.30（旧版 0.17，只有十几像素），
    // 再按列宽收缩到「两骰 + 3px 缝」正好放得下；高度按贴图比例（96×115）
    let ds = Math.max(16, Math.min(clamp(Math.round(inner * 0.30), 20, 44), Math.floor((colW - 7) / 2)))
    let dieH = Math.round(ds * DICE_ASPECT)
    let chipH = clamp(Math.round(ds * 0.62) + 2, 16, 30)
    // 身份块高度上限：给横幅与两行按钮留够位置后剩下的部分（-4 是上下呼吸）
    const idBudget = H - (this.centerConsole ? gap + bannerH + gap + btnH * 2 + gap : 0) - 4
    let groupH = 0
    for (;;) {
      groupH = nameH + 2 + skillH + 3 + dieH + 2 + chipH + 6
      if (groupH <= idBudget || ds <= 16) break
      ds -= 2
      dieH = Math.round(ds * DICE_ASPECT)
      chipH = clamp(Math.round(ds * 0.62) + 2, 16, 30)
    }
    const chipW = ds * 2 + 3
    const numFs = clamp(Math.round(chipH * 0.8), 12, 26)
    const idH = Math.max(blockW, groupH)
    const blockH = this.centerConsole
      ? idH + gap + bannerH + gap + (btnH * 2 + gap)
      : idH
    const startY = top + Math.max(0, (H - blockH) / 2)
    const avX = left + pad + ringOuter
    const avY = startY + ringOuter
    this.centerAvatarBg = this.add.circle(avX, avY, avD * 0.55, 0xf2e6c8)
      .setStrokeStyle(3, 0xc9a86a, 0.9)
    this.centerAvatar = this.add.image(avX, avY, 'token1').setDisplaySize(avD, avD)
    this.centerAvatarBaseScale = this.centerAvatar.scaleX
    // 头像裁成圆形：立绘是方形切图，四角会戳出米色圆盘，回合切换的弹跳放大也会把它顶到框外
    if (this.centerAvatarMask) this.centerAvatarMask.destroy()
    this.centerAvatarMask = this.make.graphics({ x: 0, y: 0, add: false })
    this.centerAvatarMask.fillStyle(0xffffff).fillCircle(avX, avY, avD * 0.55)
    this.centerAvatar.setMask(this.centerAvatarMask.createGeometryMask())
    // 点头像 = 看当前行动者的档案（与左栏玩家卡同一入口，对称一致）
    const avHit = this.add.circle(avX, avY, ringR, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true })
    avHit.on('pointerdown', () => this.openPlayerInfo(this.state.current))

    // 回合倒计时：头像外圈环形进度（只用弧长 + 配色表达，不写数字）
    this.centerTimerArc = this.add.graphics()
    this.centerTimerRing = { r: ringR, w: ringW }

    // 三行文字整体在身份块内垂直居中：名字 / 技能 / 骰子 + 点数牌
    let gy = startY + Math.max(0, (idH - groupH) / 2)
    this.centerColW = colW
    this.centerNameFs = nameSize
    this.centerSkillFs = skillSize

    this.centerNameTxt = this.add.text(colX, gy + nameH / 2, '', {
      ...textStyle(nameSize, '#4a3216', { fontStyle: 'bold', stroke: '#f2e6c8', strokeThickness: 2, ...wrap(colW) })
    }).setOrigin(0, 0.5)
    gy += nameH + 2

    this.skillTxt = this.add.text(colX, gy + skillH / 2, '', textStyle(skillSize, '#7a5a20', {
      fontStyle: 'bold', stroke: '#f2e6c8', strokeThickness: 2
    })).setOrigin(0, 0.5)
    gy += skillH + 3

    // 骰子对（左对齐文字列）+ 与两骰等宽的点数牌：掷骰时数字滚动，定格后弹出
    const dieY = gy + dieH / 2
    this.centerDie1 = this.add.image(colX + ds / 2, dieY, 'dice_sheet', 0).setDisplaySize(ds, dieH)
    this.centerDie2 = this.add.image(colX + ds * 1.5 + 3, dieY, 'dice_sheet', 0).setDisplaySize(ds, dieH)

    const chipTop = gy + dieH + 2
    this.diceChipBox = { x: colX, y: chipTop, w: chipW, h: chipH }
    this.diceChipRect = this.add.graphics()
    this.diceChipRect.fillStyle(0x2a1a0e, 0.86).fillRoundedRect(colX, chipTop, chipW, chipH, Math.min(5, chipH / 3))
    this.diceChipRect.lineStyle(1.5, PALETTE.gold, 0.9).strokeRoundedRect(colX, chipTop, chipW, chipH, Math.min(5, chipH / 3))
    this.diceTotalTxt = this.add.text(colX + chipW / 2, chipTop + chipH / 2, '', {
      ...textStyle(numFs, '#ffe6a3', { fontStyle: 'bold' })
    }).setOrigin(0.5)
    // 还没掷过骰：骰面与点数牌一起隐藏（空牌子会被误读成「掷出了空白」）
    if (!this.state.lastDice) { this.diceChipRect.setVisible(false); this.diceTotalTxt.setVisible(false) }

    let y = startY + idH + gap

    // ---- 操作区（中央够大时搬进来）----
    if (this.centerConsole) {
      y = this.buildActionArea(left, y, W, {
        bannerH,
        bannerFont: clamp(Math.round(inner * 0.09), 11, 15),
        gap,
        btnH,
        btnFont: clamp(Math.round(inner * 0.1), 11, 16)
      })
    }
    // 回合数只在右栏顶部显示一次（中央重复写「第 N 回合」属于同屏重复信息）
  }

  // 行动横幅 + 主操作 2×2（上下文切换）
  // 中央画框与小窗回落的右栏共用同一套按钮实例名，refresh 的 setBtn 逻辑无需分支。
  // 次要功能（岛屿/托管/规则/⚙/离船）在右栏顶部工具条（buildPanel），交易走玩家卡点头像。
  buildActionArea(x, y, w, o) {
    const gap = o.gap
    const bannerH = o.bannerH
    this.actionBannerBg = makeRounded(this, w, bannerH, { fill: 0x241505, fillAlpha: 0.8, stroke: PALETTE.gold, strokeAlpha: 0.65, strokeW: 2, r: 12 })
      .setPosition(x + w / 2, y + bannerH / 2)
    this.actionBannerTxt = this.add.text(x + w / 2, y + bannerH / 2, '', textStyle(o.bannerFont, '#fff3d6', {
      fontStyle: 'bold', align: 'center', ...wrap(w - 12)
    })).setOrigin(0.5)
    this.actionBanner = { bg: this.actionBannerBg, txt: this.actionBannerTxt }
    // 记住横幅高度与基准字号：文案换行放不下时自动缩字号（中央画框只有 ~214px 宽）
    this.actionBannerH = bannerH
    this.actionBannerFont = o.bannerFont
    y += bannerH + gap

    // 主操作 2×2：第一行固定「掷骰 | 结束回合」；第二行按阶段切换两对按钮——
    // 买岛决策期显示「购买 | 放弃」，其余阶段显示「技能 | 出航」。
    // 每对按钮占同两个槽位，位次不随阶段跳动；按钮从 3 列变 2 列，宽度多 50%。
    const bw = (w - gap) / 2
    const mk = (col, label, color, cb) => makeButton(this, {
      x: x + bw / 2 + col * (bw + gap), y: y + o.btnH / 2,
      w: bw, h: o.btnH, label, color, fontSize: o.btnFont, onClick: cb
    })
    this.btnRoll = mk(0, '掷 骰', PALETTE.good, () => this.handleRoll())
    this.btnEnd = mk(1, '结束回合', 0x9b6a2f, () => this.handleEnd())
    y += o.btnH + gap
    this.btnBuy = mk(0, '购买', PALETTE.good, () => this.handleBuy())
    this.btnDecline = mk(1, '放弃', PALETTE.neutral, () => this.handleDecline())
    this.btnSkill = mk(0, '技能', PALETTE.purple, () => this.handleSkill())
    this.btnVoyage = mk(1, '出航', PALETTE.danger, () => this.handleVoyage())
    return y + o.btnH
  }

  islandTip(islandId) {
    const isl = ISLAND_BY_ID[islandId]
    const st = this.state.islandState[islandId]
    const owner = st.ownerId == null ? '无主' : this.state.players.find((x) => x.id === st.ownerId).name
    return `${isl.name}｜价格 ${isl.price}\n当前租金 ${isl.rent[st.level]}\n岛主：${owner}（Lv.${st.level}）`
  }

  // 岛屿点击热区：进入放大、离开还原、点击弹信息卡
  addIslandClick(x, y, size, islandId) {
    const hit = this.add.rectangle(x, y, size, size, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => this.zoomIsland(x, y, size, islandId, true))
    hit.on('pointerout', () => this.zoomIsland(x, y, size, islandId, false))
    hit.on('pointerdown', () => this.showIslandCard(x, y, size, islandId))
  }

  // 岛屿格放大/还原：图标与名字一起缓动，带回弹
  zoomIsland(x, y, size, islandId, zoomIn) {
    const isl = ISLAND_BY_ID[islandId]
    const target = zoomIn ? 1.18 : 1
    // 用 this.children 遍历代价高，构建时把岛屿图标存进 map
    const parts = this.islandParts && this.islandParts[islandId]
    if (!parts) return
    for (const obj of parts) {
      this.tweens.add({
        targets: obj, scale: obj.baseScale * target,
        duration: 160, ease: zoomIn ? 'Back.easeOut' : 'Quad.easeOut'
      })
    }
    void isl
  }

  // 岛屿信息卡：租金表 / 垄断组 / 升级费用 / 归属
  // 排版原则：宽度固定 + 高度按内容测出来，所有元素按「量到的高度」逐行下移，
  // 不再靠魔数 y 偏移（旧版标题压住海域行、租金表标签压住 Lv 格子、升级费单行不换行直接顶出卡片）；
  // 位置固定在棋盘中心（有全屏遮罩，点空白关闭），不会压到顶行格子或飞出屏幕。
  showIslandCard(x, y, size, islandId) {
    if (this.islandCard) this.closeIslandCard()
    const s = this.state
    const isl = ISLAND_BY_ID[islandId]
    const st = s.islandState[islandId] || { ownerId: null, level: 0 }
    const group = MONOPOLY_GROUPS.find((g) => g.id === isl.group)
    const ownerPl = st.ownerId == null ? null : s.players.find((pl) => pl.id === st.ownerId)
    void x; void y; void size

    const cw = clamp(Math.round(this.cell * 6.4), 290, 360)
    const pad = 18
    const contentW = cw - pad * 2
    const layer = this.add.container(0, 0).setDepth(650)
    this.islandCard = layer
    const add = (o) => { layer.add(o); return o }

    const seaName = { east: '东海', grand: '伟大航路', new: '新世界' }[isl.sea] || isl.sea
    const ownedCount = group && st.ownerId != null
      ? group.islandIds.filter((id) => (s.islandState[id] || {}).ownerId === st.ownerId).length
      : 0
    const monoTxt = st.ownerId == null
      ? `海域：${seaName} · 无主之岛`
      : `${group ? group.name : '垄断组'} ${ownedCount}/${group ? group.islandIds.length : 0}${group && ownedCount === group.islandIds.length ? ' · 垄断!' : ''}`

    // ---- 顶部：图标 + 岛名（超宽自动缩字号）+ 海域/归属 ----
    const iconSize = 46
    const iconX = pad + iconSize / 2
    const iconY = pad + iconSize / 2
    add(this.add.image(iconX, iconY, `isl${isl.id}`).setDisplaySize(iconSize, iconSize))
    const titleX = pad + iconSize + 12
    const title = add(this.add.text(titleX, pad - 2, isl.name, textStyle(TYPE.section, '#ffe9a8', { fontStyle: 'bold' })).setOrigin(0, 0))
    this.fitTextWidth(title, cw - pad - titleX, TYPE.section, 14)
    const sub = add(this.add.text(titleX, title.y + title.height + 1, monoTxt,
      textStyle(14, st.ownerId == null ? COLOR_TEXT.muted : '#ffd966', { fontStyle: 'bold' })).setOrigin(0, 0))
    this.fitTextWidth(sub, cw - pad - titleX, 14, 11)
    let cur = Math.max(iconY + iconSize / 2, sub.y + sub.height) + 12

    // 分隔线
    add(this.add.rectangle(pad, cur, contentW, 1, PALETTE.gold, 0.4).setOrigin(0, 0.5))
    cur += 14

    // ---- 岛主 / 购置价（左右两端对齐）----
    const ownerName = ownerPl ? ownerPl.name : '无主'
    add(this.add.text(pad, cur, `岛主：${ownerName}${ownerPl ? `（Lv.${st.level}）` : ''}`,
      textStyle(TYPE.bodySmall, ownerPl ? '#ffffff' : COLOR_TEXT.muted)).setOrigin(0, 0))
    add(this.add.text(cw - pad, cur, `购置价 ${isl.price}`,
      monoStyle(15, COLOR_TEXT.gold, { fontStyle: 'bold' })).setOrigin(1, 0))
    cur += 26

    // ---- 租金表：标题独立一行，格子紧接其下（不再互相压盖）----
    add(this.add.text(pad, cur, '租金表', textStyle(13, COLOR_TEXT.gold, { fontStyle: 'bold' })).setOrigin(0, 0))
    cur += 19
    const gap = 6
    const cellW = (contentW - gap * 3) / 4
    const cellH = 42
    isl.rent.forEach((rent, lvl) => {
      const rx = pad + lvl * (cellW + gap)
      const active = lvl === st.level
      add(this.add.rectangle(rx, cur, cellW, cellH, active ? PALETTE.gold : 0x241505, active ? 0.26 : 0.6)
        .setOrigin(0, 0).setStrokeStyle(2, active ? 0xffd966 : 0x5a3a1a))
      add(this.add.text(rx + cellW / 2, cur + 10, ['基础', 'Lv.1', 'Lv.2', 'Lv.3'][lvl],
        textStyle(11, active ? '#ffe9a8' : COLOR_TEXT.muted, { align: 'center' })).setOrigin(0.5))
      add(this.add.text(rx + cellW / 2, cur + cellH - 12, `${rent}`,
        monoStyle(15, active ? '#ffd966' : COLOR_TEXT.body, { fontStyle: 'bold', align: 'center' })).setOrigin(0.5))
    })
    cur += cellH + 14

    // ---- 升级费用（换行，绝不顶出卡片）----
    const upTxt = add(this.add.text(pad, cur, `升级费用：${isl.upgradeCost} 贝利／级，最高 Lv.3`,
      textStyle(14, COLOR_TEXT.body, { ...wrap(contentW) })).setOrigin(0, 0))
    cur += upTxt.height + 6
    const monoTip = add(this.add.text(pad, cur,
      group ? `集齐「${group.name}」${group.islandIds.length} 座岛后，组内租金 ×1.5` : '',
      textStyle(13, COLOR_TEXT.muted, { ...wrap(contentW) })).setOrigin(0, 0))
    cur += monoTip.height + 6
    if (ownerPl) {
      const holdTxt = add(this.add.text(pad, cur,
        `${ownerPl.name} 持有 ${ownerPl.islandIds.length} 座岛屿 · 历史正文 ${getHistoryIds(ownerPl).length}/4`,
        textStyle(13, COLOR_TEXT.muted, { ...wrap(contentW) })).setOrigin(0, 0))
      cur += holdTxt.height + 6
    }

    // ---- 底部提示 + 底板（底板最后建，插到最底层）----
    const hint = add(this.add.text(cw - pad, cur + 6, '点击空白处关闭', textStyle(12, COLOR_TEXT.muted)).setOrigin(1, 0))
    const h = hint.y + hint.height + pad - 4
    const bg = makeRounded(this, cw, h, { fill: 0x1c1206, fillAlpha: 0.96, stroke: PALETTE.gold, strokeW: 3, r: 14 })
      .setInteractive({ hitArea: new Phaser.Geom.Rectangle(-cw / 2, -h / 2, cw, h), hitAreaCallback: Phaser.Geom.Rectangle.Contains })
    layer.addAt(bg, 0)

    // 局部坐标（左上角为原点）平移到以卡片中心为原点，缩放动画才能从中间弹出
    for (const ch of layer.list) { ch.x -= cw / 2; ch.y -= h / 2 }
    bg.setPosition(0, 0)
    layer.setPosition(this.boardCX, this.boardCY)
    const fit = Math.min(1, (this.H - 48) / h, (this.W - 48) / cw)
    this.islandCardFit = fit

    const shield = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.001)
      .setInteractive().setDepth(649)
    shield.once('pointerdown', () => this.closeIslandCard())
    this.islandCardShield = shield

    layer.setScale(fit * 0.72)
    layer.setAlpha(0)
    this.tweens.add({ targets: layer, scale: fit, alpha: 1, duration: 200, ease: 'Back.easeOut' })
  }

  // 单行文字按可用宽度缩字号（标题/说明通用），返回最终字号
  fitTextWidth(txt, maxW, maxFs, minFs = 11) {
    for (let fs = maxFs; fs >= minFs; fs--) {
      txt.setFontSize(fs)
      if (txt.width <= maxW + 0.5) return fs
    }
    return minFs
  }

  // 强制单行：先缩字号，最小字号仍放不下就换更短的备选文案（如「角色名（你）」→「角色名」），
  // 最后才截断加省略号。玩家卡上的名字/资产行必须单行，否则第二行会压到现金行、
  // 并把「🚨进城」顶出卡片下边框。
  fitOneLine(txt, text, maxW, maxFs, minFs = 11, fallbacks = []) {
    const pick = (src) => {
      txt.setWordWrapWidth(Math.max(20, maxW), true)
      for (let fs = maxFs; fs >= minFs; fs--) {
        txt.setFontSize(fs)
        txt.setText(src)
        if (txt.getWrappedText(src).length <= 1 && txt.width <= maxW + 0.5) return true
      }
      return false
    }
    const candidates = [String(text ?? ''), ...fallbacks.filter(Boolean)]
    for (const cand of candidates) if (pick(cand)) return true
    // 全部候选都放不下：拿最短的候选逐字截断
    const shortest = candidates.reduce((a, b) => (b.length < a.length ? b : a))
    txt.setFontSize(minFs)
    for (let n = shortest.length - 1; n > 1; n--) {
      const cut = shortest.slice(0, n) + '…'
      txt.setText(cut)
      if (txt.getWrappedText(cut).length <= 1 && txt.width <= maxW + 0.5) return false
    }
    txt.setText('…')
    return false
  }

  closeIslandCard() {
    if (this.islandCardShield) { this.islandCardShield.destroy(); this.islandCardShield = null }
    if (this.islandCard) { this.islandCard.destroy(); this.islandCard = null }
  }

  updateOwnerDots() {
    if (!this.ownerDots) return
    BOARD.forEach((cell) => {
      if (cell.type !== 'island') return
      const dot = this.ownerDots[cell.islandId]
      if (!dot) return
      const st = this.state.islandState[cell.islandId]
      if (st && st.ownerId != null) {
        dot.setVisible(true).setFillStyle(PLAYER_COLORS[st.ownerId % PLAYER_COLORS.length])
      } else {
        dot.setVisible(false)
      }
    })
  }

  drawBevelCell(x, y, size, fill, cell) {
    this.add.rectangle(x, y, size, size, fill).setStrokeStyle(2, 0x2a1a0e)
    this.add.rectangle(x, y - size / 2 + 1, size - 3, 1, 0xffffff, 0.4)
    this.add.rectangle(x - size / 2 + 1, y, 1, size - 3, 0xffffff, 0.28)
    this.add.rectangle(x, y + size / 2 - 1, size - 3, 1, 0x000000, 0.28)
    this.add.rectangle(x + size / 2 - 1, y, 1, size - 3, 0x000000, 0.32)
    if (cell && cell.type === 'island') {
      const sea = ISLAND_BY_ID[cell.islandId].sea
      this.add.rectangle(x, y - size / 2 + 5, size - 6, 9, SEA_COLOR[sea])
        .setStrokeStyle(1, 0x000000, 0.3)
    }
  }

  // ---------- 棋子 ----------
  createTokens() {
    // 当前格呼吸光圈：提醒玩家棋子所在位置
    this.cellRing = this.add.rectangle(0, 0, this.cell + 8, this.cell + 8)
      .setStrokeStyle(3, 0xffd76a, 0.9).setVisible(false).setDepth(28)
    this.tweens.add({ targets: this.cellRing, alpha: 0.25, yoyo: true, repeat: -1, duration: 550, ease: 'sine.inout' })

    this.state.players.forEach((p, i) => {
      const { x, y } = this.cellPos(0)
      const off = this.tokenOffset(i)
      // 头像跟随所选角色（charId），不再按座位号取
      // 用 sprite 而非 image：棋子要播 idle 呼吸帧动画
      const spr = this.add.sprite(x + off.x, y + off.y, `token${p.charId}`)
        .setDisplaySize(this.cell * 0.5, this.cell * 0.5).setDepth(30)
      this.tokenSprites.push(spr)
      this.attachIdleAnim(spr, p.charId)
    })
  }

  // 棋子 idle 呼吸动画：用 idle{charId} sheet 生成「等待/行动」双动画并循环等待档。
  // 行为设计：始终循环 idle（移动 tween 直接改 x/y 不冲突）；脉冲弹跳等改 scale 的
  // 表现层动画结束后 scale 会复原，也不冲突。素材缺失时静默跳过，回退静态 token。
  attachIdleAnim(spr, charId) {
    const key = `idle${charId}`
    // 注意：Phaser Sprite 的 spr.anims 是内置 AnimationState 组件（恒为 truthy），
    // 不能用它判重；用「动画是否已在播」判断。
    if (!this.textures.exists(key) || spr.anims.isPlaying) return
    const waitKey = `${key}-wait`
    if (!this.anims.exists(waitKey)) {
      this.anims.create({
        key: waitKey,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: 7 }),
        frameRate: 6,
        repeat: -1
      })
    }
    spr.play(waitKey)
  }

  tokenOffset(i) {
    const o = this.cell * 0.18
    return [{ x: -o, y: -o }, { x: o, y: -o }, { x: -o, y: o }, { x: o, y: o }][i]
  }

  // ---------- 右栏 ----------
  buildPanel() {
    const p = this.panel
    const pad = 16
    const left = p.x + pad
    const right = p.x + p.w - pad
    const contentW = p.w - pad * 2
    this.panelContentW = contentW
    // 矮屏（小横屏）紧凑模式：隐藏次要信息行、缩小控件，保证不重叠
    const compact = this.H < 520
    this.compact = compact

    makePanel(this, p.x + p.w / 2, p.y + p.h / 2, p.w, p.h)

    let y = p.y + pad
    // 回合归属（大字）。同屏只出现这一处：中央画框不写回合数。
    // 倒计时由中央头像外圈的环形进度表示（见 drawCenterpiece / updateTimer）
    this.turnTxt = this.add.text(left, y + 2, '', textStyle(TYPE.section, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0, 0)
    // 托管徽标：跟着回合标题走，开启托管时常驻可见
    this.autoBadge = this.add.text(0, y + 3, '🤖 托管中', textStyle(TYPE.caption, COLOR_TEXT.good, { fontStyle: 'bold' }))
      .setOrigin(0, 0).setVisible(false)
    y += 30

    // 功能工具条（右栏顶部右对齐）：岛屿 / 托管 / 规则 / ⚙ / 离船。
    // 不占中央画框：中央只留「现在要做的操作」；交易入口 = 点左栏玩家头像。
    const tbH = 26
    const tbW = 42
    const tbGap = 6
    const mkTb = (i, label, color, cb) => makeButton(this, {
      x: right - tbW / 2 - i * (tbW + tbGap), y: y + tbH / 2,
      w: tbW, h: tbH, label, color, fontSize: TYPE.caption, onClick: cb
    })
    this.btnExit = mkTb(0, '离船', PALETTE.danger, () => this.openQuitConfirm())
    this.btnSettings = mkTb(1, '⚙', 0x4a4a55, () => this.openSettings())
    this.btnRules = mkTb(2, '规则', 0x4a4a55, () => this.openRules())
    this.btnAuto = mkTb(3, '托管', 0x5a3a1a, () => this.toggleAuto())
    this.btnIslands = mkTb(4, '岛屿', 0x2e6da4, () => this.openIslandPanel())
    y += tbH + 8

    // 操作区默认在中央画框（视线中心）；只有画框太小的窗口才回落到右栏
    this.playerTxt = null   // 玩家名在中央，右栏不再重复
    this.cashTxt = null     // 现金只在左栏玩家卡
    this.rollTxt = null     // 骰子点面在中央，文字复述属于重复
    if (!this.centerConsole) {
      y = this.buildActionArea(left, y, contentW, {
        bannerH: compact ? 36 : 44,
        bannerFont: TYPE.body,
        gap: 8,
        btnH: compact ? 28 : 34,
        btnFont: TYPE.caption
      }) + 8
    }

    // 手牌已搬进左栏玩家卡（见 buildSide / renderCardHands）：右栏底部整段让给日志。
    // ---- 弹性区：当前格（决策信息，优先）→ 航海日志（吃掉剩余高度）----
    // 预算制布局：先算可用空间，按 full / mini / 仅日志 逐级降档，保证永不重叠。
    const avail = p.y + p.h - pad - 12 - y
    const CELL_FULL = 92, CELL_MINI = 54, LOG_LABEL = 22, LOG_MIN = 44
    let cellMode = 'none'
    let logH = 0
    let labelH = 0
    const plan = (cellH, withCell) => {
      const rest = avail - (withCell ? cellH + 8 : 0)
      const lh = rest >= LOG_MIN + LOG_LABEL ? LOG_LABEL : 0
      const lg = rest - lh
      return { cellH, withCell, labelH: lh, logH: lg >= LOG_MIN ? lg : 0 }
    }
    const ladder = [
      plan(CELL_FULL, true), plan(CELL_MINI, true),
      { ...plan(0, false), logH: 0 }
    ]
    for (const step of ladder) {
      if (step.withCell && step.logH > 0) { cellMode = step.cellH === CELL_FULL ? 'full' : 'mini'; logH = step.logH; labelH = step.labelH; break }
    }
    if (cellMode === 'none') {
      // 放不下「格 + 日志」时：优先保当前格，其次保日志
      for (const h of [CELL_FULL, CELL_MINI]) {
        if (avail >= h + 8) { cellMode = h === CELL_FULL ? 'full' : 'mini'; break }
      }
      if (cellMode === 'none' && avail >= LOG_MIN) { logH = avail - (avail >= LOG_MIN + LOG_LABEL ? LOG_LABEL : 0); labelH = avail >= LOG_MIN + LOG_LABEL ? LOG_LABEL : 0 }
    }

    if (cellMode !== 'none') {
      const cardH = cellMode === 'full' ? CELL_FULL : CELL_MINI
      const iconS = cellMode === 'full' ? 48 : 30
      this.cellPanel = makePanel(this, p.x + p.w / 2, y + cardH / 2, p.w - 20, cardH, {
        fill: PALETTE.gold, fillAlpha: 0.1, frame: PALETTE.gold, gold: PALETTE.gold
      })
      this.cellIcon = this.add.image(left + 6 + iconS / 2, y + cardH / 2, 'cell_event').setDisplaySize(iconS, iconS)
      this.cellTxt = this.add.text(left + 12 + iconS, y + cardH / 2, '', textStyle(
        cellMode === 'full' ? TYPE.body : TYPE.caption, '#e8dcc4',
        { lineSpacing: 3, ...wrap(contentW - (iconS + 22)) }
      )).setOrigin(0, 0.5)
      this.cellMode = cellMode
      y += cardH + 8
    }

    // 手牌面板已移除：手牌改画在左栏各玩家角色卡右侧（见 buildSide / renderCardHands）

    // 航海日志：高度由预算决定；可滚轮上下翻阅历史，新消息自动贴底
    if (logH > 0) {
      if (labelH > 0) this.sectionLabel(left, y, '航海日志')
      else {
        // 空间不够放标题：改用一条金色细分隔线，日志内容不至于「悬」在卡片下方
        this.add.rectangle(left, y - 4, contentW, 1, PALETTE.gold, 0.35).setOrigin(0, 0.5)
      }
      const logY = y + labelH
      this.logArea = { x: left, y: logY, w: contentW - 10, h: logH }
      // 偏移语义：0=看到最早一行，maxScroll=贴底（最新）。初值给一个超大数，
      // applyLogScroll 会夹到 maxScroll —— 开局就停在最新一条（原实现 0=顶部，
      // 于是"最新日志"永远被裁在可视区下方，看起来像日志不更新）
      this.logScroll = Number.MAX_SAFE_INTEGER
      this.logPinned = true     // 贴底跟随；用户上翻后=false
      // 逐行渲染（每行一个 Text）：行内按「归属角色」上色（每个角色一种色，与卡片边框/岛主圆点同源）。
      // 单个 Text 无法按行变色，池化行对象按需创建，文本不变时不重设。
      this.logLines = this.add.container(0, 0)
      this.logLineObjs = []
      // 可视窗口用几何遮罩裁剪。不能用 setCrop：高 DPI（main.js 补丁）下文字纹理按
      // DPR 渲染，setCrop 的纹理像素坐标与文字显示坐标（CSS）不一致，会让日志放大
      // res 倍、每行容纳字数减半、长句被截断。遮罩走世界坐标，与分辨率无关。
      this.logMaskGfx = this.make.graphics()
      this.logMaskGfx.fillStyle(0xffffff, 1)
      this.logMaskGfx.fillRect(left, logY, contentW - 10, logH)
      this.logLines.setMask(this.logMaskGfx.createGeometryMask())
      // 滚动条：右侧细槽 + 滑块，直观显示当前可视窗口位置
      const trackX = left + contentW - 4
      this.logScrollTrack = this.add.rectangle(trackX, logY + logH / 2, 3, logH, 0x000000, 0.35).setOrigin(0.5)
      this.logScrollThumb = this.add.rectangle(trackX, logY + logH / 2, 3, logH, PALETTE.gold, 0.9).setOrigin(0.5)
      // 「↓ N 条新消息」浮标：上翻看历史期间来了新日志时出现，点一下跳回最新
      const chipW = 108, chipH = 22
      this.logNewChipBg = this.add.rectangle(right - chipW / 2 - 2, logY + logH - chipH / 2 - 3, chipW, chipH, 0x1a4a2a, 0.95)
        .setStrokeStyle(1, 0x7cfc8a, 0.8).setVisible(false)
      this.logNewChipTxt = this.add.text(right - chipW / 2 - 2, logY + logH - chipH / 2 - 3, '', textStyle(12, '#a8ffb8', { fontStyle: 'bold' })).setOrigin(0.5).setVisible(false)
      this.logNewChipBg.setInteractive({ useHandCursor: true })
      this.logNewChipBg.on('pointerdown', () => {
        this.logPinned = true
        this.logNewCount = 0
        this.logScroll = Number.MAX_SAFE_INTEGER
        this.applyLogScroll()
        this.updateLogChip()
      })
      // 滚轮热区：盖住日志区域，优先级高于棋盘
      this.logWheelZone = this.add.rectangle(left + (contentW - 10) / 2, logY + logH / 2, contentW - 6, logH, 0xffffff, 0.001)
        .setInteractive()
      this.logWheelZone.on('wheel', (_p, _dx, dy) => this.scrollLog(dy))
      this.logWheelZone.on('pointerdown', () => { /* 占位：吃掉点击，避免穿透到棋盘格 */ })
    }

    this.buttons = {
      roll: this.btnRoll, end: this.btnEnd, buy: this.btnBuy, decline: this.btnDecline,
      skill: this.btnSkill, voyage: this.btnVoyage, islands: this.btnIslands,
      rules: this.btnRules, auto: this.btnAuto
    }
  }

  // ---------- 左栏：玩家资产卡片 ----------
  buildSide() {
    const s = this.side
    makePanel(this, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h)
    const pad = 12
    this.add.text(s.x + pad, s.y + pad, '航海士 · 贝利', textStyle(TYPE.caption, COLOR_TEXT.gold, { fontStyle: 'bold' })).setOrigin(0, 0)
    this.add.rectangle(s.x + pad, s.y + pad + 15, 28, 1, PALETTE.gold, 0.5).setOrigin(0, 0)

    const players = this.state.players
    const n = Math.max(1, players.length)
    const top = s.y + pad + 26
    // 底部预留 56px 给「💬 互动」入口；卡片间距 8，卡片间不留大空白
    const reserve = 56
    const gapY = 8
    const cardH = Math.floor((s.h - pad * 2 - 26 - reserve - (n - 1) * gapY) / n)
    // 重建时先清掉旧头像的补间动画，避免指向已销毁对象
    if (this.playerCards) this.playerCards.forEach((c) => {
      if (c.pulseTween) { c.pulseTween.stop(); c.pulseTween.remove() }
      if (c.glowTween) { c.glowTween.stop(); c.glowTween.remove() }
    })

    this.playerCards = players.map((pl, i) => {
      const w = s.w - pad * 2
      const cy = top + cardH * i + cardH / 2 + i * gapY
      const ch = cardH - 4
      const cx = s.x + pad + w / 2
      const bg = makeRounded(this, w, ch, {
        fill: 0x241505, fillAlpha: 0.55,
        stroke: PLAYER_COLORS[i % PLAYER_COLORS.length], strokeAlpha: 0.85, strokeW: 2, r: 14
      }).setPosition(cx, cy)
      // 高卡片：头像居中放大；矮卡片：横排紧凑
      // 头像尺寸必须受「名字 + 现金 + 资产」三行占位约束，否则高卡片上头像会顶到现金行
      //（4 人局 820 高时卡片≈160，旧算法放到 128 会压住「2000 贝利」）
      const showStat = ch >= 74
      const bandTop = cy - ch / 2 + 8 + 26 + 22 + 4   // 名字行 + 现金行之后
      const bandBottom = cy + ch / 2 - (showStat ? 26 : 10)
      const avSize = clamp(Math.floor(Math.min(bandBottom - bandTop, ch - 68, w - 32)), 44, 128)
      const vertical = ch >= 124
      const avX = vertical ? cx : s.x + pad + 28
      const avY = vertical ? (bandTop + bandBottom) / 2 : cy
      // 右侧手牌区：角色头像右边的框内贴 mini 卡（有手牌才画，无手牌整区隐藏）。
      // 宽度按卡片自适应，绝不越出卡片边框。
      const zoneW = w >= 176 ? 62 : 50
      const zoneRight = cx + w / 2 - 5
      const zoneLeft = zoneRight - zoneW
      const handC = this.add.container(0, 0)
      const glow = this.add.ellipse(avX, avY, avSize * 1.7, avSize * 1.7, 0xffd966, 0.3).setVisible(false)
      // 左栏用 256px 高清半身像（token 只有 64px，放大发糊）
      const avatar = this.add.image(avX, avY, `portrait_${pl.charId}`).setDisplaySize(avSize, avSize)
      // 状态徽标（🚨进城 / ❄冰冻）挂在头像角上：卡片文字区太窄，塞不进文字标签时也能一眼看到
      const badgeTxt = this.add.text(avX + avSize * 0.42, avY + avSize * 0.38, '', textStyle(13, '#fff3d6', {
        fontStyle: 'bold', stroke: '#1b0f05', strokeThickness: 4
      })).setOrigin(0.5).setDepth(4)
      let nameTxt, cashTxt, statTxt
      let nameMaxW, statMaxW
      if (vertical) {
        // 两行制：①角色名（大）②贝利（等宽金色）；资产合并到名字行右侧小字。
        // 手牌区占掉右侧 ~60px：文字 wrap 收窄，不许压进手牌框
        nameMaxW = w - zoneW - 14
        statMaxW = w - 12
        nameTxt = this.add.text(cx - zoneW / 2 + 2, cy - ch / 2 + 8, '', textStyle(TYPE.section, COLOR_TEXT.title, { fontStyle: 'bold', align: 'center', ...wrap(nameMaxW) })).setOrigin(0.5, 0)
        cashTxt = this.add.text(cx - zoneW / 2 + 2, cy - ch / 2 + 38, '', monoStyle(TYPE.body, COLOR_TEXT.gold, { fontStyle: 'bold', align: 'center' })).setOrigin(0.5, 0)
        statTxt = this.add.text(cx, cy + ch / 2 - 22, '', textStyle(TYPE.caption, COLOR_TEXT.muted, { align: 'center', ...wrap(statMaxW) })).setOrigin(0.5, 0)
      } else {
        const tx = s.x + pad + 54
        const textW = zoneLeft - tx - 6
        nameMaxW = Math.max(60, textW)
        statMaxW = nameMaxW
        nameTxt = this.add.text(tx, cy - ch / 2 + 8, '', textStyle(TYPE.body, COLOR_TEXT.title, { fontStyle: 'bold', ...wrap(nameMaxW) })).setOrigin(0, 0)
        cashTxt = this.add.text(tx, cy - ch / 2 + 32, '', monoStyle(TYPE.body, COLOR_TEXT.gold, { fontStyle: 'bold' })).setOrigin(0, 0)
        statTxt = this.add.text(tx, cy + ch / 2 - 22, '', textStyle(TYPE.caption, COLOR_TEXT.muted, { ...wrap(statMaxW) })).setOrigin(0, 0)
      }
      if (ch < 74) statTxt.setVisible(false) // 卡片太矮时隐藏资产行，避免与现金重叠
      // 整卡可点：弹玩家详情；他人的详情里可直接「发起交易」（交易主入口，不占中央按钮位）
      const hit = this.add.rectangle(cx, cy, w, ch, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: true }).setDepth(1)
      hit.on('pointerdown', () => this.openPlayerInfo(i))
      // 手牌区层级高于整卡热区：点小卡要打开「卡牌详情」，而不是玩家档案
      handC.setDepth(3)
      return { bg, glow, avatar, badgeTxt, nameTxt, cashTxt, statTxt, hit, handC, zoneW, zoneRight, cy, ch, nameMaxW, statMaxW, vertical, nameFs: vertical ? TYPE.section : TYPE.body, cx, w }
    })

    // 快捷互动入口：表情 / 短语，联机广播、单机本地冒泡
    this.btnChat = makeButton(this, {
      x: s.x + s.w / 2, y: s.y + s.h - pad - 20, w: s.w - pad * 2 - 4, h: 40,
      label: '💬 互动', color: PALETTE.wood, fontSize: TYPE.bodySmall,
      onClick: () => openQuickChat(this, {
        socket: this.online ? this.socket : null,
        selfId: this.state.current,
        onLocal: (m) => this.showChatBubble({ ...m, from: this.state.current })
      })
    })
  }

  sectionLabel(x, y, label) {
    this.add.text(x, y, label, textStyle(TYPE.caption, COLOR_TEXT.gold, { fontStyle: 'bold' })).setOrigin(0, 0)
    this.add.rectangle(x, y + 15, 28, 1, PALETTE.gold, 0.5).setOrigin(0, 0)
  }

  showTip(x, y, text) {
    this.hideTip()
    const t = this.add.text(x, y, text, textStyle(TYPE.caption, '#fff3d6', { align: 'center', lineSpacing: 3, ...wrap(180) }))
      .setOrigin(0.5, 1).setDepth(400)
    const bg = this.add.rectangle(x, y, t.width + 16, t.height + 10, PALETTE.woodDark, 0.95)
      .setStrokeStyle(2, PALETTE.gold).setDepth(399)
    bg.setPosition(x, y - (t.height + 10) / 2)
    this.cardTip = { bg, t }
  }

  hideTip() {
    if (this.cardTip) { this.cardTip.bg.destroy(); this.cardTip.t.destroy(); this.cardTip = null }
  }

  // ---------- 输入 ----------
  setupKeyboard() {
    this.onKeyDown = (e) => {
      if (e.repeat) return
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (this.state.phase === 'awaitRoll') this.handleRoll()
          else if (this.state.phase === 'awaitAction') this.handleEnd()
          break
        case 'KeyY': this.handleBuy(); break
        case 'KeyN': this.handleDecline(); break
        case 'KeyA': this.toggleAuto(); break
        case 'KeyI': this.openIslandPanel(); break
        case 'KeyR': this.openRules(); break
      }
    }
    window.addEventListener('keydown', this.onKeyDown)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onKeyDown)
    })
  }

  toggleAuto() {
    // 联机：托管是服务器行为（把该座位交给 AI 代打），本地开关无效
    if (this.online) {
      const next = !this.autoPlay
      emitAck(this, this.socket, 'game:autoplay', { on: next }, (res) => {
        if (!res.ok) return showToast(this, res.error || '托管设置失败')
        this.autoPlay = next
        showToast(this, next ? '已交给 AI 代打（再点一次接管）' : '已接管，回到手动操作')
        this.refresh()
      })
      return
    }
    this.autoPlay = !this.autoPlay
    showToast(this, this.autoPlay ? '已开启 AI 托管（A 键切回手动）' : '已切回手动操作')
    this.refresh()
  }

  // 离船确认：自绘遮罩层（showModal 会被 refresh 按对局状态重绘，不适合做客户端确认）
  openQuitConfirm() {
    if (this._quitLayer) return
    const layer = this.add.container(0, 0).setDepth(1000)
    this._quitLayer = layer
    layer.add(this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.72)
      .setInteractive()) // 挡住底下所有点击
    const pw = Math.min(460, this.W - 64)
    const ph = 220
    layer.add(makePanel(this, this.W / 2, this.H / 2, pw, ph, { fill: 0x1c1206, fillAlpha: 0.96 }))
    layer.add(this.add.text(this.W / 2, this.H / 2 - ph / 2 + 26, '⚓ 离船确认', textStyle(TYPE.title, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0.5, 0))
    const body = this.online
      ? '联机对局中离开将放弃本局，\n其他玩家会继续游戏。'
      : '单机进度不会保存，\n确定要返回大厅吗？'
    layer.add(this.add.text(this.W / 2, this.H / 2 - 18, body, textStyle(TYPE.body, COLOR_TEXT.body, { align: 'center', lineSpacing: 6 })).setOrigin(0.5, 0))
    const leave = makeButton(this, {
      x: this.W / 2 - 92, y: this.H / 2 + ph / 2 - 44, w: 150, h: 46,
      label: '返回大厅', color: PALETTE.danger, fontSize: TYPE.body,
      onClick: () => {
        this._quitLayer = null
        if (this.online) {
          // 告诉服务器主动退出：座位转 AI；大厅进入 lobbyMode，
          // 不再接受该房间随后的 game:state 广播（否则会被立刻拽回棋盘）
          emitAck(this, this.socket, 'room:leave', {}, () => {})
          localStorage.removeItem('op_game_old_id')
          // 离船后彻底离开房间流程，回大厅主界面（不再进该房间的选角页）
          this.roomData = null
          this.scene.start('LobbyScene', { lobbyMode: true })
        } else {
          this.scene.start('LobbyScene')
        }
      }
    })
    const stay = makeButton(this, {
      x: this.W / 2 + 92, y: this.H / 2 + ph / 2 - 44, w: 150, h: 46,
      label: '继续对局', color: PALETTE.good, fontSize: TYPE.body,
      onClick: () => { layer.destroy(); this._quitLayer = null }
    })
    layer.add(leave.root)
    layer.add(stay.root)
    this.playSfx('sfx_button_click', 0.6)
  }

  // 对局内设置：直接调全局入口，调完立即把音量/BGM 应用到当前场景
  openSettings() {
    const opener = this.game.registry.get('openSettings')
    if (!opener) return showToast(this, '设置暂不可用')
    opener(this, {
      onClose: () => {
        ensureBgm(this)
        this.refresh()
      }
    })
  }

  // 联机：是否轮到我（座位号未知时按「能操作」处理，避免误锁死）
  myTurn() {
    if (!this.online || this.mySeat == null) return true
    return this.state.current === this.mySeat
  }

  // ---------- 动作 ----------
  act(event, extra = {}) {
    if (this.online) {
      // 不是自己的回合：明确提示，而不是把请求发到服务器吃「还没轮到你」
      if (!this.myTurn()) {
        const p = getCurrentPlayer(this.state)
        showToast(this, `等待 ${p.name} 行动…`)
        return
      }
      // 断线时不再静默：给出明确反馈，避免“点了没反应”
      if (!this.socket || !this.socket.connected) {
        showToast(this, '已断开服务器，正在重连…')
        return
      }
      // 超时提示带 12s 冷却：网络抖动时不再反复弹窗刷屏
      const now = Date.now()
      if (!this._netWarnAt || now - this._netWarnAt > 12000) this._netWarnAt = now
      const warn = () => {
        if (Date.now() - this._netWarnAt < 11000) showToast(this, '服务器无响应，请稍候重试')
      }
      const timer = this.time.delayedCall(5000, warn)
      this.socket.emit(event, extra, (res) => {
        timer.remove(false)
        if (res && res.error) showToast(this, res.error)
      })
      return
    }
    const map = {
      'game:roll': () => roll(this.state),
      'game:buy': () => buy(this.state),
      'game:decline': () => declineBuy(this.state),
      'game:buyHistory': () => buyHistory(this.state),
      'game:declineHistory': () => declineHistory(this.state),
      'game:endTurn': () => endTurn(this.state),
      'game:useSkill': () => useSkill(this.state),
      'game:voyage': () => finalVoyage(this.state)
    }
    if (map[event]) {
      const r = map[event]()
      // 单机同样把引擎拒绝原因显式提示，避免“点了没反应”式静默失败
      if (r && r.error) showToast(this, r.error)
    }
    this.refresh()
  }

  async handleRoll() {
    if (this.animating || this.state.phase !== 'awaitRoll') return
    if (this.online) { this.act('game:roll'); return }
    const p = getCurrentPlayer(this.state)
    const from = p.position
    const result = roll(this.state)
    if (result.error) return
    if (result.status === 'frozen') {
      // 冰冻跳过回合：在当前玩家棋子上播放冰冻特效，强化"被冻住"的因果
      const seat = this.state.players.indexOf(p)
      if (seat >= 0) this.fxAtPlayer('fx_ice', seat, { scale: 1.7 })
      this.playSfx('sfx_storm', 0.5)
      this.refresh()
      return
    }
    this.animating = true
    this.playSfx('sfx_dice_roll')
    if (result.dice) {
      await this.animateDiceRoll(result.dice.d1, result.dice.d2)
      if (result.dice.isDoubles) this.playSfx('sfx_dice_doubles')
    }
    if (result.status === 'jailed') {
      await this.animateTeleport(p, from, p.position)
    } else if (result.status !== 'jailStay') {
      await this.animateSteps(p, from, result.dice.total)
    }
    this.animating = false
    this.refresh()
    // 单机同样给到达反馈（与购买/事件弹窗并行，纯表现层）
    const seat = this.state.players.indexOf(p)
    if (seat >= 0 && result.status !== 'jailStay') this.playArrivalFx(seat)
  }

  // 动画速度系数：设置里选「AI 快速行动」时整体缩短（含掷骰与移动）
  fxScale() {
    return loadSettings().fastAI ? 0.55 : 1
  }

  // 中央点数牌：total=null 表示还没掷过骰（整块牌子隐藏）
  // highlight=true 用在定格瞬间：数字放大回弹 + 亮一档颜色，眼睛能从滚动的数字里锁定结果
  setDiceTotal(total, highlight = false) {
    if (!this.diceTotalTxt || !this.diceChipRect) return
    const has = total != null
    this.diceChipRect.setVisible(has)
    this.diceTotalTxt.setVisible(has)
    if (!has) { this.diceTotalTxt.setText(''); return }
    this.diceTotalTxt.setText(String(total))
    this.tweens.killTweensOf(this.diceTotalTxt)
    if (highlight) {
      this.diceTotalTxt.setColor('#fff8dc').setScale(1)
      this.tweens.add({
        targets: this.diceTotalTxt, scale: { from: 1.55, to: 1 },
        duration: Math.round(220 * this.fxScale()), ease: 'Back.easeOut'
      })
      this.time.delayedCall(Math.round(420 * this.fxScale()), () => {
        if (this.diceTotalTxt) this.diceTotalTxt.setColor('#ffe6a3')
      })
    } else {
      this.diceTotalTxt.setColor('#ffe6a3').setScale(1)
    }
  }

  // 掷骰动画：中央大骰子 + 右栏小骰子快速变面并随机抖动，点数牌同步滚动，最后定格结果并弹跳
  // 返回 Promise：resolve 时点数已定格并展示 ≥600ms，调用方可安心开始移动
  animateDiceRoll(d1, d2) {
    return new Promise((resolve) => {
      this.diceAnimating = true
      const pairs = []
      if (this.centerDie1) pairs.push([this.centerDie1, this.centerDie2])
      if (this.die1) pairs.push([this.die1, this.die2])
      for (const [a, b] of pairs) { a.setAlpha(1); b.setAlpha(1) }
      const randFrame = () => Math.floor(Math.random() * 6)
      let ticks = 0
      const k = this.fxScale()
      const timer = this.time.addEvent({
        delay: Math.round(70 * k), repeat: 11,
        callback: () => {
          for (const [a, b] of pairs) { a.setVisible(true); b.setVisible(true) }
          ticks++
          const last = ticks >= 12
          const f1 = last ? d1 : randFrame() + 1
          const f2 = last ? d2 : randFrame() + 1
          for (const [a, b] of pairs) {
            a.setFrame(f1 - 1).setAngle(last ? 0 : Math.random() * 32 - 16)
            b.setFrame(f2 - 1).setAngle(last ? 0 : Math.random() * 32 - 16)
          }
          // 点数牌跟着滚：翻滚期间显示「当前两个骰面的和」，定格时才弹出真结果
          this.setDiceTotal(f1 + f2, last)
          if (last) {
            for (const [a, b] of pairs) {
              // 骰面已按 96×115 保比例缩放 → scaleX ≠ scaleY，弹跳必须两个轴分别给值，
              // 否则 tween 结束会把 scaleY 拉成 scaleX，骰子被压扁（旧版贴图是方的不会暴露）
              for (const o of [a, b]) {
                const bx = o.scaleX
                const by = o.scaleY
                this.tweens.add({
                  targets: o, scaleX: bx * 1.18, scaleY: by * 1.18,
                  duration: Math.round(140 * k), yoyo: true, ease: 'Quad.easeOut'
                })
              }
            }
            this._diceAnnounced = `${d1},${d2}`
            // 点数合计不再另起大字：中央已有骰面 + 行动横幅，第三处复述属于同屏重复
            // 定格展示 650ms（快速 360ms）后才允许移动开始
            const settle = Math.round(650 * k)
            this.time.delayedCall(settle, () => { this.diceAnimating = false; resolve() })
          }
        }
      })
    })
  }

  // 聊天 / 表情气泡：落在发送者卡片上方；发送者不在本局则落到中央提示
  showChatBubble(msg) {
    if (!msg) return
    const card = this.playerCards && this.playerCards[msg.from]
    if (card) {
      showBubble(this, card.bg.x, card.bg.y - card.bg.height / 2 - 6, msg.value)
      return
    }
    if (this.boardCX) showBubble(this, this.boardCX, this.boardCY + this.cell * 2, `${msg.name}：${msg.value}`)
  }

  // ---------- 即时反馈层：数值飘字 / 格子闪光 ----------
  // 规格：飘字 24px 描边，1 揭示上升 40px / 900ms 淡出；格子闪光 760ms 单向消散；层级 480 / 600（浮层之上、结算之下）
  floatText(x, y, text, color = COLOR_TEXT.gold, size = TYPE.number) {
    const t = this.add.text(x, y, text, textStyle(size, color, { fontStyle: 'bold', stroke: '#1a0e06', strokeThickness: 4 }))
      .setOrigin(0.5).setDepth(600)
    this.tweens.add({ targets: t, y: y - 40, duration: 900, ease: 'Cubic.easeOut' })
    this.tweens.add({ targets: t, alpha: 0, delay: 380, duration: 520, ease: 'Quad.easeIn', onComplete: () => t.destroy() })
    this.tweens.add({ targets: t, scale: { from: 0.6, to: 1 }, duration: 240, ease: 'Back.easeOut' })
    return t
  }

  flashCell(index, color = 0xffd966) {
    const { x, y } = this.cellPos(index)
    const r = this.add.rectangle(x, y, this.cell, this.cell, color, 0.26)
      .setStrokeStyle(3, color, 0.9).setDepth(480)
    this.tweens.add({ targets: r, alpha: 0, duration: 760, ease: 'Quad.easeOut', onComplete: () => r.destroy() })
  }

  cellOfIsland(islandId) {
    return BOARD.findIndex((c) => c.type === 'island' && c.islandId === islandId)
  }

  // 每次刷新时对比上一帧：现金变化 → 卡片飘字；新置岛屿 → 格子绿色闪光 + 「购入！」；收支互补 → 判定为租金
  trackFeedback(s) {
    if (!this._prevCash) { this._prevCash = new Map(); this._prevIslands = new Map() }
    if (!this._prevBankrupt) this._prevBankrupt = new Map()
    const rows = []
    s.players.forEach((pl, i) => {
      const prevCash = this._prevCash.get(pl.id)
      const prevIsl = this._prevIslands.get(pl.id) || []
      const wasBankrupt = this._prevBankrupt.get(pl.id)
      this._prevCash.set(pl.id, pl.cash)
      this._prevIslands.set(pl.id, pl.islandIds.slice())
      this._prevBankrupt.set(pl.id, !!pl.bankrupt)
      if (prevCash === undefined) return // 首帧不飘字
      rows.push({
        pl, i, d: pl.cash - prevCash,
        added: pl.islandIds.filter((id) => !prevIsl.includes(id)),
        justBankrupt: pl.bankrupt && !wasBankrupt
      })
    })

    rows.forEach(({ i, d, added, justBankrupt }) => {
      if (d !== 0) this.floatCashDelta(i, d)
      if (justBankrupt) this.floatBankrupt(i)
      added.forEach((id) => {
        const idx = this.cellOfIsland(id)
        if (idx < 0) return
        this.flashCell(idx, 0x7cfc8a)
        this.fxAtCell('fx_coin_burst', idx, { scale: 1.8 }) // 买岛爆金币
        const pos = this.cellPos(idx)
        this.floatText(pos.x, pos.y, '购入！', COLOR_TEXT.good, TYPE.bodySmall)
      })
    })

    const pay = rows.find((r) => r.d < 0)
    const gain = rows.find((r) => r.d > 0)
    if (pay && gain && pay.d + gain.d === 0) {
      this.playSfx('sfx_rent_pay', 0.6)
      this.flashCell(this.state.players[pay.i].position, 0xff8f7a)
      this.fxAtPlayer('fx_coin_burst', gain.i, { scale: 1.5 }) // 收租方爆金币
      const pos = this.cellPos(this.state.players[pay.i].position)
      this.floatText(pos.x, pos.y + this.cell * 0.3, `租金 ${-pay.d}`, COLOR_TEXT.danger, TYPE.bodySmall)
    }
  }

  // 破产：卡片飘字 + 失败音效 + 卡片压暗，让"出局"这件事有明确收尾
  floatBankrupt(i) {
    const card = this.playerCards && this.playerCards[i]
    if (!card) return
    this.floatText(card.bg.x, card.bg.y + 6, '💥 破产', COLOR_TEXT.danger, TYPE.title)
    card.bg.setStyle({ fill: 0x140d04, fillAlpha: 0.8 })
    this.fxAtPlayer('fx_slash', i, { scale: 1.4 }) // 破产斩击（出局视觉锚点）
    this.playSfx('sfx_defeat', 0.8)
  }

  floatCashDelta(i, d) {
    const card = this.playerCards && this.playerCards[i]
    if (!card) return
    const t = card.cashTxt
    const centered = t.originX === 0.5
    const x = centered ? t.x + 66 : t.x + Math.min(t.width + 18, 96)
    this.floatText(x, t.y + 10, `${d > 0 ? '+' : ''}${d}`, d > 0 ? COLOR_TEXT.good : COLOR_TEXT.danger)
  }

  handleBuy() {
    // 弹窗在 awaitBuyHistory 阶段复用「购买」按钮：按当前阶段路由到正确指令
    // （曾因固定发 game:buy 被引擎阶段守卫拒绝，表现为“点击无效”）
    if (this.state.phase === 'awaitBuyHistory') return this.handleBuyHistory()
    this.playSfx('sfx_buy')
    this.act('game:buy')
  }

  handleBuyHistory() {
    this.playSfx('sfx_buy')
    this.act('game:buyHistory')
  }

  handleDecline() {
    if (this.state.phase === 'awaitBuyHistory') { this.act('game:declineHistory'); return }
    this.act('game:decline')
  }
  // 花花果实：确认刚抽到的事件是否生效（PRD §4.1）
  handleFlower(accept) {
    if (this.online) { this.act('game:flowerEvent', { accept: !!accept }); return }
    const r = decisionFlower(this.state, !!accept)
    if (r && r.error) showToast(this, r.error)
    this.refresh()
  }

  handleSkill() { this.playSfx('sfx_fruit_use'); this.act('game:useSkill') }
  handleVoyage() { this.playSfx('sfx_coin_burst'); this.act('game:voyage') }
  handleEnd() { this.act('game:endTurn') }

  handlePlayCard(card) {
    const s = this.state
    if (s.phase !== 'awaitAction' || getCurrentPlayer(s).cardsUsedThisTurn >= 1) return
    // 见闻色（PRD §4.2）：主动使用 = 预览下一格；「取消负面事件」是抽卡时的自动询问。
    // 直接点「使用」不再静默无效，先弹二选一确认。
    if (card.kind === 'haki' && card.defId === 'observation') {
      this.confirmObservationPreview(card)
      return
    }
    if (this.online) {
      const evt = card.kind === 'fruit' ? 'game:useFruit' : 'game:useHaki'
      // 出牌特效即时播放（当前玩家身上）：霸气闪电 / 果实用斩击，不等服务器回包
      const seat = s.players.indexOf(getCurrentPlayer(s))
      this.fxAtPlayer(card.kind === 'haki' ? 'fx_haki_lightning' : 'fx_slash', seat, { scale: 1.9 })
      this.socket.emit(evt, { uid: card.uid }, () => {})
      return
    }
    const seat = s.players.indexOf(getCurrentPlayer(s))
    if (card.kind === 'fruit') {
      const r = useFruit(s, card.uid)
      if (!r.error) { this.playSfx('sfx_fruit_use'); this.fxAtPlayer('fx_slash', seat, { scale: 1.9 }) }
    } else if (card.kind === 'haki') {
      const r = useHaki(s, card.uid)
      if (!r.error) { this.playSfx('sfx_haki'); this.fxAtPlayer('fx_haki_lightning', seat, { scale: 1.9 }) }
    }
    this.refresh()
  }

  // 见闻色主动使用确认：预览下一格（消耗卡）或收手保留
  confirmObservationPreview(card) {
    this.closeCustomPanel()
    this.customPanel = buildModal(this, {
      title: '见闻色霸气', icon: 'haki_observation',
      body: '主动使用：消耗这张见闻色，预览下一格情报。\n若留着它，抽到负面事件时也可用它取消。',
      buttons: [
        { label: '🔮 预览下一格', color: PALETTE.blue, onClick: () => { this.closeCustomPanel(); this.doPreview(card) } },
        { label: '收手保留', color: PALETTE.neutral, onClick: () => this.closeCustomPanel() }
      ]
    })
  }

  doPreview(card) {
    this.playSfx('sfx_haki')
    if (this.online) {
      this.socket.emit('game:useHaki', { uid: card.uid, action: 'preview' }, (res) => {
        if (res && res.error) return showToast(this, res.error)
        if (res && res.result && res.result.preview) this.showPreviewPanel(res.result.preview)
      })
      return
    }
    const s = this.state
    const r = useHaki(s, card.uid, 'preview')
    if (r && r.error) { showToast(this, r.error); this.refresh(); return }
    if (r && r.preview) this.showPreviewPanel(r.preview)
    this.refresh()
  }

  // 见闻色预览结果：下一格类型 / 岛屿归属与租金
  showPreviewPanel(preview) {
    const cell = preview.cell || BOARD[preview.position]
    const typeNames = CELL_NAMES[cell.type] || '普通格'
    const lines = [`位置 ${preview.position}：${typeNames}`]
    if (cell.type === 'island' && cell.islandId != null) {
      const isl = ISLAND_BY_ID[cell.islandId]
      const st = this.state.islandState[cell.islandId] || {}
      if (isl) {
        lines.splice(0, 1, `位置 ${preview.position}：「${isl.name}」（${isl.price} 贝利）`)
        if (st.ownerId == null) lines.push('无主岛屿：落下可购买')
        else {
          const owner = this.state.players.find((x) => x.id === st.ownerId)
          const rent = isl.rent[st.level || 0]
          lines.push(`${owner ? owner.name : '?'} 的岛屿（${'★'.repeat(st.level || 0) || '0级'}）：落下需缴租 ${rent}`)
        }
      }
    } else if (cell.type === 'random_island') {
      lines.push('随机抽一座岛触发购买 / 结算租金')
    }
    this.closeCustomPanel()
    this.customPanel = buildModal(this, {
      title: '🔮 见闻色预览', icon: 'haki_observation',
      body: lines.join('\n'),
      buttons: [{ label: '知道了', color: PALETTE.neutral, onClick: () => this.closeCustomPanel() }]
    })
  }

  doUpgrade(islandId) {
    if (this.online) {
      this.socket.emit('game:upgrade', { islandId }, (res) => {
        if (res && res.error) showToast(this, res.error)
        this.closeCustomPanel()
      })
      return
    }
    const r = upgrade(this.state, islandId)
    if (r && r.error) showToast(this, r.error)
    else this.playSfx('sfx_upgrade')
    this.closeCustomPanel()
    this.refresh()
  }

  doProposeTrade(targetId, historyId, price, direction = 'buy') {
    if (this.online) {
      this.socket.emit('game:tradePropose', { targetId, historyId, price, direction }, (res) => {
        if (res && res.error) showToast(this, res.error)
        this.closeCustomPanel()
      })
      return
    }
    const r = proposeTrade(this.state, targetId, historyId, price, direction)
    if (r && r.error) showToast(this, r.error)
    this.closeCustomPanel()
    this.refresh()
  }

  // ---------- 自定义面板：岛屿 / 交易 / 规则 ----------
  closeCustomPanel() {
    if (this.customPanel) { this.customPanel.close(); this.customPanel = null }
  }

  openIslandPanel() {
    const s = this.state
    const p = getCurrentPlayer(s)
    const owned = p.islandIds.map((id) => ({ isl: ISLAND_BY_ID[id], st: s.islandState[id] }))
    if (!owned.length) { showToast(this, '你还没有岛屿，先买下一座岛吧'); return }
    const cost = (isl) => (p.charId === 8 ? Math.round(isl.upgradeCost * 0.7) : isl.upgradeCost)
    const rows = owned.slice(0, 6).map(({ isl, st }) => ({
      label: `「${isl.name}」Lv.${st.level}　租金 ${isl.rent[st.level]}`,
      right: st.level >= 3 ? '已满级' : `升级 ${cost(isl)}`,
      enabled: st.level < 3 && s.phase === 'awaitAction' && p.cash >= cost(isl),
      color: st.level < 3 ? PALETTE.good : PALETTE.neutral,
      onClick: () => this.doUpgrade(isl.id)
    }))
    this.customPanel = buildModal(this, {
      title: '岛屿管理',
      body: `现金 ${p.cash} 贝利　持有 ${owned.length} 座岛屿${owned.length > 6 ? `（显示前 6 座）` : ''}`,
      rows,
      buttons: [{ label: '关闭', color: PALETTE.neutral, onClick: () => this.closeCustomPanel() }]
    })
  }

  // targetId：只看与某玩家的交易（点头像发起时传入）；null = 全部
  openTradePanel(targetId = null) {
    this.closeCustomPanel()   // 防止在档案弹窗上再叠一层（旧引用会泄漏、关闭按钮错乱）
    const s = this.state
    const p = getCurrentPlayer(s)
    const price = ECONOMY.HISTORY_BUY
    const myCount = getHistoryIds(p).length
    const rows = []
    const wantTarget = (o) => targetId == null || o.id === targetId
    // 出售：我持有的每块正文 → 每个其他存活玩家（对方付钱）
    getHistoryIds(p).forEach((hid) => {
      s.players.forEach((o) => {
        if (o.id === p.id || o.bankrupt || !wantTarget(o)) return
        rows.push({
          label: `出售第 ${hid} 块 → ${o.name}`,
          right: `要价 ${price} 贝利`,
          enabled: s.phase === 'awaitAction' && o.cash >= price,
          color: PALETTE.good,
          onClick: () => this.doProposeTrade(o.id, hid, price, 'sell')
        })
      })
    })
    // 收购：别人持有的正文（每块正本全局唯一，不会与自己重复）
    s.players.forEach((o) => {
      if (o.id === p.id || o.bankrupt || !wantTarget(o)) return
      getHistoryIds(o).forEach((hid) => {
        rows.push({
          label: `收购 ${o.name} 的第 ${hid} 块`,
          right: `出价 ${price} 贝利`,
          enabled: s.phase === 'awaitAction' && p.cash >= price,
          color: PALETTE.blue,
          onClick: () => this.doProposeTrade(o.id, hid, price, 'buy')
        })
      })
    })
    if (!rows.length) {
      const others = s.players.filter((o) => o.id !== p.id && !o.bankrupt).length
      const noDeal = targetId != null
        ? `${s.players.find((o) => o.id === targetId)?.name || '对方'} 手里没有历史正文，你也没有可卖给 ta 的正文`
        : (others === 0 ? '没有可交易的对象' : `你持有 ${myCount} 块正文，但其他玩家都没有，无人可交易`)
      showToast(this, noDeal)
      return
    }
    this.customPanel = buildModal(this, {
      title: '历史正文交易',
      body: `你持有 ${myCount} 块 · 上方出售 / 下方收购 · 发起后由对方接受 / 拒绝（每回合限一次）`,
      rows: rows.slice(0, 8),
      buttons: [{ label: '关闭', color: PALETTE.neutral, onClick: () => this.closeCustomPanel() }]
    })
  }

  // 玩家详情弹窗：左栏点头像触发。自己看总账，看别人时可顺手发起交易。
  openPlayerInfo(i) {
    this.closeCustomPanel()
    const s = this.state
    const pl = s.players[i]
    if (!pl) return
    const char = CHARACTER_BY_ID[pl.charId]
    const isMe = this.online ? i === this.mySeat : pl.id === getCurrentPlayer(s).id
    // 总资产 = 现金 + 岛屿账面（买价 + 升级投入），比单看现金更能判断谁领先
    const total = playerAssets(s, pl)
    const islandBook = total - pl.cash
    const historyN = getHistoryIds(pl).length
    // 岛屿清单一律单行一条、最多 10 条（再长就把弹窗顶出屏幕），超出部分用「另有 N 座」收尾
    const islandLines = pl.islandIds.map((id) => {
      const isl = ISLAND_BY_ID[id]
      const lv = (s.islandState[id] || { level: 0 }).level
      return `🏝 ${isl.name} Lv.${lv}（租金 ${isl.rent[lv]}）`
    })
    const shownIslands = islandLines.slice(0, 10)
    if (islandLines.length > 10) shownIslands.push(`…另有 ${islandLines.length - 10} 座岛屿`)
    const islandBlock = pl.islandIds.length ? shownIslands.join('\n') : '（还没有岛屿）'
    const skillType = char.skillType === 'active' ? (pl.skillUsed ? '本局已用' : '主动') : '被动'
    const statusTags = [
      pl.bankrupt ? '💀 已破产' : null,
      pl.inJail ? '🚨 推进城' : null,
      pl.frozen > 0 ? '❄ 冰冻' : null
    ].filter(Boolean).join(' · ')
    const mine = this.myTurn()
    const canTrade = !isMe && !pl.bankrupt && s.phase === 'awaitAction' && mine
    const tradeHint = isMe ? '' : (pl.bankrupt
      ? '（对方已破产，无法交易）'
      : (mine ? '' : '（轮到你的回合才能发起交易）'))
    this.customPanel = buildModal(this, {
      title: `${char.name} 的航海档案`,
      width: 560,
      align: 'left',
      sections: [
        { text: `${char.name} · ${char.title}${statusTags ? `　${statusTags}` : ''}`, size: 19, bold: true, color: '#2a1a08', gap: 14 },
        { text: `💰 现金 ${pl.cash} 贝利　　🏝 岛屿账面 ${islandBook} 贝利`, size: 16, gap: 6 },
        { text: `📊 总资产 ${total} 贝利　　📜 正文 ${historyN}/4　　🃏 手牌 ${pl.hand.length}/5`, size: 16, gap: 6 },
        { text: `📍 位置：第 ${pl.position} 格`, size: 16, gap: 14 },
        { text: `技能【${char.skillName}】（${skillType}）`, size: 16, bold: true, color: '#8a5a12', gap: 4 },
        { text: char.desc, size: 15, color: '#5a4526', lineSpacing: 5, gap: 14 },
        { text: `岛屿（${pl.islandIds.length}）`, size: 16, bold: true, color: '#8a5a12', gap: 4 },
        { text: islandBlock, size: 15, color: '#5a4526', lineSpacing: 5, gap: 14 }
      ],
      buttons: [
        ...(isMe || pl.bankrupt ? [] : [{
          label: canTrade ? '🤝 发起交易' : '🤝 发起交易（需你的回合）',
          color: canTrade ? PALETTE.good : 0x6a5a44,
          onClick: canTrade
            ? () => { this.closeCustomPanel(); this.openTradePanel(pl.id) }
            : () => showToast(this, tradeHint || '轮到你的回合才能发起交易')
        }]),
        { label: '关闭', color: PALETTE.neutral, onClick: () => this.closeCustomPanel() }
      ]
    })
  }

  openRules() {
    // 左对齐分条：居中排版会把「或集齐 4 块…」这类长句从中间掰断，读起来很费劲
    const rules = [
      '两种胜利：其余航海士全部破产，或集齐 4 块路标历史正文后抵达拉夫德鲁。',
      '停在无主岛屿可购买；再度停靠可花钱升级（最高 3 级，租金随等级提升）。',
      '垄断同色海域可在该组任意岛屿上升一级。',
      '每回合最多使用 1 张手牌；恶魔果实、霸气、历史正文各有不同效果。',
      '回合限时 30 秒，超时由 AI 代打；按 A 可随时切换 AI 托管。'
    ]
    this.customPanel = buildModal(this, {
      title: '规则速查',
      width: 560,
      align: 'left',
      sections: rules.map((text, i) => ({
        text: `${i + 1}. ${text}`, size: 16, color: '#3a2812', lineSpacing: 5, gap: 10
      })),
      buttons: [{ label: '知道了', color: PALETTE.good, onClick: () => this.closeCustomPanel() }]
    })
  }

  aiAutoStep() {
    const s = this.state
    if (s.phase === 'awaitRoll') { this.handleRoll(); return }
    aiStep(s)
    this.refresh()
  }

  update(time) {
    if (this.portraitBlocked) return
    this.updateTimer(time)
    if (this.autoPlay && !this.animating && this.state.phase !== 'ended') {
      if (time < this.autoStepAt) return
      // AI / 托管行动间隔：标准 550ms，设置里选「快速」为 260ms
      this.autoStepAt = time + (loadSettings().fastAI ? 260 : 550)
      if (this.state.phase === 'awaitRoll') this.handleRoll()
      else this.aiAutoStep()
    }
  }

  updateTimer(time) {
    const s = this.state
    if (!this.centerTimerArc) return
    if (s.phase === 'ended' || this.autoPlay || !this.centerAvatar) {
      // 结束 / 托管：不显示环（托管由 AI 走，没有人为读秒压力）
      if (this.centerTimerArcDrawn) { this.centerTimerArc.clear(); this.centerTimerArcDrawn = false }
      return
    }
    const key = `${s.turn}|${s.current}|${s.phase}`
    if (key !== this.timerKey) {
      this.timerKey = key
      this.turnDeadline = time + TURN_SECONDS * 1000
    }
    const leftMs = Math.max(0, this.turnDeadline - time)
    this.drawTurnRing(leftMs / (TURN_SECONDS * 1000))
    if (leftMs <= 0 && !this.animating && !this.modal && !this.customPanel) this.onTurnTimeout(time)
  }

  // 环形倒计时：底环 + 顺时针递减的弧。弧从 12 点方向开始，避免玩家读方向成本
  drawTurnRing(ratio) {
    const g = this.centerTimerArc
    const ring = this.centerTimerRing || { r: 40, w: 6 }
    const cx = this.centerAvatar.x
    const cy = this.centerAvatar.y
    const color = ratio <= 0.25 ? 0xff6b5c : (ratio <= 0.5 ? 0xffc94d : 0x7cfc8a)
    g.clear()
    this.centerTimerArcDrawn = true
    g.lineStyle(Math.max(2, ring.w - 2), 0x3a2410, 0.22)
    g.strokeCircle(cx, cy, ring.r)
    if (ratio > 0) {
      g.lineStyle(ring.w, color, 1)
      g.beginPath()
      g.arc(cx, cy, ring.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ratio), false)
      g.strokePath()
    }
    // 最后 5 秒叠加呼吸脉冲，余光也能感知紧迫（光晕宽度受 ringOuter 余量约束，不外扩）
    if (ratio <= 5 / TURN_SECONDS) {
      const pulse = 0.35 + 0.25 * Math.sin(this.time.now / 140)
      g.lineStyle(ring.w + 3, color, pulse * 0.35)
      g.beginPath()
      g.arc(cx, cy, ring.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ratio), false)
      g.strokePath()
    }
  }

  onTurnTimeout(time) {
    const s = this.state
    showToast(this, '回合超时，已自动行动')
    if (s.phase === 'awaitRoll') this.handleRoll()
    else if (s.phase === 'awaitAction') this.handleEnd()
    else if (s.phase === 'awaitBuy' || s.phase === 'awaitBuyHistory') this.handleDecline()
    else { aiStep(s); this.refresh() }
    this.timerKey = ''
    this.turnDeadline = time + TURN_SECONDS * 1000
  }

  // ---------- 动画 ----------
  tweenTo(spr, x, y, ms) {
    return new Promise((resolve) => {
      this.tweens.add({ targets: spr, x, y, duration: ms, onComplete: resolve })
    })
  }

  // 联机：对比前后状态找出「刚移动的棋子」。
  // 掷骰前进：某玩家 position 变化且差值 = lastDice.total；果实/事件强移：只动一个人，距离≠骰点。
  // 返回 { seat, from, steps }；两次状态一致（如购买/结束回合）返回 null。
  detectMove(prev, next) {
    if (!prev || !next || !prev.players || !next.players) return null
    for (let i = 0; i < next.players.length; i++) {
      const a = prev.players[i]
      const b = next.players[i]
      if (!a || !b || a.bankrupt || b.bankrupt) continue
      if (a.position === b.position) continue
      const forward = (b.position - a.position + 40) % 40
      const steps = next.lastDice ? next.lastDice.total : forward
      return { seat: i, from: a.position, steps }
    }
    return null
  }

  async animateSteps(player, from, steps, seatIdx = null) {
    const idx = seatIdx != null ? seatIdx : this.state.players.indexOf(player)
    const spr = typeof player === 'number' ? this.tokenSprites[player] : this.tokenSprites[idx]
    if (!spr) return
    const off = this.tokenOffset(idx)
    // 逐格移动：标准 220ms/格（看得清每一格），快速模式 130ms/格
    const base = loadSettings().fastAI ? 130 : 220
    const stepMs = Math.round(base * this.fxScale())
    for (let s = 1; s <= steps; s++) {
      const pos = this.cellPos(from + s)
      // 每步小跳：y 方向先抬 8px 再落位，配合步进音效
      this.tweens.add({ targets: spr, y: spr.y - 8, duration: stepMs * 0.45, yoyo: true, ease: 'Quad.easeOut' })
      await this.tweenTo(spr, pos.x + off.x, pos.y + off.y, stepMs)
      spr.y = pos.y + off.y
      this.playSfx('sfx_move_step', 0.4)
    }
  }

  // 到达反馈：着地弹跳 + 格子光圈扩散 + 到达横幅（岛屿显示归属/租金，特殊格显示名称）
  // 联机/单机共用；不阻塞后续购买/事件弹窗（纯表现层）
  async playArrivalFx(seatIdx) {
    const s = this.state
    const pl = s.players[seatIdx]
    if (!pl) return
    const cell = BOARD[pl.position]
    const pos = this.cellPos(pl.position)
    const spr = this.tokenSprites[seatIdx]
    const isIsland = cell.type === 'island'

    // 1) 着地弹跳：下压回弹，重量感
    if (spr) {
      const baseScale = spr.scaleX
      this.tweens.add({
        targets: spr, scaleX: baseScale * 1.25, scaleY: baseScale * 0.75,
        duration: 110, yoyo: true, ease: 'Quad.easeOut',
        onComplete: () => { spr.setScale(baseScale, baseScale) }
      })
    }

    // 到达横幅描边色（岛屿金色、事件紫、税收红、其余白）
    const ringColor = isIsland ? 0xffd76a
      : cell.type === 'event' ? 0xc39be0
        : cell.type === 'tax' ? 0xe88a7a : 0xffffff

    // 2.5) 特殊格到达特效：税收/起点爆金币、事件/果实/历史用传送门的神秘感
    if (cell.type === 'tax' || cell.type === 'go') {
      this.fxAtCell('fx_coin_burst', pl.position, { scale: 1.6 })
    } else if (cell.type === 'event' || cell.type === 'fruit' || cell.type === 'history') {
      this.fxAtCell('fx_teleport', pl.position, { scale: 1.5 })
    }

    // 3) 到达横幅：格子上方升起
    let title
    let sub = ''
    if (isIsland) {
      const isl = ISLAND_BY_ID[cell.islandId]
      const st = s.islandState[isl.id] || { ownerId: null, level: 0 }
      const owner = st.ownerId == null ? '无主' : (s.players.find((x) => x.id === st.ownerId) || {}).name || '?'
      title = `⚓ ${isl.name}`
      sub = `Lv.${st.level} · 岛主 ${owner} · 租金 ${isl.rent[st.level]} 贝利`
    } else if (cell.type === 'fruit') {
      title = '🍇 恶魔果实'
      sub = '拾取一枚果实入手牌'
    } else if (cell.type === 'history') {
      title = '📜 历史正文'
      sub = '可抽取 / 购买路标历史正文'
    } else if (cell.type === 'laugh_tale') {
      title = '🏴 拉夫德鲁'
      sub = '集齐 4 块历史正文即可通关！'
    } else if (cell.type === 'tax') {
      title = '💰 税收'
      sub = '缴纳规定税额'
    } else if (cell.type === 'go') {
      title = '🚩 起点'
      sub = '领取起点经费'
    } else if (cell.type === 'jail') {
      title = '🚨 推进城'
      sub = '等待保释或掷出双数'
    } else if (cell.type === 'port') {
      title = '⚓ 港口'
      sub = '整备补给'
    } else if (cell.type === 'event') {
      title = '❓ 事件'
      sub = '命运的齿轮转动…'
    }
    if (!title) return

    const bannerW = Math.max(this.cell * 4.6, 240)
    const bg = this.add.rectangle(pos.x, pos.y - this.cell * 0.9, bannerW, 46, 0x1c1206, 0.92)
      .setStrokeStyle(2, ringColor, 0.9).setDepth(598).setAlpha(0)
    const t1 = this.add.text(pos.x, pos.y - this.cell * 0.9 - 9, title,
      textStyle(TYPE.body, '#ffe9a8', { fontStyle: 'bold', align: 'center' })).setOrigin(0.5).setDepth(599).setAlpha(0)
    const t2 = this.add.text(pos.x, pos.y - this.cell * 0.9 + 8, sub,
      textStyle(11, '#e8dcc4', { align: 'center' })).setOrigin(0.5).setDepth(599).setAlpha(0)
    // 升起入场 → 停留 → 淡出
    this.tweens.add({ targets: [bg, t1, t2], alpha: 1, y: '-=10', duration: 260, ease: 'Back.easeOut' })
    this.tweens.add({
      targets: [bg, t1, t2], alpha: 0, delay: 1500, duration: 380, ease: 'Quad.easeIn',
      onComplete: () => { bg.destroy(); t1.destroy(); t2.destroy() }
    })

    // 4) 到达音效：岛屿用金币、特殊格用事件音
    this.playSfx(isIsland ? 'sfx_coin_burst' : 'sfx_event_flip', 0.5)
  }

  async animateTeleport(player, from, to) {
    const idx = this.state.players.indexOf(player)
    const spr = this.tokenSprites[idx]
    if (!spr) return
    const off = this.tokenOffset(idx)
    const pos = this.cellPos(to)
    this.playFx('fx_teleport', pos.x, pos.y, this.cell * 1.6)
    this.tweens.add({ targets: spr, alpha: 0.2, duration: 150, yoyo: true })
    await this.tweenTo(spr, pos.x + off.x, pos.y + off.y, 300)
    this.playSfx('sfx_jail_lock')
  }

  // ---------- 8 帧特效 sheet 播放 ----------
  // 在 (x,y) 播一次 8 帧横排特效（assets/fx/sheets/，BootScene 已注册），
  // 播完自动销毁；size 为显示宽度（像素），高度按 2:1 等比。
  // fps 随「AI 快速行动」加快；特效应放在棋盘格之上、弹窗之下。
  // 总开关见 ui/fxConfig.js 的 FX_SPRITE_ENABLED（当前关闭：素材质量不达标）。
  playFx(key, x, y, size = null, opts = {}) {
    if (!FX_SPRITE_ENABLED) return null
    if (!this.textures.exists(key)) return null
    const c = this.cell || 48
    const w = size || c * 1.4
    const fps = Math.round((opts.fps || 14) / this.fxScale())
    const spr = this.add.sprite(x, y, key, 0)
      .setDisplaySize(w, w / 2)
      .setOrigin(0.5, 0.82) // 底部对齐：特效"落地"在格子上而非悬空
      .setDepth(opts.depth ?? 490)
    if (opts.tint != null) spr.setTint(opts.tint)
    spr.play({ key, frameRate: fps, repeat: 0 })
    spr.once('animationcomplete', () => spr.destroy())
    return spr
  }

  // 语义化封装：把特效挂到具体游戏事件（棋盘格坐标 / 玩家卡片）
  fxAtCell(key, cellIndex, opts = {}) {
    const pos = this.cellPos(cellIndex)
    return this.playFx(key, pos.x, pos.y, this.cell * (opts.scale || 1.6), opts)
  }

  fxAtPlayer(key, seatIdx, opts = {}) {
    const spr = this.tokenSprites && this.tokenSprites[seatIdx]
    const card = this.playerCards && this.playerCards[seatIdx]
    const x = spr ? spr.x : (card ? card.bg.x : this.boardCX)
    const y = spr ? spr.y : (card ? card.bg.y : this.boardCY)
    return this.playFx(key, x, y, this.cell * (opts.scale || 1.6), opts)
  }

  playSfx(name, vol = 0.7) {
    sfxPlay(this, name, vol)
  }

  // ---------- 弹窗 ----------
  closeModal() {
    if (this.modal) { this.modal.close(); this.modal = null }
  }

  showModal(spec) {
    this.closeModal()
    this.modal = buildModal(this, spec)
  }

  // ---------- 刷新 ----------
  // 滚动日志：dy>0 向下（往最新）滚。上翻时解除贴底；翻到底自动恢复跟随。
  // 日志按事件类型配色：扫一眼就能分清「谁赚了 / 谁付了 / 出大事了」
  // 日志配色：按「归属角色」上色，而不是按事件类型。
  // 每个角色一种固定色，与左栏卡片边框、棋盘上的岛主圆点同源（PLAYER_COLORS 同序号），
  // 于是「你的卡片 / 你的岛 / 你的记录」在视觉上完全一致；系统播报落回正文米色。
  logLineColor(text) {
    if (/🏆|获胜|海贼王/.test(text)) return '#ffd966'
    const line = text.replace(/^·\s*/, '')
    // 「轮到 X。」把主语写在介词后，剥掉前缀再匹配
    const body = line.startsWith('轮到 ') ? line.slice(3) : line
    const players = (this.state && this.state.players) || []
    // 名字互为前缀时取最长匹配，避免「路飞」吃掉「路飞飞」的记录
    const hit = players
      .filter((pl) => pl && pl.name && body.startsWith(pl.name))
      .sort((a, b) => b.name.length - a.name.length)[0]
    if (hit) return PLAYER_TEXT_COLORS[hit.id % PLAYER_TEXT_COLORS.length]
    return COLOR_TEXT.muted
  }

  // 逐行布局日志：返回总内容高度。行坐标是「内容顶部坐标系」（第一行 y=0），
  // 由 applyLogScroll 移动整个容器实现滚动。
  layoutLogLines(entries) {
    const area = this.logArea
    const objs = this.logLineObjs
    while (objs.length < entries.length) {
      const t = this.add.text(area.x, 0, '', textStyle(13, COLOR_TEXT.muted, { lineSpacing: 3, ...wrap(area.w - 4) })).setOrigin(0, 0)
      this.logLines.add(t)
      objs.push({ t, last: null })
    }
    let yy = 0
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i]
      if (i >= entries.length) { o.active = false; o.t.setVisible(false); continue }
      o.active = true
      if (o.last !== entries[i].text) {
        o.t.setText('· ' + entries[i].text)
        o.t.setColor(this.logLineColor(entries[i].text))
        o.last = entries[i].text
      }
      o.t.setPosition(area.x, yy)
      yy += o.t.height + 2
    }
    this.logContentH = yy
    return yy
  }

  scrollLog(dy) {
    if (!this.logArea || !this.logLines) return
    const maxScroll = Math.max(0, this.logContentH - this.logArea.h)
    if (maxScroll <= 0) return // 内容没超区，无需滚
    // 滚轮向下（dy>0）＝往更新的一条走；向上＝翻历史
    this.logScroll = clamp((this.logScroll || 0) + (dy > 0 ? 34 : -34), 0, maxScroll)
    this.logPinned = this.logScroll >= maxScroll - 1
    if (this.logPinned) this.logNewCount = 0
    this.applyLogScroll()
    this.updateLogChip()
  }

  // 应用滚动：移动行容器实现可视窗口 + 更新滚动条滑块
  applyLogScroll() {
    if (!this.logArea || !this.logLines) return
    const { y, h } = this.logArea
    const maxScroll = Math.max(0, this.logContentH - h)
    const off = clamp(this.logScroll || 0, 0, maxScroll)
    this.logScroll = off
    // 容器整体上移 off：内容坐标 yy 的行落在场景 y = yy + (area.y - off)
    this.logLines.setPosition(0, y - off)
    // 视窗外的行隐藏（几何遮罩兜底裁剪，这里减渲染量）
    for (const o of this.logLineObjs) {
      if (!o.active) { o.t.setVisible(false); continue }
      const top = o.t.y + y - off
      o.t.setVisible(top + o.t.height > y - 20 && top < y + h + 20)
    }
    // 滚动条滑块：高度∝可视占比，位置∝滚动进度（顶部=最早，底部=最新）
    const ratio = Math.max(0.05, Math.min(1, h / Math.max(1, this.logContentH)))
    const thumbH = Math.max(18, h * ratio)
    const t = maxScroll > 0 ? off / maxScroll : 1
    this.logScrollThumb.setSize(3, thumbH)
    this.logScrollThumb.setPosition(this.logScrollTrack.x, y + thumbH / 2 + t * (h - thumbH))
    // 贴底时淡出（没有更多新内容），上翻时加亮提示「下面还有」
    this.logScrollThumb.setAlpha(t < 0.98 ? 1 : 0.5)
  }

  // 「↓ N 条新消息」浮标：上翻看历史期间来了新日志时出现，点击跳回最新
  updateLogChip() {
    if (!this.logNewChipBg) return
    const show = !this.logPinned && this.logNewCount > 0
    this.logNewChipBg.setVisible(show)
    this.logNewChipTxt.setVisible(show)
    if (show) this.logNewChipTxt.setText(`↓ ${this.logNewCount} 条新消息`)
  }

  // 行动横幅：按阶段给出一句话指令。轮到自己时绿色高亮 + 呼吸描边；等待他人时灰色。
  // 这是「现在该做什么」的唯一权威出口——玩家不需要自己读按钮的灰亮来推断。
  updateActionBanner(s, p, mine) {
    if (!this.actionBanner) return
    const { bg, txt } = this.actionBanner
    const steps = { d1: s.lastDice ? s.lastDice.d1 : null, d2: s.lastDice ? s.lastDice.d2 : null }
    let msg = '', mine2 = false
    switch (s.phase) {
      case 'awaitRoll':
        mine2 = mine
        msg = mine ? '🎲 轮到你 · 点「掷骰」' : `⏳ 等待 ${p.name} 掷骰…`
        break
      case 'awaitBuy': {
        const isl = ISLAND_BY_ID[s.pendingIslandId]
        mine2 = mine
        msg = mine ? `🏝 买下「${isl.name}」？（${isl.price} 贝利）` : `⏳ 等待 ${p.name} 决定是否购买 ${isl.name}…`
        break
      }
      case 'awaitBuyHistory':
        mine2 = mine
        msg = mine ? `📜 花 ${s.pendingHistoryPrice} 贝利买这份历史正文？` : `⏳ 等待 ${p.name} 决定购买历史正文…`
        break
      case 'awaitAction':
        mine2 = mine
        if (mine) {
          const canVoyage = getHistoryIds(p).length >= 4
          const hasSkill = (CHARACTER_BY_ID[p.charId] || {}).skillType === 'active' && !p.skillUsed
          msg = canVoyage ? '🚢 集齐 4 份正文！可以「出航」获胜，或继续行动'
            : (steps.d1 != null && steps.d1 === steps.d2 ? '🎲 掷出双数！再掷一次或结束回合' : '✅ 使用技能/卡牌，或点击「结束回合」')
          if (!canVoyage && !hasSkill && p.hand.filter((c) => c.kind !== 'history').length === 0) {
            msg = '👉 没有可用的行动了，点击「结束回合」'
          }
        } else {
          msg = `⏳ ${p.name} 行动中…`
        }
        break
      case 'awaitFlower':
        mine2 = mine
        msg = mine ? '🌸 花花果实：是否让抽到的事件生效？' : `⏳ 等待 ${p.name} 确认事件…`
        break
      case 'awaitEventCancel':
        mine2 = mine
        // 取消的代价是「见闻色霸气」卡，不是贝利（engine.js decisionEventCancel）
        msg = mine ? '❓ 是否用「见闻色霸气」取消这次事件？' : `⏳ 等待 ${p.name} 决定是否取消事件…`
        break
      case 'awaitReroll':
        mine2 = mine
        msg = mine ? '🎲 是否重掷这次骰子？' : `⏳ 等待 ${p.name} 决定是否重掷…`
        break
      case 'awaitTarget':
        mine2 = mine
        msg = mine ? '🎯 选择一个目标玩家' : `⏳ 等待 ${p.name} 选择目标…`
        break
      case 'awaitTrade': {
        const m = s.modal || {}
        mine2 = this.online ? m.targetId === this.mySeat : true
        msg = mine2 ? '🤝 对方向你发起交易，请决定是否接受' : `⏳ 等待交易回应…`
        break
      }
      case 'ended': {
        const w = s.players.find((x) => x.id === s.winner)
        msg = `🏆 ${w ? w.name : '?'} 获胜！`
        break
      }
      default:
        msg = ''
    }
    txt.setText(msg)
    // 自动缩字号：中央画框里横幅只有 ~200px 宽，长句换行会顶出横条外。
    // 从基准字号往下降到能放进横幅高度为止（最小 9px，再小就不看了）。
    if (this.actionBannerH) {
      const maxH = this.actionBannerH - 3
      let fs = this.actionBannerFont || txt.style.fontSize
      txt.setFontSize(fs)
      while (txt.height > maxH && fs > 9) {
        fs -= 1
        txt.setFontSize(fs)
      }
    }
    const active = !!mine2 && s.phase !== 'ended'
    bg.setStyle({
      fill: active ? 0x1a4a2a : 0x241505, fillAlpha: active ? 0.9 : 0.65,
      stroke: active ? 0x7cfc8a : PALETTE.gold, strokeAlpha: active ? 1 : 0.35
    })
    txt.setColor(active ? '#a8ffb8' : '#d8cbb0')
    // 呼吸描边：仅轮到自己时，提示「该你操作了」
    if (active && !this._bannerTween) {
      this._bannerTween = this.tweens.add({
        targets: bg, alpha: { from: 1, to: 0.72 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      })
    } else if (!active && this._bannerTween) {
      this._bannerTween.stop(); this._bannerTween.remove(); this._bannerTween = null
      bg.setAlpha(1)
    }
  }

  setBtn(btn, visible, label, enabled = true) {
    if (!btn) return
    btn.setLabel(label ?? btn.txt.text)
    btn.setEnabled(enabled)
    btn.setVisible(visible)
  }

  refresh() {
    const s = this.state
    if (this.portraitBlocked) return
    const p = getCurrentPlayer(s)
    const char = CHARACTER_BY_ID[p.charId]
    // 联机且不是我的回合：所有「改变对局」的按钮置灰，只读观战
    const mine = this.myTurn()

    // 按钮常驻显示、按阶段置灰：避免按钮时隐时现造成布局跳动与误点，
    // 也让右栏的空间分配（当前格 / 日志）保持稳定
    // 主操作 2×2：第一行常驻；第二行按阶段切换两对按钮（同一槽位，位次稳定）
    const buyPhase = s.phase === 'awaitBuy' || s.phase === 'awaitBuyHistory'
    this.setBtn(this.btnRoll, true, '掷 骰', s.phase === 'awaitRoll' && mine && !this.animating)
    this.setBtn(this.btnEnd, true, '结束回合', s.phase === 'awaitAction' && mine && !this.animating)
    this.setBtn(this.btnBuy, buyPhase, '购买', s.phase === 'awaitBuy' && mine)
    this.setBtn(this.btnDecline, buyPhase, '放弃', buyPhase && mine)
    this.setBtn(this.btnSkill, !buyPhase, '技能', s.phase === 'awaitAction' && char.skillType === 'active' && !p.skillUsed && mine)
    this.setBtn(this.btnVoyage, !buyPhase, '出航', s.phase === 'awaitAction' && getHistoryIds(p).length >= 4 && mine)
    this.setBtn(this.btnIslands, true, '岛屿', s.phase === 'awaitAction' && p.islandIds.length > 0)
    this.setBtn(this.btnRules, true, '规则', true)
    this.setBtn(this.btnAuto, true, this.autoPlay ? '托管中' : '托管', true)
    // 行动横幅：一句话指令（谁在动 / 该做什么）
    this.updateActionBanner(s, p, mine)
    // 托管选中态：按钮变绿 + 标题旁常驻徽标，避免"开了托管但看不出来"
    if (this.btnAuto) this.btnAuto.setColor(this.autoPlay ? PALETTE.good : 0x5a3a1a)
    if (this.autoBadge) {
      this.autoBadge.setVisible(this.autoPlay)
        .setPosition(this.turnTxt.x + this.turnTxt.width + 12, this.turnTxt.y + 2)
    }

    s.players.forEach((pl, i) => {
      const pos = this.cellPos(pl.position)
      const off = this.tokenOffset(i)
      const spr = this.tokenSprites[i]
      if (!spr) return
      if (!this.animating) spr.setPosition(pos.x + off.x, pos.y + off.y)
      spr.setAlpha(pl.bankrupt ? 0.25 : 1)
    })

    this.renderCardHands()
    // 弹窗渲染包一层兜底：任一弹窗分支抛错都不应中断整个 refresh
    // （否则按钮刚被置灰、后续回合/日志/棋子都停在旧状态，表现为「界面完全点不动」）
    try {
      this.renderModal(s, p)
    } catch (err) {
      console.error('[BoardScene] renderModal 失败', s.phase, err)
      showToast(this, '界面渲染异常，请刷新页面')
    }

    // 回合归属只写回合数：玩家名交给下一行「名字·职业」，避免「山治（山治）」这类重复
    const turnSuffix = this.online ? (mine ? ' · 你的回合' : ' · 观战中') : ''
    this.turnTxt.setText(`第 ${s.turn} 回合${turnSuffix}`)
    // 中央指挥台：角色名 +（联机且有状态时）+ 状态标签；技能状态单独一行小字。
    // 玩家名与角色名同源（引擎按 charId 取名），不存在「昵称 · 角色名」双名情况
    const whoLine = `${char.name} · ${char.title}`
    const stateTags = [p.inJail ? '推进城' : '', p.frozen > 0 ? '冰冻' : ''].filter(Boolean)
    const tagStr = stateTags.length ? ` · ${stateTags.join(' ')}` : ''
    if (this.centerNameTxt) {
      // 名字只有一行的空间（下面紧跟技能状态与骰子，绝不能折行）：先缩字号，
      // 最小字号仍放不下再逐级丢信息「角色·职业」→「角色+状态」→「角色」
      this.fitOneLine(this.centerNameTxt, whoLine + tagStr, this.centerColW || 100, this.centerNameFs || 16, 9,
        [`${char.name}${tagStr}`, char.name])
    }
    const skillState = char.skillType === 'active'
      ? (p.skillUsed ? `${char.skillName}：已用` : `${char.skillName}：可用`)
      : `${char.skillName}（被动）`
    if (this.skillTxt) {
      this.skillTxt.setText(skillState)
      this.fitTextWidth(this.skillTxt, this.centerColW || 100, this.centerSkillFs || 11, 8)
    }

    // 中央大骰子与回合徽标同步（掷骰动画进行中不覆盖帧；联机模式检测新结果自动播动画）
    if (this.centerDie1) {
      const diceKey = s.lastDice ? `${s.lastDice.d1},${s.lastDice.d2}` : null
      if (diceKey && diceKey !== this._diceAnnounced && !this.diceAnimating) {
        this._diceAnnounced = diceKey
        this.animateDiceRoll(s.lastDice.d1, s.lastDice.d2)
      }
      if (!this.diceAnimating) {
        if (s.lastDice) {
          this.centerDie1.setFrame(s.lastDice.d1 - 1).setAlpha(1).setVisible(true)
          this.centerDie2.setFrame(s.lastDice.d2 - 1).setAlpha(1).setVisible(true)
          this.setDiceTotal(s.lastDice.total ?? (s.lastDice.d1 + s.lastDice.d2))
        } else {
          // 还没掷过骰：两张空白骰面看起来像空卡片，直接隐藏，掷完再出现
          this.centerDie1.setVisible(false)
          this.centerDie2.setVisible(false)
          this.setDiceTotal(null)
        }
      }
    }
    if (this.centerTurnTxt) this.centerTurnTxt.setText(`第 ${s.turn} 回合`)

    // 中央画框：当前回合玩家的头像 / 名字 / 目标进度
    if (this.centerAvatar) {
      const avatarKey = `token${p.charId}`
      if (this.textures.exists(avatarKey)) this.centerAvatar.setTexture(avatarKey)
      // 回合切换时头像弹跳入场
      const avatarKeyCombo = `${avatarKey}:${s.current}:${s.turn}`
      if (this._centerAvatarKey !== avatarKeyCombo) {
        this._centerAvatarKey = avatarKeyCombo
        // 弹跳以设计尺寸为基准（不读当前 scale，避免动画被打断后越弹越大顶出圆盘）
        const base = this.centerAvatarBaseScale || this.centerAvatar.scaleX
        this.centerAvatar.setScale(base)
        this.tweens.add({ targets: this.centerAvatar, scale: base * 1.08, duration: 200, yoyo: true, ease: 'Back.easeOut' })
      }
    }
    if (this.centerNameTxt) {
      const who = this.online ? (mine ? '你的回合' : `${p.name} 行动中`) : `${p.name} · ${char.title}`
      this.centerNameTxt.setText(who)
    }

    // 左栏玩家卡片：现金 / 资产 / 当前回合高亮
    if (this.playerCards) {
      this.playerCards.forEach((c, i) => {
        const pl = s.players[i]
        if (!pl) return
        const cur = pl.id === p.id && s.phase !== 'ended'
        // 边框恒为该玩家的身份色（与岛主圆点、日志同源），「当前回合」只加粗加实，
        // 再由头像金色光环呼吸 + 行动横幅表达——不再把边框换成金色，
        // 否则同一张卡上会同时出现「身份色」和「回合色」两套语义。
        const idColor = PLAYER_COLORS[i % PLAYER_COLORS.length]
        c.bg.setStyle({
          stroke: idColor, strokeAlpha: cur ? 1 : 0.65, strokeW: cur ? 3 : 2,
          fill: pl.bankrupt ? 0x140d04 : 0x241505, fillAlpha: pl.bankrupt ? 0.7 : 0.55
        })
        const tags = []
        const tagIcons = []
        if (pl.inJail) { tags.push('🚨进城'); tagIcons.push('🚨') }
        if (pl.frozen > 0) { tags.push('❄冰冻'); tagIcons.push('❄') }
        // 联机：标出「我」是哪张卡。名字只用角色名（与中央指挥台、日志、聊天气泡同源），
        // 不再拼接自定义昵称——此前「昵称（你）· 角色名」在一张窄卡里要缩到 12px 才放得下
        const isMe = this.online && i === this.mySeat
        const roleName = CHARACTER_BY_ID[pl.charId].name
        const nameLine = `${roleName}${isMe ? '（你）' : ''}`
        // 名字行强制单行（超宽先缩字号，再退到「去掉（你）」的备用文案）
        const shortLine = `${roleName}${pl.bankrupt ? ' 💀' : ''}`
        // 没有手牌时右侧手牌框是空的，名字可以用满整卡宽度（否则 96px 里只能塞下 4 个字）
        const hasHand = pl.hand.length > 0
        let nameW = c.nameMaxW ?? 120
        if (c.vertical) {
          nameW = hasHand ? c.w - c.zoneW - 14 : c.w - 14
          c.nameTxt.setX(hasHand ? c.cx - c.zoneW / 2 + 2 : c.cx)
        } else if (!hasHand) {
          nameW = c.w - 64
        }
        this.fitOneLine(c.nameTxt, nameLine + (pl.bankrupt ? ' 💀' : ''), nameW, c.nameFs ?? TYPE.section, 12,
          [shortLine])
        // 单位「贝利」只在栏目标题写一次，卡片上只留数字，减少 4 张卡重复同一单位
        c.cashTxt.setText(String(pl.cash))
        // 全员 0 岛 0 正文时不渲染占位（开局减负），有资产或状态才显示
        const hasAsset = pl.islandIds.length > 0 || getHistoryIds(pl).length > 0 || tags.length > 0
        // 资产行三级压缩：完整（图标+文字标签）→ 紧凑（标签只留 emoji）→ 只留岛屿/正文数
        const assetLine = `🏝${pl.islandIds.length}·📜${getHistoryIds(pl).length}/4`
        const statLine = hasAsset ? `${assetLine}${tags.length ? ' ' + tags.join(' ') : ''}` : ' '
        const statCompact = hasAsset ? `${assetLine}${tagIcons.length ? ' ' + tagIcons.join('') : ''}` : ' '
        this.fitOneLine(c.statTxt, statLine, c.statMaxW ?? 120, TYPE.caption, 10,
          [statCompact, hasAsset ? assetLine : ' ', hasAsset ? `🏝${pl.islandIds.length}` : ' '])
        // 徽标兜底：只有当文字行没塞下状态标签时，才在头像角上补 🚨 / ❄（否则会重复显示）
        const statShown = c.statTxt.text || ''
        const tagInText = tags.some((t) => statShown.includes(t))
        if (c.badgeTxt) c.badgeTxt.setText(tagIcons.join('')).setVisible(tagIcons.length > 0 && !pl.bankrupt && !tagInText)
        c.avatar.setAlpha(pl.bankrupt ? 0.3 : 1)
        // 当前回合玩家：头像入场弹跳 + 呼吸放大 + 金色光环呼吸；其他人静止
        if (cur && !pl.bankrupt && !c.pulseTween) {
          const base = c.avatar.scale
          c.baseScale = base
          c.avatar.setScale(base * 0.7)
          c.pulseTween = this.tweens.add({
            targets: c.avatar, scale: base, duration: 360, ease: 'Back.easeOut',
            onComplete: () => {
              c.pulseTween = this.tweens.add({ targets: c.avatar, scale: base * 1.12, duration: 560, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
            }
          })
          if (c.glow) {
            c.glow.setVisible(true).setAlpha(0.12)
            c.glowTween = this.tweens.add({ targets: c.glow, alpha: { from: 0.12, to: 0.42 }, duration: 560, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
          }
        } else if (!cur && c.pulseTween) {
          c.pulseTween.stop(); c.pulseTween.remove(); c.pulseTween = null
          if (c.glowTween) { c.glowTween.stop(); c.glowTween.remove(); c.glowTween = null }
          if (c.baseScale) c.avatar.setScale(c.baseScale)
          if (c.glow) c.glow.setVisible(false).setAlpha(0)
        }
      })
    }

    const cell = BOARD[p.position]
    // 当前格只回显「你在哪 + 站在这要付多少」；买价等决策数字由行动横幅负责，不重复
    const mini = this.cellMode === 'mini'
    let info = `第${p.position}格 · ${CELL_NAMES[cell.type] ?? cell.type}`
    if (cell.type === 'island') {
      const isl = ISLAND_BY_ID[cell.islandId]
      const st = s.islandState[isl.id] || { ownerId: null, level: 0 }
      const owner = st.ownerId == null ? '无主' : (st.ownerId === p.id ? '你' : (s.players.find((x) => x.id === st.ownerId) || { name: '?' }).name)
      info = mini
        ? `第${p.position}格「${isl.name}」Lv${st.level}\n岛主 ${owner} · 租 ${isl.rent[st.level]}`
        : `第 ${p.position} 格 ·「${isl.name}」Lv.${st.level}\n岛主 ${owner} · 租金 ${isl.rent[st.level]} 贝利`
    } else if (cell.type === 'history') {
      info += '\n路标历史正文格'
    } else if (cell.type === 'laugh_tale') {
      info = `第${p.position}格 · 拉夫德鲁\n集齐 4 块正文即封王`
    }
    if (this.cellTxt) this.cellTxt.setText(info)
    if (this.cellIcon) {
      // 提示卡图标随格子类型切换
      const iconKey = cell.type === 'island' ? `isl${ISLAND_BY_ID[cell.islandId].id}` : `cell_${cell.type}`
      if (this.textures.exists(iconKey)) this.cellIcon.setTexture(iconKey).setVisible(true)
      else this.cellIcon.setVisible(false)
      // 需要玩家决策的阶段：金色高亮面板 + 描边加亮（makePanel: list[0]=外框 list[1]=内底，
      // 圆角化后两者都是 makeRounded Graphics，动态改色走 setStyle）
      const actionable = ['awaitBuy', 'awaitBuyHistory', 'awaitEventCancel', 'awaitReroll', 'awaitTarget', 'awaitTrade'].includes(s.phase)
      this.cellPanel.list[1].setStyle({ fill: PALETTE.gold, fillAlpha: actionable ? 0.22 : 0.08 })
      this.cellPanel.list[0].setStyle({ stroke: actionable ? 0xffd966 : PALETTE.gold, strokeAlpha: actionable ? 1 : 0.5 })
    }

    // 棋盘光圈跟随当前玩家所在格
    if (this.cellRing) {
      const rp = this.cellPos(p.position)
      this.cellRing.setPosition(rp.x, rp.y).setVisible(!this.animating)
    }

    if (this.logLines) {
      const entries = s.log
      const prev = this._logCount
      this._logCount = entries.length
      const grew = entries.length > prev
      // 上翻看历史期间来了新日志：累计条数，浮标提示（不拽走视线）
      if (!this.logPinned && grew) this.logNewCount = (this.logNewCount || 0) + (entries.length - prev)
      if (this.logPinned) this.logNewCount = 0
      this.layoutLogLines(entries)
      const viewH = this.logArea.h
      const maxScroll = Math.max(0, this.logContentH - viewH)
      if (this.logPinned) {
        // 贴底跟随：新日志追加在末尾，视图始终停在最新一条
        this.logScroll = maxScroll
      } else {
        // 上翻看历史时保持当前位置，避免新消息把视线拽走
        this.logScroll = clamp(this.logScroll, 0, maxScroll)
      }
      this.applyLogScroll()
      this.updateLogChip()
    }
    this.updateOwnerDots()
    this.trackFeedback(s)

    if (s.phase === 'ended') {
      this.autoPlay = false
      this.showVictory(s.winner)
    }
  }

  // 手牌 mini 卡：贴在左栏各玩家卡右侧框内（有手牌才画，无手牌整区留白）。
  // 服务端整局状态广播、单机本地状态，所有人的手牌都可见。
  // 点 mini 卡 → 详情弹窗；自己的可用卡在弹窗里「使用」（mini 卡太小，直接点容易误触）。
  renderCardHands() {
    if (!this.playerCards) return
    const s = this.state
    const cur = getCurrentPlayer(s)
    this.playerCards.forEach((c, i) => {
      const pl = s.players[i]
      if (!pl) return
      c.handC.removeAll(true)
      const n = pl.hand.length
      if (!n) return
      // 2 列网格排布：横排会让牌互相压住图标（只剩 9px 可见），竖排又受卡片高度限制。
      // 先按 5/4/3/2/1 列试算：列宽、行高都必须在卡片框内，取能放下的最大列数（牌最大）。
      const gx = 3, gy = 3
      const maxW = c.zoneW
      const maxH = c.ch - 8
      let cols = 1, mw = 20, mh = 18
      for (let cc = Math.min(n, 5); cc >= 1; cc--) {
        const rows = Math.ceil(n / cc)
        // 牌宽下限 20：低于 20 时图标已不可辨，宁可减列数让牌更大（4 张走 2×2 而不是 3+1）
        const wTry = clamp(Math.floor((maxW - (cc - 1) * gx) / cc), 20, 24)
        const gridWTry = cc * wTry + (cc - 1) * gx
        const gridHTry = rows * 18 + (rows - 1) * gy
        if (gridWTry <= maxW && gridHTry <= Math.max(maxH, 60)) {
          cols = cc
          mw = wTry
          mh = clamp(Math.floor((maxH - (rows - 1) * gy) / rows), 18, 30)
          break
        }
      }
      const rows = Math.ceil(n / cols)
      const gridW = cols * mw + (cols - 1) * gx
      const gridH = rows * mh + (rows - 1) * gy
      const x0 = c.zoneRight - gridW + mw / 2
      const y0 = c.cy - gridH / 2 + mh / 2
      const own = this.online ? i === this.mySeat : pl.id === cur.id
      pl.hand.forEach((card, k) => {
        const x = x0 + (k % cols) * (mw + gx)
        const y = y0 + Math.floor(k / cols) * (mh + gy)
        // 用「深底 + 金边」自绘小卡：card_back 缩到 24px 后几乎全黑，图标看不清
        const bg = this.add.rectangle(x, y, mw, mh, 0x1b0f05, 0.96)
          .setStrokeStyle(1.5, 0xb98a52, 0.9)
        c.handC.add(bg)
        const icon = cardIcon(card)
        if (this.textures.exists(icon)) {
          const s2 = Math.min(mw, mh) * 0.86
          c.handC.add(this.add.image(x, y, icon).setDisplaySize(s2, s2))
        }
        bg.setInteractive({ useHandCursor: true })
        bg.on('pointerdown', () => this.openCardDetail(pl, card, own))
        bg.on('pointerover', () => this.showTip(x, y - mh / 2 - 4, `${cardName(card)}\n${cardDesc(card)}`))
        bg.on('pointerout', () => this.hideTip())
      })
    })
  }

  // 卡牌详情：名称 + 效果说明 + 持有者；自己的可用牌可当场使用
  openCardDetail(pl, card, own = false) {
    this.closeCustomPanel()
    const s = this.state
    const canUse = own && s.phase === 'awaitAction'
      && getCurrentPlayer(s).cardsUsedThisTurn < 1 && card.kind !== 'history'
    const hint = !own
      ? '（对方的手牌，仅可查看）'
      : (canUse ? '' : (card.kind === 'history'
        ? '（历史正文不可主动使用：集齐 4 块后在拉夫德鲁出航获胜）'
        : '（当前阶段不可使用，或本回合已用过卡）'))
    this.customPanel = buildModal(this, {
      title: cardName(card),
      icon: cardIcon(card),
      body: [
        cardDesc(card),
        `持有者：${pl.name}`,
        hint
      ].filter(Boolean).join('\n'),
      buttons: [
        ...(canUse ? [{ label: '✨ 使用', color: PALETTE.good, onClick: () => { this.closeCustomPanel(); this.handlePlayCard(card) } }] : []),
        { label: '关闭', color: PALETTE.neutral, onClick: () => this.closeCustomPanel() }
      ]
    })
  }

  renderModal(s, p) {
    const decisionPhases = ['awaitBuyHistory', 'awaitEventCancel', 'awaitReroll', 'awaitTarget', 'awaitTrade', 'awaitFlower']
    if (!decisionPhases.includes(s.phase)) { this.closeModal(); return }
    if (this.modal) {
      // 交易弹窗优先级最高：被别人发起交易时必须让玩家立刻看到，
      // 不能因为手上还开着一个旧弹窗就静默错过（服务端已不会再替人类代答，
      // 若客户端也被遮住，玩家会以为「自动成交」）。
      const needTrade = s.phase === 'awaitTrade' && s.modal &&
        (this.online ? s.modal.targetId === this.mySeat : true)
      if (!(needTrade && this.modal.isTrade)) return
      this.closeModal()
    }
    // 联机：需要决策但不是我的回合（AI 代打 / 强移作用于我）→ 不渲染可点弹窗，
    // 只给一条提示，避免误点发请求、也避免一直弹「服务器无响应」。
    // 例外：交易(awaitTrade)弹窗的接收方永远不是当前回合玩家（发起方才是 current），
    // 必须放行，否则被交易方永远看不到「接受/拒绝」，交易流程直接卡死。
    if (this.online && !this.myTurn() && s.phase !== 'awaitTrade') {
      const cur = getCurrentPlayer(s)
      showToast(this, `${cur.name} 正在处理…`)
      return
    }

    if (s.phase === 'awaitBuyHistory') {
      this.showModal({
        title: '发现路标历史正文！', icon: 'cell_history',
        body: `购买价格：${s.pendingHistoryPrice} 贝利\n（当前持有 ${getHistoryIds(p).length}/4）`,
        buttons: [
          { label: '购买', color: PALETTE.good, onClick: () => this.handleBuy() },
          { label: '放弃', color: PALETTE.neutral, onClick: () => this.handleDecline() }
        ]
      })
    } else if (s.phase === 'awaitFlower') {
      const evt = s.modal ? EVENT_BY_ID[s.modal.eventId] : null
      this.showModal({
        title: '🌸 花花果实：事件确认', icon: evt ? `event_${evt.id}` : null,
        body: evt ? `${evt.name}\n${evt.desc}\n\n是否让这张事件生效？` : '事件数据缺失，请选择放弃',
        buttons: [
          { label: '生效', color: PALETTE.good, onClick: () => this.handleFlower(true) },
          { label: '放弃', color: PALETTE.neutral, onClick: () => this.handleFlower(false) }
        ]
      })
    } else if (s.phase === 'awaitEventCancel') {
      // 引擎只下发 { type:'observationCancel', eventId }（engine.js resolveEventCell），
      // 事件内容要用 EVENT_BY_ID 反查。此前误读 s.modal.event → undefined.name 抛异常，
      // 使 refresh() 中断在该行：按钮全灰、决策弹窗不出现 → 整局软锁死。
      const ev = EVENT_BY_ID[s.modal && s.modal.eventId] || null
      this.showModal({
        title: '负面事件：' + (ev ? ev.name : '未知事件'), icon: ev ? `event_${ev.id}` : null,
        body: `${ev ? ev.desc : '抽到一张负面事件。'}\n是否消耗见闻色霸气取消？`,
        buttons: [
          {
            label: '见闻色取消', color: PALETTE.blue, onClick: () => {
              if (this.online) this.socket.emit('game:eventCancel', { cancel: true }, () => {})
              else { decisionEventCancel(s, true); this.refresh() }
            }
          },
          {
            label: '承受', color: PALETTE.neutral, onClick: () => {
              if (this.online) this.socket.emit('game:eventCancel', { cancel: false }, () => {})
              else { decisionEventCancel(s, false); this.refresh() }
            }
          }
        ]
      })
    } else if (s.phase === 'awaitReroll') {
      const first = s.pendingReroll.first
      this.showModal({
        title: '乌索普：是否重掷？', icon: 'skill_5',
        body: `第一次点数：${first.total}（${first.d1}+${first.d2}）`,
        buttons: [
          {
            label: '重掷', color: PALETTE.good, onClick: () => {
              if (this.online) this.socket.emit('game:reroll', { reroll: true }, () => {})
              else { decisionReroll(s, true); this.refresh() }
            }
          },
          {
            label: '保留', color: PALETTE.neutral, onClick: () => {
              if (this.online) this.socket.emit('game:reroll', { reroll: false }, () => {})
              else { decisionReroll(s, false); this.refresh() }
            }
          }
        ]
      })
    } else if (s.phase === 'awaitTarget') {
      const others = s.players.filter((x) => !x.bankrupt && x.id !== p.id)
      this.showModal({
        title: '选择目标',
        body: others.map((o) => `${o.name}（${o.cash} 贝利）`).join('\n'),
        buttons: [
          ...others.map((o) => ({
            label: o.name, color: PALETTE.blue, onClick: () => {
              if (this.online) this.socket.emit('game:confirmTarget', { targetId: o.id }, () => {})
              else { confirmFruitTarget(s, o.id); this.refresh() }
            }
          })),
          {
            label: '取消', color: PALETTE.neutral, onClick: () => {
              if (this.online) this.socket.emit('game:cancelTarget', {}, () => {})
              else { cancelTarget(s); this.refresh() }
            }
          }
        ]
      })
    } else if (s.phase === 'awaitTrade') {
      const m = s.modal
      // 联机看座位号；单机只有一台机器在操作（autoPlay 关闭时没有任何 AI 会推进），
      // 所以本地永远由玩家拍板，否则交易会停在「等待对方回应」把整局卡死。
      const iAmTarget = this.online ? m.targetId === this.mySeat : true
      const from = s.players.find((x) => x.id === m.fromId) || { name: '对方' }
      const me = s.players.find((x) => x.id === m.targetId) || p
      // direction='sell'：发起方卖给我 → 我付钱拿正文；'buy'：发起方买我的 → 我收钱让出正文
      const iPay = m.direction === 'sell'
      if (iAmTarget) {
        // 我是被交易方：只有这里能拍板，服务端会一直等到我点（30 秒无回应按拒绝处理）
        const mine = getHistoryIds(me).length
        const after = me.cash + (iPay ? -m.price : m.price)
        const canAfford = !iPay || me.cash >= m.price
        this.showModal({
          title: '🤝 有人向你发起交易', icon: 'cell_history', align: 'left', width: 460,
          sections: [
            {
              text: iPay ? `${from.name} 想把一块路标历史正文卖给你` : `${from.name} 想收购你的路标历史正文`,
              size: 17, color: '#3a2812', gap: 10
            },
            { text: `成交价：${m.price} 贝利`, size: 21, bold: true, color: '#8a4a1a', gap: 10 },
            {
              text: iPay
                ? (canAfford ? `你的现金：${me.cash} → ${after}` : `你的现金 ${me.cash}，不足以支付 ${m.price}`)
                : `你的现金：${me.cash} → ${after}`,
              size: 15, color: canAfford ? '#5a4a2a' : '#a0331f', gap: 6
            },
            {
              text: `你的正文：${mine}/4 → ${mine + (iPay ? 1 : -1)}/4`,
              size: 15, color: '#5a4a2a', gap: 6
            },
            { text: '30 秒内不回应将视为拒绝', size: 13, color: '#8a7a5a', gap: 2 }
          ],
          buttons: [
            {
              label: canAfford ? '接受' : '接受（现金不足）', color: PALETTE.good, enabled: canAfford, onClick: () => {
                if (this.online) this.socket.emit('game:trade', { accept: true }, () => {})
                else { decisionTrade(s, true); this.refresh() }
              }
            },
            {
              label: '拒绝', color: PALETTE.neutral, onClick: () => {
                if (this.online) this.socket.emit('game:trade', { accept: false }, () => {})
                else { decisionTrade(s, false); this.refresh() }
              }
            }
          ]
        })
        // 标记：让 renderModal 知道当前弹窗就是交易弹窗（避免被重复重建）
        if (this.modal) this.modal.isTrade = true
        // 有人要跟你交易：给一声提示，避免专注看棋盘时错过
        this.playSfx('sfx_card_draw', 0.75)
        showToast(this, `🤝 ${from.name} 向你发起交易，请选择接受或拒绝`)
      } else {
        // 我可能是发起方，也可能是第三方：只展示进展，不给可点决策按钮
        const targetName = (s.players.find((x) => x.id === m.targetId) || {}).name || '对方'
        const iAmFrom = m.fromId === this.mySeat
        this.showModal({
          title: '路标历史正文交易', icon: 'cell_history', align: 'left', width: 440,
          sections: [{
            text: iAmFrom
              ? `已向 ${targetName} 发起交易（${m.price} 贝利）\n等待对方回应…`
              : `${from.name} 正向 ${targetName} 发起交易（${m.price} 贝利）\n等待对方回应…`,
            size: 16, color: '#3a2812', gap: 2
          }],
          buttons: [{ label: '知道了', color: PALETTE.neutral, onClick: () => this.closeModal() }]
        })
      }
    }
  }

  // ---------- 结算 ----------
  // 程序化胜利演出：聚光圈 + 金币喷泉 + 彩带。
  // 不依赖 FX 素材（那批 8 帧位图质量不达标已关，见 fxConfig.js）——
  // 金币/彩带纹理用 Graphics 运行时生成，粒子用 Phaser 3.60+ 发射器。
  playVictoryFx(wSeat) {
    if (wSeat == null || !this.tokenSprites[wSeat]) return
    const t = this.tokenSprites[wSeat]
    if (!this.textures.exists('vfx_coin')) {
      const g = this.add.graphics()
      g.fillStyle(0xf7c531, 1); g.fillCircle(12, 12, 11)
      g.fillStyle(0xffe9a3, 1); g.fillCircle(12, 12, 8)
      g.fillStyle(0xd9a325, 1); g.fillCircle(12, 12, 4)
      g.generateTexture('vfx_coin', 24, 24)
      g.clear()
      g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 7, 14)
      g.generateTexture('vfx_confetti', 7, 14)
      g.destroy()
    }
    // 聚光：金色光圈自胜者棋子扩散两轮，棋子轻轻上浮示意「当选」
    for (let i = 0; i < 2; i++) {
      const ring = this.add.circle(t.x, t.y, 14).setStrokeStyle(4, 0xffd76a, 0.9).setDepth(860)
      this.tweens.add({
        targets: ring, radius: this.cell * 1.7, alpha: 0,
        duration: 720, delay: i * 320, ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy()
      })
    }
    const baseY = t.y
    this.tweens.add({ targets: t, y: baseY - 14, duration: 380, yoyo: true, ease: 'Sine.easeInOut' })
    // 金币喷泉：胜者格子左右双喷口，向上喷后受重力落下
    for (const dx of [-0.7, 0.7]) {
      const p = this.add.particles(t.x + dx * this.cell, t.y, 'vfx_coin', {
        speed: { min: 180, max: 330 }, angle: { min: 253, max: 287 }, gravityY: 640,
        lifespan: { min: 700, max: 1100 }, scale: { start: 1.1, end: 0.35 },
        rotate: { start: 0, end: 360 }, quantity: 4, frequency: 60, duration: 900
      }).setDepth(870)
      this.time.delayedCall(2200, () => p.destroy())
    }
    // 彩带：全屏顶部五色飘落，盖过结算面板出现的前后
    const conf = this.add.particles(0, 0, 'vfx_confetti', {
      x: { min: 0, max: this.W }, y: -14,
      speedY: { min: 90, max: 210 }, speedX: { min: -60, max: 60 },
      rotate: { start: 0, end: 320 }, lifespan: 3200,
      quantity: 2, frequency: 90, duration: 2400,
      tint: [0xef5a48, 0xffd76a, 0x6cb2f5, 0x6bd58f, 0xc39be0],
      alpha: { start: 1, end: 0.4 }, scale: { min: 0.7, max: 1.2 }
    }).setDepth(1005) // 彩带飘在暗幕与面板之上，收尾庆祝感
    this.time.delayedCall(3600, () => conf.destroy())
  }

  showVictory(winner) {
    if (this.victoryShown || !winner) return
    this.victoryShown = true
    const s = this.state
    this.closeModal()
    this.closeCustomPanel()
    this.hideTip()
    this.playSfx('sfx_victory', 0.9)
    // 脱敏广播下 s.players 是按座位重建的副本，winner 以 id 重新对齐，
    // 否则 indexOf(winner) 失配、胜者棋子特效找不到挂载点
    const w = s.players.find((x) => x.id === winner.id) || winner
    const wSeat = s.players.indexOf(w)
    this.playVictoryFx(wSeat)
    this.tokenSprites.forEach((t, i) => { if (i !== wSeat) t.setVisible(false) })

    // 舞台：暗幕先压下来，结算面板随后弹入（给聚光/金币留 ~0.9s 高光时刻）
    const layer = this.add.container(0, 0).setDepth(1000)
    const dim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.78).setInteractive().setAlpha(0)
    layer.add(dim)
    this.tweens.add({ targets: dim, alpha: 0.78, duration: 460, ease: 'Quad.easeOut' })
    const panelC = this.add.container(0, -40).setAlpha(0)
    layer.add(panelC)
    const pw = Math.min(560, this.W - 64)
    const ph = Math.min(500, this.H - 64)
    const top = this.H / 2 - ph / 2
    panelC.add(makePanel(this, this.W / 2, this.H / 2, pw, ph, { fill: 0x1c1206, fillAlpha: 0.96 }))
    const title = this.add.text(this.W / 2, top + 22, '🏆 航海王诞生 🏆', textStyle(TYPE.display, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0.5, 0)
    panelC.add(title)

    // 胜者立绘放大展示：金色光晕 + 金边框 + 大图（portrait_N 与所选角色对应）
    const pSize = Math.min(200, ph - 310)
    const pcy = top + 96 + pSize / 2
    panelC.add(this.add.circle(this.W / 2, pcy, pSize / 2 + 18, 0xf7c531, 0.22))
    panelC.add(makeRounded(this, pSize + 12, pSize + 12, { fill: 0x2a1a08, fillAlpha: 0.9, stroke: 0xffd76a, strokeAlpha: 0.95, strokeW: 3, r: 18 }))
    const portraitKey = `portrait_${w.charId}`
    if (this.textures.exists(portraitKey)) {
      panelC.add(this.add.image(this.W / 2, pcy, portraitKey).setDisplaySize(pSize, pSize))
    }

    // 名字 + 胜者一行摘要；完整四人数据收进「数据详情」弹层，不再铺满面板
    const nameY = top + 110 + pSize
    panelC.add(this.add.text(this.W / 2, nameY, `${w.name} 成为海贼王！`, textStyle(TYPE.title, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5, 0))
    panelC.add(this.add.text(this.W / 2, nameY + 34,
      `总资产 ${playerAssets(s, w)} 贝利 · 岛屿 ${w.islandIds.length} 座 · 历史正文 ${getHistoryIds(w).length}/4`,
      textStyle(TYPE.bodySmall, '#e8d8b0')
    ).setOrigin(0.5, 0))

    this.tweens.add({
      targets: panelC, y: 0, alpha: 1,
      duration: 520, delay: 1150, ease: 'Back.easeOut'
    })
    // 标题在面板落位后再弹一下，收住视线
    title.setScale(0.4)
    this.tweens.add({ targets: title, scale: 1, duration: 420, delay: 1650, ease: 'Back.easeOut' })

    // 排名 + 数据统计（PRD §9）：按钮弹层查看。buildModal 默认 depth 500，
    // 会被胜利层（1000）盖住，这里手动提到 1005
    const ranked = [...s.players].sort((a, b) => playerAssets(s, b) - playerAssets(s, a))
    const statsBody = ranked.map((pl, i) => {
      const isl = pl.islandIds.length
      const his = getHistoryIds(pl).length
      const total = playerAssets(s, pl)
      const ev = (pl.stats && pl.stats.eventsDrawn) || 0
      const cards = (pl.stats && pl.stats.cardsUsed) || 0
      return `${i + 1}. ${pl.name}　总资产 ${total} 贝利（现金 ${pl.cash}）\n　岛屿 ${isl} 座 · 历史正文 ${his}/4 · 抽事件 ${ev} 次 · 用卡 ${cards} 张${pl.bankrupt ? ' · 破产' : ''}`
    }).join('\n')
    const showStats = () => {
      this.closeCustomPanel()
      this.customPanel = buildModal(this, {
        title: '📊 结算数据', width: 540,
        body: statsBody,
        buttons: [{ label: '关闭', color: PALETTE.neutral, onClick: () => this.closeCustomPanel() }]
      })
      if (this.customPanel && this.customPanel.root) this.customPanel.root.setDepth(1005)
    }

    // 按钮三连：数据详情（左）/ 再来一局（中，C 位）/ 返回大厅（右）
    const startAgain = () => {
      if (this.online) {
        // 再来一局（PRD §7）：房内任意真人可发起，服务器保留座位、清空状态、全员回选角
        emitAck(this, this.socket, 'game:restart', {}, (res) => {
          if (!res.ok) return showToast(this, res.error || '无法再来一局')
          this.scene.start('SelectScene')
        })
      } else {
        this.scene.start('BoardScene', { autoPlay: false })
      }
    }
    const bw = Math.min(170, Math.floor((pw - 48) / 3) - 6)
    const btnY = this.H / 2 + ph / 2 - 42
    const btnStats = makeButton(this, {
      x: this.W / 2 - bw - 8, y: btnY, w: bw, h: 48,
      label: '📊 数据详情', color: PALETTE.blue, fontSize: TYPE.body, onClick: showStats
    })
    const btnAgain = makeButton(this, {
      x: this.W / 2, y: btnY, w: bw, h: 48,
      label: '⚔️ 再来一局', color: PALETTE.good, fontSize: TYPE.body, onClick: startAgain
    })
    const btnBack = makeButton(this, {
      x: this.W / 2 + bw + 8, y: btnY, w: bw, h: 48,
      label: '返回大厅', color: PALETTE.neutral, fontSize: TYPE.body,
      onClick: () => this.scene.start('LobbyScene')
    })
    panelC.add(btnStats.root)
    panelC.add(btnAgain.root)
    panelC.add(btnBack.root)
  }
}
