import Phaser from 'phaser'
import { CHARACTERS } from '../../../shared/gameData.js'
import {
  PALETTE, COLOR_TEXT, TYPE, textStyle, monoStyle, wrap, clamp,
  fitCover, makeButton, showToast, onSceneResize, makeRounded
} from '../ui/uiKit.js'

const PICK_SECONDS = 60

export default class SelectScene extends Phaser.Scene {
  constructor() { super('SelectScene') }

  create() {
    this.socket = this.game.registry.get('socket')
    this.roomData = null
    this.myCharId = null
    this.mySeat = null
    this.deadline = null
    this.timeoutDone = false
    this.charButtons = []

    // 座位号（联机）：与大厅同一套服务器下发机制
    this.socket.off('game:seat')
    this.socket.on('game:seat', (seat) => { this.mySeat = seat })

    // 进选角界面即拉一次房间视图：拿 selectDeadline（服务器倒计时），
    // 同时让服务器把倒计时启动起来（room:view 副作用）
    if (this.socket.connected) {
      this.socket.emit('room:view', {}, (res) => {
        if (res && res.ok) {
          this.roomData = res.room
          this.renderChars()
        }
      })
    }

    this.socket.off('room:update')
    this.socket.on('room:update', (room) => {
      this.roomData = room
      this.renderChars()
    })

    this.socket.off('game:state')
    this.socket.on('game:state', (state) => {
      // 带上座位号：棋盘要靠它判定「是否我的回合」
      // game:seat 未到达时（极端时序），从房间视图兜底推算
      if (this.mySeat == null && this.roomData) {
        const me = this.roomData.players.findIndex((p) => p.isYou)
        if (me >= 0) this.mySeat = me
      }
      this.scene.start('BoardScene', { state, seat: this.mySeat })
    })

    onSceneResize(this, (w, h) => {
      if (w === this.W && h === this.H) return
      this.rebuild()
    })

    this.build()
  }

  build() {
    this.W = this.scale.width
    this.H = this.scale.height
    this.compact = this.W < 620

    const bg = this.add.image(0, 0, 'bg_pick').setOrigin(0, 0)
    fitCover(bg, this.W, this.H)
    this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x051830, 0.45)

    const titleSize = clamp(Math.round(this.W * 0.04), 20, 32)
    this.add.text(this.W / 2, Math.max(24, this.H * 0.06), '选择你的航海士', {
      ...textStyle(titleSize, COLOR_TEXT.title, { fontStyle: 'bold', stroke: '#1a0a00', strokeThickness: 5 })
    }).setOrigin(0.5)

