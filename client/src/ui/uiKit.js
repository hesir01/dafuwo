import Phaser from 'phaser'

// ============================================================
// 统一 UI 组件与视觉令牌
// 目标：菜单 / 大厅 / 选角 / 棋盘 / 弹窗 / 结算使用同一套
//      木质 + 羊皮纸体系、同一套字号与按钮尺寸。
// ============================================================

export const PALETTE = {
  ink: 0x1a0e06,
  wood: 0x5a3a1a,
  woodDark: 0x2a1a0c,
  woodDeep: 0x1f1208,
  gold: 0xd4a857,
  goldBright: 0xffd966,
  parchment: 0xecd9b0,
  parchmentInk: 0x4a3216,
  good: 0x3f7a4b,
  neutral: 0x7a6a55,
  purple: 0x7a4b9b,
  danger: 0xb0452f,
  blue: 0x2e6da4,
  sea: 0x051830,
  locked: 0x3a3a3a
}

export const COLOR_TEXT = {
  title: '#ffd966',
  body: '#f0e6d2',
  muted: '#c4b494',
  gold: '#c9a84c',
  ink: '#2a1a08',
  good: '#7cfc8a',
  warn: '#ff9d5c',
  danger: '#ff8f7a'
}

export const FONT_FAMILY = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'
export const MONO_FAMILY = '"SF Mono",Menlo,Consolas,monospace'

// 字号阶梯（2026-10-28 整体上调一档：联机/投影场景下小字看不清）
// 桌面正文 18，辅助 16–17，标题 30–38，现金 / 倒计时 28
export const TYPE = {
  display: 38,
  title: 30,
  section: 22,
  body: 18,
  bodySmall: 17,
  caption: 16,
  number: 28
}

export function textStyle(size, color = COLOR_TEXT.body, extra = {}) {
  return { fontFamily: FONT_FAMILY, fontSize: Math.round(size) + 'px', color, ...extra }
}

export function monoStyle(size, color = COLOR_TEXT.title, extra = {}) {
  return { fontFamily: MONO_FAMILY, fontSize: Math.round(size) + 'px', color, ...extra }
}

export function wrap(width) {
  return { wordWrap: { width: Math.round(width), useAdvancedWrap: true } }
}

// 背景统一使用 cover：保持比例铺满，不变形
export function fitCover(image, w, h) {
  const s = Math.max(w / image.width, h / image.height)
  image.setOrigin(0.5).setScale(s).setPosition(w / 2, h / 2)
  return image
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

// 圆角面板底：Graphics 直绘圆角矩形，替代「rectangle + setStrokeStyle」的直角观感。
// 返回 Graphics 并挂 setStyle({fill,fillAlpha,stroke,strokeAlpha,strokeW,r})，
// 动态改色的调用点（玩家卡三态、行动横幅、选角卡）从 setFillStyle/setStrokeStyle 平移过来。
// 显式赋 width/height：布局与回归脚本会读取 bg.width（Graphics 默认宽高不可用）。
export function makeRounded(scene, w, h, { fill = 0xffffff, fillAlpha = 1, stroke = null, strokeAlpha = 1, strokeW = 2, r = 14 } = {}) {
  const g = scene.add.graphics()
  const st = { fill, fillAlpha, stroke, strokeAlpha, strokeW, r }
  const draw = () => {
    g.clear()
    g.fillStyle(st.fill, st.fillAlpha)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, st.r)
    if (st.stroke != null) {
      g.lineStyle(st.strokeW, st.stroke, st.strokeAlpha)
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, st.r)
    }
  }
  draw()
  g.setStyle = (o = {}) => { Object.assign(st, o); draw(); return g }
  g.width = w
  g.height = h
  return g
}

// 居中面板：圆角木质外框 + 深色内底（保证文字对比）
export function makePanel(scene, cx, cy, w, h, opts = {}) {
  const c = scene.add.container(cx, cy)
  const outer = makeRounded(scene, w + 8, h + 8, { fill: opts.frame ?? PALETTE.wood, r: 16 })
  const inner = makeRounded(scene, w, h, { fill: opts.fill ?? PALETTE.woodDeep, fillAlpha: opts.fillAlpha ?? 0.9, r: 12 })
  const top = scene.add.rectangle(0, -h / 2 + 6, w - 44, 2, opts.gold ?? PALETTE.gold, 0.4)
  c.add([outer, inner, top])
  return c
}

