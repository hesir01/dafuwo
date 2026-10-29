const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/socket\.io|Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text().slice(0, 140)) })
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2000)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)

  // 1) 对局内设置按钮存在 + 能打开
  const setBtn = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const has = !!sc.btnSettings
    sc.openSettings()
    await new Promise(r => setTimeout(r, 250))
    const opened = !!sc.children.list.find(c => c.type === 'Container' && c.depth === 800)
    // 关闭：点遮罩（shield）
    const layer = sc.children.list.find(c => c.type === 'Container' && c.depth === 800)
    if (layer) layer.list[0].emit('pointerdown')
    await new Promise(r => setTimeout(r, 200))
    return { has, opened, closed: !sc.children.list.find(c => c.type === 'Container' && c.depth === 800) }
  })

  // 2) 托管选中态：按钮变绿 + 徽标显示
  const auto = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const before = { label: sc.btnAuto.txt.text, badge: sc.autoBadge.visible, color: sc.btnAuto.bg.fillColor }
    sc.toggleAuto()
    await new Promise(r => setTimeout(r, 200))
    const after = { label: sc.btnAuto.txt.text, badge: sc.autoBadge.visible, color: sc.btnAuto.bg.fillColor }
    sc.toggleAuto()
    await new Promise(r => setTimeout(r, 200))
    const off = { label: sc.btnAuto.txt.text, badge: sc.autoBadge.visible }
    return { before, after, off }
  })

  // 3) 破产反馈：飘字 + 音效 + 卡片压暗
  const bank = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    sc.refresh() // 建立基线
    await new Promise(r => setTimeout(r, 150))
    const before = sc.playerCards[1].bg.fillAlpha
    s.players[1].bankrupt = true
    sc.refresh()
    await new Promise(r => setTimeout(r, 200))
    const floats = sc.children.list.filter(c => c.type === 'Text' && /破产/.test(c.text || '')).length
    return { before, after: sc.playerCards[1].bg.fillAlpha, floats }
  })

  // 4) 引擎防御：非法果实 id 不再崩溃
  const guard = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const p = s.players[s.current]
    s.phase = 'awaitAction'
    p.cardsUsedThisTurn = 0
    p.hand = [{ uid: 'bad', kind: 'fruit', defId: 'not_exist' }]
    let err = null
    try { sc.handlePlayCard(p.hand[0]); await new Promise(r => setTimeout(r, 200)) } catch (e) { err = String(e) }
    return { err, handAfter: p.hand.length }
  })

  // 5) 快速模式：动画系数
  const speed = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const cur = sc.fxScale()
    localStorage.setItem('op_settings', JSON.stringify({ fastAI: true }))
    const fast = sc.fxScale()
    localStorage.setItem('op_settings', JSON.stringify({ fastAI: false }))
    return { normal: cur, fast }
  })

  console.log('settingsBtn:', JSON.stringify(setBtn))
  console.log('auto:', JSON.stringify(auto))
  console.log('bankrupt:', JSON.stringify(bank))
  console.log('guard:', JSON.stringify(guard))
  console.log('speed:', JSON.stringify(speed))
  console.log('errors:', JSON.stringify(errors))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
