import {
  PALETTE, COLOR_TEXT, TYPE, textStyle, clamp,
  makePanel, makeButton
} from './uiKit.js'
import { currentBuild, renderScale } from './versionGuard.js'

// ============================================================
// 设置：音效 / 音乐 / 玩法默认值
// 持久化到 localStorage，所有场景共用同一份；音效统一从这里出口，
// 保证「静音 = 真的不播」，不会出现点了没反应。
// ============================================================

const KEY = 'op_settings'

export const DEFAULT_SETTINGS = {
  sfx: true,
  sfxVolume: 70,
  bgm: true,
  bgmVolume: 30,
  autoPlay: false, // 单机开局是否默认托管（AI 自动行动）
  fastAI: false    // AI / 托管行动速度：标准 550ms，快速 260ms
}

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }
  } catch (e) {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (e) { /* 隐私模式下忽略 */ }
  return s
}

export function updateSettings(patch) {
  return saveSettings({ ...loadSettings(), ...patch })
}

// 音效音量（0–1）；静音时返回 0
export function sfxVolume() {
  const s = loadSettings()
  return s.sfx ? s.sfxVolume / 100 : 0
}

// 统一音效出口：静音或音量为 0 直接跳过
export function playSfx(scene, name, baseVol = 0.7) {
  const v = sfxVolume() * baseVol
  if (v <= 0) return
  if (scene.cache && scene.cache.audio.exists(name)) scene.sound.play(name, { volume: v })
}

// 背景音乐：独立通道，只控制自己这一条音轨
export function syncBgm(scene) {
  const s = loadSettings()
  const bgm = scene.sound.get('bgm_game')
  if (bgm) bgm.setVolume(s.bgm ? s.bgmVolume / 100 : 0)
}

export function ensureBgm(scene) {
  if (!scene.cache.audio.exists('bgm_game')) return
  if (!scene.sound.get('bgm_game')) scene.sound.add('bgm_game', { loop: true, volume: 0 }).play()
  syncBgm(scene)
}

// 面板规格：宽 min(520, 屏宽-48)、行高 44、行距 12、内边距 24
// 控件点击区：开关 96×36；步进按钮 44×36（视觉边界 = 点击边界）
const ROWS = [
  { key: 'sfx', label: '音效', type: 'toggle', on: '开', off: '关' },
  { key: 'sfxVolume', label: '音效音量', type: 'step', step: 10, dependsOn: 'sfx' },
  { key: 'bgm', label: '背景音乐', type: 'toggle', on: '开', off: '关' },
  { key: 'bgmVolume', label: '音乐音量', type: 'step', step: 10, dependsOn: 'bgm' },
  { key: 'autoPlay', label: '单机默认托管', type: 'toggle', on: '开', off: '关' },
  { key: 'fastAI', label: 'AI 行动速度', type: 'toggle', on: '快速', off: '标准' }
]

