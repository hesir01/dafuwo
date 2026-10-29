import Phaser from 'phaser'
import {
  PALETTE, COLOR_TEXT, TYPE, textStyle, monoStyle, wrap, clamp,
  fitCover, makePanel, makeWoodPanel, makeButton, showToast, onSceneResize,
  emitAck, makeConnBadge
} from '../ui/uiKit.js'
import { openSettingsPanel, playSfx, loadSettings } from '../ui/settings.js'
import { createChatLog, openChatInput, sendChat } from '../ui/chat.js'
import { saveResume, loadResume, clearResume } from '../ui/resume.js'

export default class LobbyScene extends Phaser.Scene {
  constructor() { super('LobbyScene') }

  create(data = {}) {
    this.socket = this.game.registry.get('socket')
    this.roomData = null

    this.socket.off('room:update')
    this.socket.on('room:update', (room) => {
      this.roomData = room
      this.rebuild()
    })

    this.socket.off('chat:message')
    this.socket.on('chat:message', (msg) => {
      this.chatHistory = this.chatHistory || []
      this.chatHistory.push(msg)
      if (this.chatHistory.length > 8) this.chatHistory.shift()
      if (this.chatLog) this.chatLog.push(msg)
    })

    // 座位号：服务器按连接单点下发，联机时用它区分「我的回合」与「别人回合」
    this.socket.off('game:seat')
    this.socket.on('game:seat', (seat) => { this.mySeat = seat })

    // 主动退出对局后进大厅：一段时间内忽略该房间的 game:state（防止被立刻拽回棋盘）
    this.lobbyMode = !!(data && data.lobbyMode)
    if (this.lobbyMode) setTimeout(() => { this.lobbyMode = false }, 8000)

    this.socket.off('game:state')
    this.socket.on('game:state', (state) => {
      // 已结束的对局不再拉人进棋盘（重连旧房间时服务器会重发状态）
      if (!state || state.phase === 'ended') {
        localStorage.removeItem('op_game_old_id')
        showToast(this, '该房间对局已结束')
        return
      }
      if (this.lobbyMode) return // 玩家刚主动退出对局：留在大厅，不重新进棋盘
      this.scene.start('BoardScene', { state, seat: this.mySeat })
    })

    onSceneResize(this, (w, h) => {
      if (w === this.W && h === this.H) return
      this.rebuild()
    })

    this.build()

    // 断线重连：用「旧 socketId + 座位私发 token」恢复座位（缺 token 会被服务端拒绝）
    const saved = loadResume()
    if (saved) {
      this.socket.emit('room:reconnect', { oldSocketId: saved.id, resumeToken: saved.token }, (res) => {
        if (res && res.ok) {
          saveResume(this.socket.id, res.resumeToken || saved.token)
          this.roomData = res.room
          this.rebuild()
        } else {
          clearResume()
          this.rebuild()
        }
      })
    }
  }

  build() {
    this.W = this.scale.width
    this.H = this.scale.height
    const cx = this.W / 2

    const bg = this.add.image(0, 0, 'bg_lobby').setOrigin(0, 0)
    fitCover(bg, this.W, this.H)
    this.add.rectangle(cx, this.H / 2, this.W, this.H, 0x051830, 0.35)

    const titleSize = clamp(Math.round(this.W * 0.045), 22, 36)
    this.add.text(cx, Math.max(22, this.H * 0.05), '航海王大富翁', {
      ...textStyle(titleSize, COLOR_TEXT.title, { fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 4 })
    }).setOrigin(0.5)

    // 连接状态：联机按钮依赖服务器，未连上时明确显示，避免“点了没反应”
    makeConnBadge(this, this.socket, this.W - 16, Math.max(20, this.H * 0.06))

    // 设置入口：右上角齿轮，不挤占主按钮区
    makeButton(this, {
      x: this.W - 42, y: Math.max(48, this.H * 0.06 + 30), w: 44, h: 44,
      label: '⚙', color: PALETTE.neutral, fontSize: TYPE.section,
      onClick: () => {
        playSfx(this, 'sfx_button_click', 0.6)
        openSettingsPanel(this)
      }
    })

    // 素材木牌面板（透明底不规则边），装饰边向外溢出约 6%
    const panelW = Math.min(this.W - 40, 620)
    const panelH = Math.min(this.H - 150, 530)
    makeWoodPanel(this, cx, this.H / 2 + 10, panelW, panelH)

    if (this.roomData) this.renderRoom()
    else this.showJoinForm()
  }

  rebuild() {
    this.children.removeAll(true)
    this.build()
  }

