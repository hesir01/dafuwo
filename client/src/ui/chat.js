import {
  PALETTE, COLOR_TEXT, TYPE, textStyle, clamp,
  makePanel, makeButton, showToast
} from './uiKit.js'
import { emitAck } from './uiKit.js'

// ============================================================
// 聊天与快捷互动
// 规格：表情 6 个（3×2 网格，按钮 72×56）；快捷短语 6 条（2×3，176×44）
// 气泡：在玩家卡片上方浮起 1.6s，白底深字，圆角小尾巴，避免与金色飘字混色
// 频控由服务端 700ms 兜底，客户端只做失败提示，不阻塞操作
// ============================================================

export const QUICK_EMOJIS = ['⚓', '💰', '🏴', '😂', '😱', '👏']
export const QUICK_PHRASES = ['快点吧', '好牌！', '这岛我要了', '联手吗？', '抱歉～', '打得不错']

// 名字统一取角色名（见 shared/engine.js createGame）：
// 客户端不再生成/持久化自定义昵称，避免出现「昵称（你）· 角色名」这类双名显示。

// 发送消息：联机走服务器广播；单机只在本地冒气泡
export function sendChat(scene, socket, kind, value, localHandler) {
  if (!socket || !socket.connected) {
    if (localHandler) localHandler({ kind, value, from: -1, name: '我' })
    return
  }
  emitAck(scene, socket, 'chat:send', { kind, value }, (res) => {
    if (!res.ok) showToast(scene, res.error || '发送失败')
  }, 4000)
}

// 气泡：玩家卡片上方浮起并淡出
export function showBubble(scene, x, y, text, { color = '#fff3d6' } = {}) {
  const pad = 10
  const t = scene.add.text(0, 0, text, textStyle(TYPE.body, '#2a1a08', { fontStyle: 'bold' })).setOrigin(0.5)
  const w = Math.max(48, t.width + pad * 2)
  const h = t.height + pad
  const bg = scene.add.rectangle(x, y, w, h, parseInt(color.replace('#', '0x')), 0.96)
    .setStrokeStyle(2, PALETTE.gold).setDepth(620)
  const tail = scene.add.triangle(x, y + h / 2 + 4, 0, 0, 10, 0, 5, 8, parseInt(color.replace('#', '0x')), 0.96).setDepth(620)
  t.setPosition(x, y).setDepth(621)
  scene.tweens.add({ targets: [bg, t, tail], y: `-=${18}`, duration: 320, ease: 'Back.easeOut' })
  scene.tweens.add({
    targets: [bg, t, tail], alpha: 0, delay: 1100, duration: 500,
    onComplete: () => { bg.destroy(); t.destroy(); tail.destroy() }
  })
}

// 快捷互动面板：表情 3×2 + 短语 2×3，联机广播 / 单机本地冒泡
// 布局：ph=360，自上而下 标题26 / 表情两行(52+10) / 短语三行(36+8) / 关闭，互不重叠
export function openQuickChat(scene, { socket, selfId = -1, onLocal } = {}) {
  const W = scene.scale.width
  const H = scene.scale.height
  const layer = scene.add.container(0, 0).setDepth(780)
  const shield = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.5).setInteractive()
  layer.add(shield)

  const pw = clamp(Math.min(420, W - 48), 280, 420)
  const ph = Math.min(360, H - 48)
  const top = H / 2 - ph / 2
  layer.add(makePanel(scene, W / 2, H / 2, pw, ph))
  layer.add(scene.add.text(W / 2, top + 26, '快捷互动', textStyle(TYPE.section, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0.5))

  const fire = (kind, value) => {
    sendChat(scene, socket, kind, value, (msg) => {
      if (onLocal) onLocal({ ...msg, kind, value })
    })
    close()
  }

  // 表情：3 列 × 2 行（emoji 字号加大，别糊成一坨）
  const eh = 52, ew = 72
  const gridTop = top + 48
  QUICK_EMOJIS.forEach((e, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = W / 2 - (ew * 3 + 16 * 2) / 2 + ew / 2 + col * (ew + 16)
    const y = gridTop + eh / 2 + row * (eh + 10)
    const b = makeButton(scene, {
      x, y, w: ew, h: eh, label: e, color: PALETTE.woodDark, fontSize: 26,
      onClick: () => fire('emoji', e)
    })
    layer.add(b.root)
  })

  // 短语：2 列 × 3 行（表情底边 top+162，短语区从 top+172 起）
  const phraseTop = gridTop + 2 * eh + 10 + 10
  const pw2 = (pw - 48 - 12) / 2
  QUICK_PHRASES.forEach((p, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = W / 2 - pw / 2 + 24 + pw2 / 2 + col * (pw2 + 12)
    const y = phraseTop + 18 + row * 44
    const b = makeButton(scene, {
      x, y, w: pw2, h: 36, label: p, color: PALETTE.blue, fontSize: TYPE.bodySmall,
      onClick: () => fire('phrase', p)
    })
    layer.add(b.root)
  })
  // 短语底边 = phraseTop + 18 + 2*44 + 18 = top+268+... ≈ top+290，与关闭钮留 18px 间距

  const closeBtn = makeButton(scene, {
    x: W / 2, y: top + ph - 26, w: 120, h: 40,
    label: '关闭', color: PALETTE.neutral, fontSize: TYPE.bodySmall, onClick: () => close()
  })
  layer.add(closeBtn.root)
  shield.on('pointerdown', () => close())

  function close() { layer.destroy(true) }
  return { layer, close }
}