// Phaser 对 Container 的命中坐标会额外加上 displayOrigin，直接用居中矩形会让
// 点击区整体左移半个按钮（表现为“点不准”）。setInteractive 后把原点校正到 (0,0)，
// 命中区即与视觉边界严格重合。
function enableHit(root, w, h, cursor = true) {
  root.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: cursor
  })
  if (root.input && root.input.hitArea) {
    root.input.hitArea.x = 0
    root.input.hitArea.y = 0
  }
  return root
}

// 素材面板：ui_panel_v3（Meowa 出图，与项目素材同一套画风，透明底不规则边）
// → 回退 v2 → 老 ui_panel → 最后纯色面板。
export function makeWoodPanel(scene, cx, cy, w, h, opts = {}) {
  const c = scene.add.container(cx, cy)
  if (scene.textures.exists('ui_panel_v3')) {
    const img = scene.add.image(0, 0, 'ui_panel_v3')
      .setDisplaySize(w * 1.02, h * 1.04)
      .setAlpha(opts.alpha ?? 1)
    c.add(img)
  } else if (scene.textures.exists('ui_panel_v2')) {
    const img = scene.add.image(0, 0, 'ui_panel_v2')
      .setDisplaySize(w * 1.06, h * 1.08)
      .setAlpha(opts.alpha ?? 1)
    c.add(img)
  } else if (scene.textures.exists('ui_panel')) {
    const img = scene.add.image(0, 0, 'ui_panel')
      .setDisplaySize(w * 1.12, h * 1.18)
      .setAlpha(opts.alpha ?? 1)
    c.add(img)
  } else {
    c.add(makePanel(scene, 0, 0, w, h, opts))
  }
  return c
}

// 通用按钮：视觉边界 = 点击区域，支持启用 / 禁用 / 悬停 / 按下
// wood: true 时优先用 ui_btn_gold（Meowa 出图的金边铆钉木牌，角块不拉伸），
// 回退 ui_btn_wood；无素材时自动回退纯色样式。语义由文字表达。
export function makeButton(scene, {
  x = 0, y = 0, w = 120, h = 44, label = '', color = PALETTE.good,
  fontSize = 15, align = 'center', right = '', onClick = null, depth = 0,
  wood = false
} = {}) {
  const useWood = wood && (scene.textures.exists('ui_btn_gold') || scene.textures.exists('ui_btn_wood'))
  const woodKey = scene.textures.exists('ui_btn_gold') ? 'ui_btn_gold' : 'ui_btn_wood'
  const root = scene.add.container(x, y).setDepth(depth)
  let bg, hi, stroke = null
  if (useWood) {
    // ui_btn_gold(297×96)：左右金角 22px、上下金边 10px，中央木纹自由拉伸；
    // 老素材 ui_btn_wood(738×297)：左右金属包角 52px、顶边 26px、底部阴影 12px
    const m = woodKey === 'ui_btn_gold' ? [22, 22, 10, 10] : [52, 52, 26, 12]
    bg = scene.add.nineslice(0, 0, woodKey, undefined, w, h, m[0], m[1], m[2], m[3])
    hi = null
  } else {
    // 圆角双层：深色描边层 + 主色内层（Graphics 圆角，观感不再方方正正）
    stroke = makeRounded(scene, w + 4, h + 4, { fill: PALETTE.ink, r: 13 })
    bg = makeRounded(scene, w, h, { fill: color, r: 11 })
    hi = scene.add.rectangle(0, -h / 2 + 5, w - 28, 2, 0xffffff, 0.22)
  }
  const txtStyle = textStyle(fontSize, '#ffffff', { fontStyle: 'bold' })
  if (useWood) { txtStyle.stroke = '#2a1a08'; txtStyle.strokeThickness = 3 }
  const txt = scene.add.text(0, 0, label, txtStyle)
    .setOrigin(align === 'left' ? 0 : (align === 'right' ? 1 : 0.5), 0.5)
  txt.setPosition(align === 'left' ? -w / 2 + 12 : (align === 'right' ? w / 2 - 12 : 0), 0)
  const children = [bg, txt]
  if (hi) children.splice(1, 0, hi)
  if (stroke) children.unshift(stroke)

  let rightTxt = null
  if (right) {
    rightTxt = scene.add.text(w / 2 - 12, 0, right, textStyle(fontSize - 1, '#ffe9a8', { fontStyle: 'bold' })).setOrigin(1, 0.5)
    children.push(rightTxt)
  }
  root.add(children)
  root.setSize(w, h)

  // 命中区与视觉边界严格一致，并显示手型光标，让用户能确认是否对准
  // 注意：必须立即调用一次，否则按钮创建后默认不可点击
  const hit = () => enableHit(root, w, h)
  hit()

  const api = {
    root, bg, txt, w, h,
    color, // 当前主色：hover 恢复用（圆角按钮的描边是独立层，不再随状态变）
    enabled: true,
    setLabel(t) { txt.setText(t); return api },
    setRight(t) { if (rightTxt) rightTxt.setText(t); return api },
    setColor(c) {
      api.color = c
      if (useWood) bg.setTint(c); else bg.setStyle({ fill: c })
      return api
    },
    setEnabled(v) {
      api.enabled = v
      root.setAlpha(v ? 1 : 0.45)
      if (v) hit()
      else root.disableInteractive()
      return api
    },
    setVisible(v) {
      root.setVisible(v)
      if (v && api.enabled) hit()
      else root.disableInteractive()
      return api
    },
    destroy() { root.destroy() }
  }

  // 悬停只做描边高亮，不再缩放：目标不“跑动”，更好点
  root.on('pointerover', () => {
    if (!api.enabled) return
    if (useWood) bg.setTint(0xffe9b0)
    else bg.setStyle({ fill: 0xffe9b0 })
  })
  root.on('pointerout', () => {
    if (useWood) bg.clearTint()
    else bg.setStyle({ fill: api.color })
    root.setScale(1)
  })
  // 动作在按下瞬间触发：按下时的回弹缩放和轻微手抖都不会再吃掉点击
  root.on('pointerdown', () => {
    if (!api.enabled) return
    root.setScale(0.97)
    if (onClick) onClick()
  })
  root.on('pointerup', () => root.setScale(1))
  root.on('pointerupoutside', () => root.setScale(1))
  return api
}