  buttonWidth() {
    return clamp(this.W - 96, 220, 300)
  }

  // 木牌素材面板上的文字：浅棕底色，统一加深描边保证可读
  panelText(x, y, str, size, color, extra = {}) {
    return this.add.text(x, y, str, {
      ...textStyle(size, color, { stroke: '#2a1a08', strokeThickness: 3, ...extra })
    })
  }

  makeBigBtn(y, label, color, onClick) {
    return makeButton(this, {
      x: this.W / 2, y, w: this.buttonWidth(), h: 66,
      label, color, fontSize: TYPE.section, wood: true, onClick
    })
  }

  showJoinForm() {
    const cy = this.H / 2 + 10
    const gap = 80 // 64 高 + 16 间距
    // 建房人数 2-4 人：直接做进「创建房间」按钮，点击循环切换（不再外挂步进条）
    this.hostSize = this.hostSize || 4
    const createBtn = this.makeBigBtn(cy - gap, `创建房间 · ${this.hostSize}人局`, PALETTE.good, () => {
      emitAck(this, this.socket, 'room:create', { maxPlayers: this.hostSize }, (res) => {
        if (!res.ok) return showToast(this, res.error || '创建房间失败')
        saveResume(res.socketId || this.socket.id, res.resumeToken)
        this.roomData = res.room
        this.rebuild()
      })
    })
    // 左右各挂一个小「‹ ›」翻人数（相对按钮定位，跟随按钮宽度，不再压其他元素）
    const flip = (d) => {
      this.hostSize = ((this.hostSize - 2 + d + 3) % 3) + 2
      createBtn.setLabel(`创建房间 · ${this.hostSize}人局`)
    }
    makeButton(this, {
      x: this.W / 2 - createBtn.w / 2 - 26, y: cy - gap, w: 36, h: 44,
      label: '‹', color: 0x6b4a2a, fontSize: TYPE.section, onClick: () => flip(-1)
    })
    makeButton(this, {
      x: this.W / 2 + createBtn.w / 2 + 26, y: cy - gap, w: 36, h: 44,
      label: '›', color: 0x6b4a2a, fontSize: TYPE.section, onClick: () => flip(1)
    })

    this.makeBigBtn(cy, '加入房间', PALETTE.blue, () => this.showCodeModal())
    this.makeBigBtn(cy + gap, '单机练习', 0xc9a84c, () => this.scene.start('BoardScene', { autoPlay: !!loadSettings().autoPlay }))
    this.panelText(this.W / 2, cy + gap + 52, '点 ‹ › 切换开局人数（2-4 人，空位自动补 AI）· 单机练习可直接体验完整对局', TYPE.caption, '#ffe9a8').setOrigin(0.5)
  }

  // 游戏内房间号输入：不再使用浏览器原生 prompt
  showCodeModal() {
    let code = ''
    const W = this.W
    const H = this.H
    const pw = Math.min(420, W - 48)
    const layer = this.add.container(0, 0).setDepth(500)
    layer.add(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6).setInteractive())
    const ph = 260
    layer.add(makePanel(this, W / 2, H / 2, pw, ph, {
      fill: PALETTE.parchment, fillAlpha: 1, frame: 0x6b4a2a, gold: 0x8a6238
    }))

    const cx = W / 2
    const top = H / 2 - ph / 2
    layer.add(this.add.text(cx, top + 24, '输入 6 位房间号', textStyle(TYPE.section, COLOR_TEXT.ink, { fontStyle: 'bold' })).setOrigin(0.5, 0))
    const digits = this.add.text(cx, top + 70, '· · · · · ·', monoStyle(30, COLOR_TEXT.ink)).setOrigin(0.5, 0).setDepth(501)
    layer.add(digits)
    const hint = this.add.text(cx, top + 118, '输入 6 位数字房号（Backspace 删除，Enter 确认）', textStyle(TYPE.caption, '#6b5a3a', { align: 'center', ...wrap(pw - 48) })).setOrigin(0.5, 0).setDepth(501)
    layer.add(hint)