// 房间聊天面板（大厅）：消息列表 + 输入入口
export function createChatLog(scene, x, y, w, h, { socket, onSend } = {}) {
  const box = scene.add.container(x, y)
  const bg = scene.add.rectangle(0, 0, w, h, PALETTE.woodDark, 0.9).setOrigin(0, 0)
    .setStrokeStyle(2, PALETTE.gold, 0.6)
  const title = scene.add.text(8, 6, '房间聊天', textStyle(TYPE.caption, COLOR_TEXT.gold, { fontStyle: 'bold' })).setOrigin(0, 0)
  const body = scene.add.text(8, 26, '暂无消息', textStyle(TYPE.caption, COLOR_TEXT.muted, { lineSpacing: 4, wordWrap: { width: w - 16, useAdvancedWrap: true } })).setOrigin(0, 0)
  box.add([bg, title, body])

  const api = {
    box,
    messages: [],
    push(msg) {
      api.messages.push(msg)
      if (api.messages.length > 8) api.messages.shift()
      body.setText(api.messages.map((m) => `${m.name}：${m.value}`).join('\n') || '暂无消息')
    },
    clear() { api.messages = []; body.setText('暂无消息') },
    destroy() { box.destroy(true) }
  }
  return api
}

// 文本输入：复用 DOM keydown（Phaser 键盘在部分环境会重复派发）
export function openChatInput(scene, { onSubmit } = {}) {
  const W = scene.scale.width
  const H = scene.scale.height
  const layer = scene.add.container(0, 0).setDepth(780)
  const shield = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.5).setInteractive()
  layer.add(shield)
  const pw = clamp(Math.min(420, W - 48), 280, 420)
  layer.add(makePanel(scene, W / 2, H / 2, pw, 190))
  const val = { text: '' }
  const label = scene.add.text(W / 2, H / 2 - 46, '输入消息（Enter 发送，Esc 取消）', textStyle(TYPE.caption, COLOR_TEXT.muted)).setOrigin(0.5)
  const display = scene.add.text(W / 2, H / 2, '', textStyle(TYPE.body, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0.5)
  layer.add([label, display])

  const onKey = (e) => {
    if (e.repeat && e.code !== 'Backspace') return
    if (e.code === 'Enter') {
      const v = val.text.trim()
      close()
      if (v && onSubmit) onSubmit(v.slice(0, 60))
      return
    }
    if (e.code === 'Escape') { close(); return }
    if (e.code === 'Backspace') { val.text = val.text.slice(0, -1); display.setText(val.text || '…'); return }
    // 中文输入走 input 事件更稳，这里只兜底可见字符
    if (e.key && e.key.length === 1 && val.text.length < 60) {
      val.text += e.key
      display.setText(val.text)
    }
  }

  // 用隐藏 DOM input 承载中文输入
  const input = document.createElement('input')
  input.maxLength = 60
  input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0'
  document.body.appendChild(input)
  input.focus()
  input.addEventListener('input', () => {
    val.text = input.value.slice(0, 60)
    display.setText(val.text || '…')
  })
  window.addEventListener('keydown', onKey)

  const tip = scene.add.text(W / 2, H / 2 + 54, '支持中文输入（已接入系统输入法）', textStyle(TYPE.caption, COLOR_TEXT.muted)).setOrigin(0.5)
  layer.add(tip)

  function close() {
    window.removeEventListener('keydown', onKey)
    if (input.parentNode) input.parentNode.removeChild(input)
    layer.destroy(true)
  }
  shield.on('pointerdown', () => close())
  return { layer, close }
}