export function openSettingsPanel(scene, { onClose } = {}) {
  const W = scene.scale.width
  const H = scene.scale.height
  const st = { ...loadSettings() }

  const layer = scene.add.container(0, 0).setDepth(800)
  const shield = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6).setInteractive()
  layer.add(shield)

  const pw = clamp(Math.min(520, W - 48), 300, 520)
  const rowH = 44
  const rowGap = 12
  const headH = 60
  const footH = 92
  const ph = headH + ROWS.length * rowH + (ROWS.length - 1) * rowGap + footH
  const px = W / 2
  const py = H / 2
  layer.add(makePanel(scene, px, py, pw, ph))

  layer.add(scene.add.text(px, py - ph / 2 + 24, '设 置', textStyle(TYPE.title, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0.5))
  layer.add(scene.add.rectangle(px - 36, py - ph / 2 + 44, 72, 1, PALETTE.gold, 0.6))

  const right = px + pw / 2 - 24
  const left = px - pw / 2 + 24
  const top = py - ph / 2 + headH

  const controls = []
  ROWS.forEach((row, i) => {
    const y = top + rowH / 2 + i * (rowH + rowGap)
    layer.add(scene.add.text(left, y, row.label, textStyle(TYPE.body, COLOR_TEXT.body)).setOrigin(0, 0.5))

    if (row.type === 'toggle') {
      const btn = makeButton(scene, {
        x: right - 48, y, w: 96, h: 36,
        label: '', color: PALETTE.good, fontSize: TYPE.bodySmall,
        onClick: () => {
          st[row.key] = !st[row.key]
          apply(row.key)
          refreshControls()
          playSfx(scene, 'sfx_button_click', 0.6)
        }
      })
      layer.add(btn.root)
      controls.push({ row, btn })
    } else {
      // 步进器：[−] 数值 [+]，值区 64px 宽
      const minus = makeButton(scene, {
        x: right - 146, y, w: 44, h: 36, label: '−', color: PALETTE.neutral, fontSize: TYPE.section,
        onClick: () => step(row, -row.step)
      })
      const plus = makeButton(scene, {
        x: right - 22, y, w: 44, h: 36, label: '+', color: PALETTE.neutral, fontSize: TYPE.section,
        onClick: () => step(row, row.step)
      })
      const valTxt = scene.add.text(right - 84, y, '', textStyle(TYPE.body, COLOR_TEXT.title, { fontStyle: 'bold' })).setOrigin(0.5)
      layer.add([minus.root, plus.root, valTxt])
      controls.push({ row, minus, plus, valTxt })
    }
  })

  function step(row, d) {
    st[row.key] = clamp(st[row.key] + d, 0, 100)
    apply(row.key)
    refreshControls()
  }

  function apply(key) {
    if (key === 'bgm' || key === 'bgmVolume') syncBgm(scene)
    if (key === 'sfxVolume' && st.sfx) playSfx(scene, 'sfx_button_click', 0.6)
  }

  function refreshControls() {
    controls.forEach((c) => {
      const { row } = c
      const disabled = row.dependsOn ? !st[row.dependsOn] : false
      if (row.type === 'toggle') {
        const on = !!st[row.key]
        c.btn.setLabel(on ? (row.on || '开') : (row.off || '关'))
        c.btn.setColor(on ? PALETTE.good : PALETTE.neutral)
      } else {
        c.valTxt.setText(`${st[row.key]}%`)
        c.minus.setEnabled(!disabled && st[row.key] > 0)
        c.plus.setEnabled(!disabled && st[row.key] < 100)
        c.valTxt.setAlpha(disabled ? 0.45 : 1)
      }
    })
  }
  refreshControls()

  const footY = py + ph / 2 - 46
  const reset = makeButton(scene, {
    x: px - 100, y: footY, w: 176, h: 44, label: '恢复默认', color: PALETTE.neutral, fontSize: TYPE.bodySmall,
    onClick: () => {
      Object.assign(st, DEFAULT_SETTINGS)
      apply('bgm'); apply('bgmVolume')
      refreshControls()
    }
  })
  const done = makeButton(scene, {
    x: px + 100, y: footY, w: 176, h: 44, label: '完 成', color: PALETTE.good, fontSize: TYPE.body,
    onClick: () => close()
  })
  layer.add([reset.root, done.root])

  // 版本 / 渲染倍率：联机出问题时，两边对一下这行就能确定是不是同一个前端
  const buildTag = currentBuild() || 'dev'
  layer.add(scene.add.text(px, py + ph / 2 - 14,
    `版本 ${buildTag} · 渲染 ${renderScale()}x · DPR ${Math.min(window.devicePixelRatio || 1, 2)}`,
    textStyle(10, COLOR_TEXT.muted, { align: 'center' })).setOrigin(0.5))

  function close() {
    saveSettings(st)
    layer.destroy(true)
    if (onClose) onClose(st)
  }

  shield.on('pointerdown', () => close())

  return { layer, close, getSettings: () => ({ ...st }) }
}