    const close = () => {
      window.removeEventListener('keydown', onKey)
      digits.destroy()
      hint.destroy()
      confirmBtn.destroy()
      cancelBtn.destroy()
      layer.destroy()
    }
    const submit = () => {
      if (!/^\d{6}$/.test(code)) { hint.setText('房间号为 6 位数字'); return }
      emitAck(this, this.socket, 'room:join', { code }, (res) => {
        if (!res.ok) { hint.setText(res.error || '加入失败'); return }
        saveResume(res.socketId || this.socket.id, res.resumeToken)
        this.roomData = res.room
        close()
        this.rebuild()
      })
    }
    const onKey = (e) => {
      if (e.repeat) return
      // 房间号 = 纯 6 位数字
      const isDigit = e.key >= '0' && e.key <= '9'
      if (isDigit && code.length < 6) code += e.key
      else if (e.key === 'Backspace') code = code.slice(0, -1)
      else if (e.key === 'Enter') { submit(); return }
      else if (e.key === 'Escape') { close(); return }
      digits.setText((code.split('').join(' ') + ' · · · · · ·'.slice(code.length * 2)).trim())
      digits.setColor(code.length === 6 ? '#2e8b57' : COLOR_TEXT.ink)
    }
    window.addEventListener('keydown', onKey)

    const confirmBtn = makeButton(this, {
      x: cx - 90, y: top + ph - 56, w: 160, h: 46, label: '确认', color: PALETTE.good, onClick: submit
    })
    const cancelBtn = makeButton(this, {
      x: cx + 90, y: top + ph - 56, w: 160, h: 46, label: '取消', color: PALETTE.neutral, onClick: close
    })
    layer.add(confirmBtn.root)
    layer.add(cancelBtn.root)
    layer.bringToTop(digits)
    layer.bringToTop(hint)
  }

  renderRoom() {
    if (!this.roomData) return
    const cx = this.W / 2
    const cy = this.H / 2 + 10
    const r = this.roomData
    // 新面板素材装饰边约占 9%，安全区到 cy ± 235，内容收在 cy + 190 以内

    this.panelText(cx, cy - 140, `房间号：${r.code}`, TYPE.title, '#7cfc8a', { fontStyle: 'bold' }).setOrigin(0.5)
    this.panelText(cx, cy - 102, '把房间号告诉同伴，一起上船（所有人先选角，房主再出航）', TYPE.caption, '#fff3d6').setOrigin(0.5)

    // 玩家列表：每行 30px，含在线状态。名字取角色名（charName），未选角时用座位号占位
    const seatY = cy - 68
    r.players.forEach((p, i) => {
      const online = !p.disconnected
      const state = p.isAI ? ' 🤖' : (online ? ' 🟢' : ' 🔴离线')
      const who = p.charName || p.name
      const status = p.charId ? '' : ' 选角中...'
      this.panelText(cx, seatY + i * 30,
        `${p.isYou ? '▶' : '　'} ${who}${p.isHost ? '（房主）' : ''}${status}${state}`,
        TYPE.body, online || p.isAI ? '#ffffff' : '#ff9a8a'
      ).setOrigin(0.5)
    })
    if (r.maxPlayers) {
      this.panelText(cx, seatY + r.players.length * 30, `（${r.players.length}/${r.maxPlayers} 人，开局空位自动补 AI）`, TYPE.caption, '#ffe9a8').setOrigin(0.5)
    }

    const isHost = r.players.some((p) => p.isYou && p.isHost)
    // 所有人都要去选角界面：服务器 game:start 会拦截「还没选角色」，
    // 之前只有房主能进选角，导致非房主永远没选角 → 房主永远开不了局
    makeButton(this, {
      x: cx, y: cy + 54, w: this.buttonWidth(), h: 50,
      label: isHost ? '出航 →' : '去选角 →', color: PALETTE.good, fontSize: TYPE.section, wood: true,
      onClick: () => this.scene.start('SelectScene')
    })

    // 聊天区：列表 + 输入入口（与出航/离开同排不重叠）
    const cw = Math.min(360, this.W - 120)
    this.chatLog = createChatLog(this, cx - cw / 2, cy + 92, cw, 62)
    ;(this.chatHistory || []).forEach((m) => this.chatLog.push(m))
    makeButton(this, {
      x: cx - 44, y: cy + 168, w: cw - 92, h: 32, label: '💬 说点什么…', color: PALETTE.wood, fontSize: TYPE.caption,
      onClick: () => openChatInput(this, {
        onSubmit: (text) => sendChat(this, this.socket, 'text', text)
      })
    })
    makeButton(this, {
      x: cx + (cw - 92) / 2 + 46, y: cy + 168, w: 84, h: 32, label: '离开房间', color: PALETTE.neutral, fontSize: TYPE.caption,
      onClick: () => {
        localStorage.removeItem('op_game_old_id')
        this.roomData = null
        emitAck(this, this.socket, 'room:leave', {}, () => {})
        this.rebuild()
      }
    })
  }
}