// 轻量提示：错误、超时、规则说明都走这里，不再用原生 alert
export function showToast(scene, msg, { duration = 2200 } = {}) {
  const x = scene.scale.width / 2
  const y = Math.min(120, scene.scale.height * 0.16)
  const txt = scene.add.text(x, y, msg, textStyle(15, '#fff3d6', { align: 'center', ...wrap(scene.scale.width - 120) }))
    .setOrigin(0.5).setDepth(901)
  const w = Math.min(scene.scale.width - 48, txt.width + 28)
  const h = txt.height + 18
  const bg = scene.add.rectangle(x, y, w, h, PALETTE.woodDark, 0.95)
    .setStrokeStyle(2, PALETTE.gold).setDepth(900)
  scene.tweens.add({
    targets: [bg, txt], alpha: 0, y: y - 16,
    delay: duration * 0.6, duration: 320,
    onComplete: () => { bg.destroy(); txt.destroy() }
  })
}

// 带超时保护的请求：服务器未连接 / 无响应时给出反馈，绝不静默
export function emitAck(scene, socket, event, payload, onRes, timeout = 5000) {
  if (!socket || !socket.connected) {
    showToast(scene, '正在连接服务器，请稍候…')
    return
  }
  let done = false
  const timer = scene.time.delayedCall(timeout, () => {
    if (done) return
    done = true
    showToast(scene, '服务器无响应，请检查网络后重试')
  })
  socket.emit(event, payload, (res) => {
    if (done) return
    done = true
    timer.remove(false)
    onRes(res || { ok: false, error: '服务器返回为空' })
  })
}

// 连接状态徽标：联机类界面统一显示，避免“点了没反应但不知道为什么”
export function makeConnBadge(scene, socket, x, y) {
  const txt = scene.add.text(x, y, '', textStyle(TYPE.caption, COLOR_TEXT.muted)).setOrigin(1, 0)
  const update = () => {
    const on = !!socket.connected
    txt.setText(on ? '● 服务器已连接' : '○ 连接服务器中…')
    txt.setColor(on ? COLOR_TEXT.good : COLOR_TEXT.warn)
  }
  // 复用同一 handler：场景重排会重复调用，避免监听器累积
  if (scene.__connUpdate) {
    socket.off('connect', scene.__connUpdate)
    socket.off('disconnect', scene.__connUpdate)
  }
  scene.__connUpdate = update
  update()
  socket.on('connect', update)
  socket.on('disconnect', update)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    socket.off('connect', update)
    socket.off('disconnect', update)
    scene.__connUpdate = null
  })
  return txt
}

