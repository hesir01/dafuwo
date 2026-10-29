const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/socket\.io|Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text().slice(0, 160)) })

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2000)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)

  // A) 购买流程：把玩家放到一个无主岛屿格并进入 awaitBuy
  const buyRes = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    let idx = -1, id = null
    for (let i = 1; i <= 30 && idx < 0; i++) { const n = sc.cellOfIsland(i); if (n >= 0) { idx = n; id = i } }
    s.players[s.current].position = idx
    s.phase = 'awaitBuy'
    s.pendingIslandId = id
    sc.refresh()
    await new Promise(r => setTimeout(r, 200))
    const before = s.players[s.current].cash
    const beforeOwn = s.players[s.current].islandIds.length
    sc.handleBuy()
    await new Promise(r => setTimeout(r, 500))
    return {
      cashBefore: before, cashAfter: s.players[s.current].cash,
      ownedBefore: beforeOwn, ownedAfter: s.players[s.current].islandIds.length,
      phase: s.phase, islandId: id, cellIndex: idx
    }
  })

  // B) 手牌出牌（恶魔果实 / 霸气）与不可用提示
  const cardRes = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const p = s.players[s.current]
    p.hand = []
    // 硬塞两张卡，验证出牌链路不报错
    s.phase = 'awaitAction'
    const before = JSON.stringify(s.log.length)
    return { handCount: p.hand.length, logBefore: before, cardsUsedThisTurn: p.cardsUsedThisTurn }
  })

  // C) 托管连跑：autoPlay 打开，观察 20 秒内是否报错 / 是否推进
  const autoRes = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const t0 = s.turn
    sc.autoPlay = true
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && s.phase !== 'ended') {
      await new Promise(r => setTimeout(r, 300))
    }
    sc.autoPlay = false
    return { turnStart: t0, turnEnd: s.turn, phase: s.phase, bankrupt: s.players.filter(p => p.bankrupt).length }
  })

  // D) 结算后再开新局（再来一局按钮路径）
  const restart = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    window.__game.scene.start('BoardScene', { autoPlay: false })
    await new Promise(r => setTimeout(r, 1500))
    const sc2 = window.__game.scene.getScene('BoardScene')
    return { phase: sc2.state.phase, players: sc2.state.players.length, victoryShown: sc2.victoryShown }
  })

  console.log('buy:', JSON.stringify(buyRes))
  console.log('card:', JSON.stringify(cardRes))
  console.log('auto:', JSON.stringify(autoRes))
  console.log('restart:', JSON.stringify(restart))
  console.log('errors:', JSON.stringify(errors, null, 1))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