    this.timerTxt = this.add.text(this.W - 24, Math.max(24, this.H * 0.06), '', monoStyle(TYPE.number, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(1, 0.5)

    // 左上角花名册：谁选了谁（联机时实时刷新，证明「选英雄生效了」）
    this.rosterTxt = this.add.text(20, Math.max(24, this.H * 0.06) - 8, '', textStyle(TYPE.caption, COLOR_TEXT.body, { lineSpacing: 4 }))

    this.cardsLayer = this.add.container(0, 0)
    this.layoutCards()

    const btnY = this.H - Math.max(56, this.H * 0.09)
    this.startBtn = makeButton(this, {
      x: this.W / 2, y: btnY, w: clamp(this.W - 120, 180, 220), h: 52,
      label: '出 航', color: 0xa83a2a, fontSize: TYPE.section,
      onClick: () => this.startGame()
    })
    this.startHint = this.add.text(this.W / 2, btnY + 36, '', textStyle(TYPE.caption, COLOR_TEXT.muted, { align: 'center', ...wrap(this.W - 80) })).setOrigin(0.5)

    this.renderChars()
    this.updateStartState()
  }

  rebuild() {
    this.children.removeAll(true)
    this.charButtons = []
    this.build()
  }

  layoutCards() {
    this.cardsLayer.removeAll(true)
    this.charButtons = []
    // 顶部让位标题/花名册，底部给「出航」按钮 + 提示行留足空间
    const top = Math.max(72, this.H * 0.13)
    const bottom = this.H - Math.max(110, this.H * 0.19)
    const availH = bottom - top

    if (this.compact) {
      const cw = this.W - 40
      const ch = 76
      const gap = 8
      const totalH = CHARACTERS.length * ch + (CHARACTERS.length - 1) * gap
      const scale = Math.min(1, availH / totalH)
      this.cardsLayer.setScale(scale)
      const x = 20
      const startY = top + (availH - totalH * scale) / 2 / scale
      CHARACTERS.forEach((c, i) => {
        const y = startY + i * (ch + gap) + ch / 2
        this.charButtons.push(this.makeCard(c, x, y, cw, ch, true))
      })
      return
    }

    // 10 张卡片固定 5×2；卡片高度按可用空间反推，保证 desc 不溢出、不压按钮
    const cols = this.W >= 1100 ? 5 : this.W >= 860 ? 4 : 3
    const gap = 14
    const rows = Math.ceil(CHARACTERS.length / cols)
    const cw = Math.min(190, (this.W - 40 - (cols - 1) * gap) / cols)
    // 图像 55% 宽 + 名字/职衔/技能名 3 行 + 描述 3 行 + 上下留白
    const chNeeded = Math.round(cw * 0.5) + 18 + 22 + 22 + 52 + 14
    const ch = Math.min(chNeeded, Math.floor((availH - (rows - 1) * gap) / rows))
    const totalH = rows * ch + (rows - 1) * gap
    const scale = Math.min(1, availH / totalH)
    this.cardsLayer.setScale(scale)
    const totalW = cols * cw + (cols - 1) * gap
    const startX = (this.W - totalW) / 2 + cw / 2
    const startY = top + (availH - totalH * scale) / 2 / scale + ch / 2
    CHARACTERS.forEach((c, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = startX + col * (cw + gap)
      const y = startY + row * (ch + gap)
      this.charButtons.push(this.makeCard(c, x, y, cw, ch, false))
    })
  }

  makeCard(c, x, y, cw, ch, compact) {
    const cont = this.add.container(x, y)
    const bg = makeRounded(this, cw, ch, { fill: 0x241a0e, stroke: PALETTE.gold, strokeW: 2, r: 14 })
    const lock = this.add.text(0, 0, '', textStyle(compact ? 12 : 12, '#ffd966', { fontStyle: 'bold' })).setOrigin(0.5).setVisible(false)
    cont.add([bg, lock])

    if (compact) {
      const imgSize = Math.min(60, ch - 12)
      const img = this.add.image(-cw / 2 + 12 + imgSize / 2, 0, `portrait_${c.id}`).setDisplaySize(imgSize, imgSize)
      const name = this.add.text(-cw / 2 + imgSize + 24, -ch / 2 + 12, `${c.name}｜${c.title}`, textStyle(TYPE.body, '#ffffff', { fontStyle: 'bold' })).setOrigin(0, 0)
      const skill = this.add.text(-cw / 2 + imgSize + 24, -ch / 2 + 34,
        `${c.skillName}（${c.skillType === 'active' ? `主动·${c.skillUses}次` : '被动'}）`,
        textStyle(TYPE.caption, COLOR_TEXT.gold)).setOrigin(0, 0)
      const desc = this.add.text(-cw / 2 + imgSize + 24, -ch / 2 + 54, c.desc,
        textStyle(11, COLOR_TEXT.body, { ...wrap(cw - imgSize - 40) })).setOrigin(0, 0)
      cont.add([img, name, skill, desc])
      cont.cardParts = { bg, img, lock, texts: [name, skill, desc] }
    } else {
      // 布局纵向预算（自上而下）：头像 55%宽 → 名字 → 职衔 → 技能名 → 描述（剩余全部）
      const imgSize = Math.round(cw * 0.5)
      const img = this.add.image(0, -ch / 2 + imgSize / 2 + 8, `portrait_${c.id}`).setDisplaySize(imgSize, imgSize)
      let yy = -ch / 2 + imgSize + 14
      const name = this.add.text(0, yy, c.name, textStyle(TYPE.section, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5, 0)
      yy += 24
      const title = this.add.text(0, yy, `${c.title}｜${c.skillType === 'active' ? `主动 ${c.skillUses} 次` : '被动'}`, textStyle(TYPE.caption, COLOR_TEXT.gold)).setOrigin(0.5, 0)
      yy += 20
      const skill = this.add.text(0, yy, c.skillName, textStyle(TYPE.bodySmall, '#ffe9a8', { fontStyle: 'bold', align: 'center', ...wrap(cw - 14) })).setOrigin(0.5, 0)
      // 描述从技能名下缘起排，底部留 6px 安全边，绝不溢出卡片
      const descY = yy + 20
      const desc = this.add.text(0, descY, c.desc, textStyle(11, COLOR_TEXT.body, { align: 'center', lineSpacing: 2, ...wrap(cw - 16) })).setOrigin(0.5, 0)
      // 描述行数超预算时整体上移文字块，保持视觉重心
      const descLines = Math.ceil(c.desc.length / Math.floor((cw - 16) / 11))
      const overflow = descY + descLines * 14 + 6 - (ch / 2)
      if (overflow > 0) {
        const shift = Math.min(overflow, imgSize * 0.12)
        name.y -= shift; title.y -= shift; skill.y -= shift; desc.y -= shift
      }
      cont.add([img, name, title, skill, desc])
      cont.cardParts = { bg, img, lock, texts: [name, title, skill, desc] }
    }

    cont.setSize(cw, ch)
    cont.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true
    })
    // 与按钮同理：校正 Container 命中区原点，避免点击区左移半个卡片
    if (cont.input && cont.input.hitArea) { cont.input.hitArea.x = 0; cont.input.hitArea.y = 0 }
    cont.on('pointerover', () => { if (!cont.locked) cont.setScale(1.02) })
    cont.on('pointerout', () => cont.setScale(1))
    // 与按钮一致：按下即选中，避免抬起时指针已移出卡片导致“点了没反应”
    cont.on('pointerdown', () => this.pickChar(c.id))
    this.cardsLayer.add(cont)
    return { id: c.id, cont, bg, img: cont.cardParts.img, lock }
  }

