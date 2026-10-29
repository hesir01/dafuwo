const { chromium } = require('playwright-core')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 160)) })

  const report = {}

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2200)

  // 1) 标题页
  report.boot = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BootScene')
    return { texts: sc.children.list.filter(c => c.type === 'Text').map(t => t.text).slice(0, 5) }
  })

  // 2) 进入单机对局
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2500)
  report.boardInit = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return {
      phase: sc.state.phase,
      players: sc.state.players.length,
      cell: sc.cell,
      hasSide: !!sc.playerCards,
      hasPanel: !!sc.btnRoll,
      logLines: sc.logLines || 0
    }
  })

  // 3) 掷骰 → 移动
  await page.evaluate(() => window.__game.scene.getScene('BoardScene').handleRoll())
  await sleep(2600)
  report.afterRoll = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    return {
      phase: s.phase,
      lastDice: s.lastDice,
      pos: s.players[s.current] ? s.players[s.current].position : null,
      logCount: s.log.length,
      diceFrame: sc.centerDie1 ? sc.centerDie1.frame.name : null,
      rollTxt: sc.rollTxt.text
    }
  })

  // 4) 若落到可购买岛屿 → 购买
  report.buy = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    if (s.phase !== 'awaitBuy') return { skipped: true, phase: s.phase }
    const before = s.players[s.current].cash
    sc.handleBuy()
    await new Promise((r) => setTimeout(r, 400))
    return {
      owned: s.players[s.current].islandIds.length,
      cashBefore: before,
      cashAfter: s.players[s.current].cash,
      phase: s.phase
    }
  })

  // 5) 结束回合 → 下一位
  report.endTurn = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    if (s.phase !== 'awaitAction') return { skipped: true, phase: s.phase }
    const who = s.current
    sc.handleEnd()
    await new Promise((r) => setTimeout(r, 300))
    return { from: who, to: s.current, phase: s.phase }
  })

  // 6) 面板：岛屿 / 交易 / 规则 / 托管
  report.panels = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const out = {}
    sc.openIslandPanel(); await new Promise(r => setTimeout(r, 200)); out.island = !!sc.customPanel
    if (sc.customPanel) sc.closeCustomPanel()
    sc.openTradePanel(); await new Promise(r => setTimeout(r, 200)); out.trade = !!sc.customPanel
    if (sc.customPanel) sc.closeCustomPanel()
    sc.openRules(); await new Promise(r => setTimeout(r, 200)); out.rules = !!sc.modal
    if (sc.modal) sc.closeModal()
    const before = sc.autoPlay
    sc.toggleAuto(); const after = sc.autoPlay; sc.toggleAuto()
    out.autoToggle = before !== after
    return out
  })

  // 7) 手指键盘（空格掷骰）
  report.keyboard = await page.evaluate(() => {
    return { hasKeyHandler: typeof window.__game.scene.getScene('BoardScene').setupKeyboard === 'function' }
  })

  // 8) 结算弹窗
  report.victory = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.state.phase = 'ended'
    sc.state.winner = sc.state.players[0]
    sc.refresh()
    await new Promise(r => setTimeout(r, 300))
    return { shown: sc.victoryShown, online: sc.online, hasLayer: !!sc.children.list.find(c => c.type === 'Container' && c.depth >= 400) }
  })

  // 9) 窗口缩放重排
  await page.setViewportSize({ width: 1000, height: 700 })
  await sleep(1200)
  report.resize = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return { W: sc.W, H: sc.H, cell: sc.cell, boardTop: sc.boardTop, hasPanel: !!sc.btnRoll }
  })

  // 10) 设置面板（对局中能否打开）
  report.settings = await page.evaluate(async () => {
    const g = window.__game
    const sc = g.scene.getScene('BoardScene')
    const api = g.registry.get('openSettings')(sc)
    await new Promise(r => setTimeout(r, 200))
    const ok = !!api.layer
    api.close()
    return { canOpenInGame: ok }
  })

  report.errors = errors
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