// 响应式弹窗：宽度 min(480, 屏宽-48)；按钮窄屏自动 2 列；正文有效换行
// sections：多段落（每段可独立字号/颜色/加粗/段距），替代单块 body，用于档案这类「标签 + 值」结构；
//           align='left' 时整体左对齐（居中排版的长文案换行后会参差不齐，读起来很累）
export function buildModal(scene, {
  title = '', body = '', sections = null, align = 'center', bodySize = 15,
  rows = [], buttons = [], width = 480, icon = null
} = {}) {
  const W = scene.scale.width
  const H = scene.scale.height
  const mw = Math.min(width, W - 48)
  const pad = 20
  const contentW = mw - pad * 2
  const originX = align === 'left' ? 0 : 0.5
  const leftX = align === 'left' ? -contentW / 2 : 0

  const titleTxt = title
    ? scene.add.text(0, 0, title, textStyle(20, COLOR_TEXT.ink, { fontStyle: 'bold', align: 'center', ...wrap(contentW) })).setOrigin(0.5, 0)
    : null
  // 段落块：sections 优先，其次兼容单块 body
  const blocks = []
  if (sections && sections.length) {
    for (const sec of sections) {
      if (!sec || !sec.text) continue
      const t = scene.add.text(0, 0, sec.text, textStyle(sec.size ?? bodySize, sec.color ?? '#4a3216', {
        fontStyle: sec.bold ? 'bold' : 'normal',
        align, lineSpacing: sec.lineSpacing ?? 4, ...wrap(contentW)
      })).setOrigin(originX, 0)
      blocks.push({ t, gap: sec.gap ?? 10 })
    }
  } else if (body) {
    const t = scene.add.text(0, 0, body, textStyle(bodySize, '#4a3216', {
      align, lineSpacing: 4, ...wrap(contentW)
    })).setOrigin(originX, 0)
    blocks.push({ t, gap: 12 })
  }

  const rowBtns = rows.map((r) => makeButton(scene, {
    x: 0, y: 0, w: contentW, h: 46, label: r.label, right: r.right || '',
    align: 'left', color: r.color ?? PALETTE.good, fontSize: 14,
    onClick: r.onClick
  }))
  rowBtns.forEach((b, i) => { if (rows[i].enabled === false) b.setEnabled(false) })

  const n = buttons.length
  const cols = n <= 1 ? 1 : n === 2 ? 2 : (mw >= 430 ? Math.min(n, 4) : 2)
  const bw = (contentW - (cols - 1) * 10) / cols
  const actBtns = buttons.map((b) => makeButton(scene, {
    x: 0, y: 0, w: bw, h: 44, label: b.label, color: b.color ?? PALETTE.good, fontSize: 15,
    onClick: b.onClick
  }))
  // 条件不满足的按钮置灰（如现金不足时的「接受」），但仍占位保持排版稳定
  actBtns.forEach((b, i) => { if (buttons[i].enabled === false) b.setEnabled(false) })

  let contentH = pad
  if (icon && scene.textures.exists(icon)) contentH += 56
  if (titleTxt) contentH += titleTxt.height + 12
  for (const b of blocks) contentH += b.t.height + b.gap
  contentH += rowBtns.length * 54
  if (n) contentH += Math.ceil(n / cols) * 54
  contentH += pad
  const ph = clamp(contentH, 170, Math.max(200, H - 48))

  const cx = W / 2
  const cy = H / 2
  const root = scene.add.container(cx, cy).setDepth(500)
  const shade = scene.add.rectangle(0, 0, W, H, 0x000000, 0.6).setInteractive()
  root.add(shade)
  root.add(makePanel(scene, 0, 0, mw, ph, {
    fill: PALETTE.parchment, fillAlpha: 1, frame: 0x6b4a2a, gold: 0x8a6238
  }))

  let y = -ph / 2 + pad
  if (icon && scene.textures.exists(icon)) {
    root.add(scene.add.image(0, y + 24, icon).setDisplaySize(48, 48))
    y += 56
  }
  if (titleTxt) { root.add(titleTxt); titleTxt.setPosition(0, y); y += titleTxt.height + 12 }
  for (const b of blocks) { root.add(b.t); b.t.setPosition(leftX, y); y += b.t.height + b.gap }
  rowBtns.forEach((b) => { root.add(b.root); b.root.setPosition(0, y + 23); y += 54 })
  actBtns.forEach((b, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = -contentW / 2 + bw / 2 + col * (bw + 10)
    root.add(b.root)
    b.root.setPosition(x, y + 22 + row * 54)
  })

  return {
    root,
    close() { root.destroy() }
  }
}

// 场景级 resize 监听：缩放后重排，而不是只改 canvas 尺寸
export function onSceneResize(scene, handler) {
  const wrapped = (gameSize) => handler(gameSize.width, gameSize.height)
  scene.scale.on('resize', wrapped, scene)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off('resize', wrapped, scene)
  })
}