  takenMap() {
    const map = {}
    if (this.roomData && this.roomData.players) {
      this.roomData.players.forEach((p) => {
        if (p.charId && !p.isYou) map[p.charId] = p.charName || p.name
      })
    }
    return map
  }

  renderChars() {
    // 服务器已替我分配/我曾在别端选过：本地跟进，避免显示成「未选角」
    const me = this.roomData && this.roomData.players
      ? this.roomData.players.find((x) => x.isYou)
      : null
    if (me && me.charId && this.myCharId == null) this.myCharId = me.charId
    const taken = this.takenMap()
    // 花名册：列出房间内每个人的选角状态（自己标 ★，AI 标 🤖）
    if (this.rosterTxt && this.roomData && this.roomData.players) {
      const nameOf = (id) => (CHARACTERS.find((c) => c.id === id) || {}).name || '?'
      const lines = this.roomData.players.map((p) => {
        // 名字取角色名：未选角时显示座位号，选了角色就直接显示角色名（不再有自定义昵称）
        const who = p.isAI ? '🤖 AI' : (p.isYou ? '★ 你' : (p.charName || p.name))
        return `${who}：${p.charId ? `已选 ${nameOf(p.charId)}` : '选角中…'}`
      })
      this.rosterTxt.setText(lines.join('\n'))
    }
    this.charButtons.forEach((b) => {
      const by = taken[b.id]
      const isMe = this.myCharId === b.id
      b.cont.locked = !!by && !isMe
      if (by && !isMe) {
        b.bg.setStyle({ fill: 0x222222, stroke: 0x555555, strokeAlpha: 1, strokeW: 1 })
        b.img.setAlpha(0.25).setTint(0x888888)
        b.lock.setText(`🔒 ${by} 已选`).setVisible(true)
        b.lock.setPosition(0, b.cont.cardParts.bg.height / 2 - 16)
      } else if (isMe) {
        b.bg.setStyle({ fill: 0x1a4a2a, stroke: 0x7cfc8a, strokeW: 2 })
        b.img.setAlpha(1).clearTint()
        b.lock.setText('✓ 已选择').setVisible(true)
        b.lock.setPosition(0, b.cont.cardParts.bg.height / 2 - 16)
      } else {
        b.bg.setStyle({ fill: 0x241a0e, stroke: PALETTE.gold, strokeW: 2 })
        b.img.setAlpha(1).clearTint()
        b.lock.setVisible(false)
      }
    })
    this.updateStartState()
  }

  updateStartState() {
    if (!this.startBtn) return
    const isHost = this.roomData && this.roomData.players.some((p) => p.isYou && p.isHost)
    if (!this.socket.connected) {
      this.startBtn.setEnabled(true)
      this.startHint.setText('单机模式：直接开始对局')
      return
    }
    const needPick = !this.myCharId
    this.startBtn.setEnabled(!needPick && !!isHost)
    let hint
    if (needPick) hint = '请先选择一名角色，未选择无法出航'
    else if (!isHost) hint = '已选角，等待房主出航'
    else hint = '全员就绪后点击出航（空位自动补 AI）'
    this.startHint.setText(hint)
  }

  pickChar(id) {
    if (!this.socket.connected) { this.myCharId = id; this.renderChars(); return }
    // 已离船（房间对局进行中）：选角必然被拒，直接回大厅，不再反复弹提示
    const r = this.roomData
    if (r && r.started) {
      showToast(this, '你已离开该房间，返回大厅')
      this.time.delayedCall(900, () => this.scene.start('LobbyScene'))
      return
    }
    const taken = this.takenMap()
    if (taken[id]) { showToast(this, `${taken[id]} 已选择该角色`); return }
    this.myCharId = id
    this.socket.emit('player:selectChar', { charId: id }, (res) => {
      if (!res.ok) {
        this.myCharId = null
        showToast(this, res.error || '选择失败')
        // 明确被告知房间已开始：本地状态已过期，回大厅
        if (/已开始|不存在/.test(res.error || '')) {
          this.roomData = null
          this.time.delayedCall(900, () => this.scene.start('LobbyScene'))
        }
      }
      this.renderChars()
    })
    this.renderChars()
  }

  startGame() {
    if (!this.socket.connected) {
      this.scene.start('BoardScene', { autoPlay: false })
      return
    }
    if (!this.myCharId) { showToast(this, '请先选择角色'); return }
    this.socket.emit('game:start', (res) => {
      if (!res.ok) showToast(this, res.error || '无法开始')
    })
  }

  update(time) {
    // 倒计时以服务器下发的 selectDeadline 为准（PRD §8.4：超时分配由服务器执行）；
    // 单机（未连服务器）才用本地计时并本地代选
    const serverDeadline = this.socket.connected && this.roomData
      ? this.roomData.selectDeadline
      : null
    if (serverDeadline == null && this.deadline == null) this.deadline = time + PICK_SECONDS * 1000
    const deadline = serverDeadline != null ? serverDeadline : this.deadline
    const now = serverDeadline != null ? Date.now() : time
    const left = Math.max(0, Math.ceil((deadline - now) / 1000))
    if (this.timerTxt) {
      this.timerTxt.setText(left > 0 ? `${left}s` : '')
      this.timerTxt.setColor(left <= 10 ? COLOR_TEXT.danger : COLOR_TEXT.title)
    }
    if (left <= 0 && !this.timeoutDone) {
      this.timeoutDone = true
      // 已离船 / 房间已开始：不要再替用户发选角请求
      if (!this.socket.connected || (this.roomData && this.roomData.started)) return
      // 联机：服务器到点会自动分配并广播，客户端不再本地代选（避免撞车）
      if (serverDeadline != null) {
        showToast(this, '选角倒计时结束，等待系统分配角色…')
        return
      }
      const taken = this.takenMap()
      const free = CHARACTERS.filter((c) => !taken[c.id])
      const pick = (free[Math.floor(Math.random() * free.length)] || CHARACTERS[0]).id
      showToast(this, '选角超时，已自动为你选择角色')
      this.pickChar(pick)
    }
  }
}
