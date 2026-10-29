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

  // 1) 手牌：塞一张恶魔果实 + 一张霸气，验证出牌路径与目标选择弹窗
  const card = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const p = s.players[s.current]
    s.phase = 'awaitAction'
    p.hand = [
      { uid: 't1', kind: 'fruit', defId: 'quake' },
      { uid: 't2', kind: 'haki', defId: 'armament' }
    ]
    p.cardsUsedThisTurn = 0
    sc.refresh()
    await new Promise(r => setTimeout(r, 200))
    const rendered = sc.handLayer ? sc.handLayer.list.length : -1
    sc.handlePlayCard(p.hand[0])
    await new Promise(r => setTimeout(r, 400))
    const afterFruit = { phase: s.phase, hand: p.hand.length, log: s.log.length, modal: !!sc.modal || !!sc.customPanel }
    return { rendered, afterFruit }
  })

  // 2) 事件格：把玩家放到事件格并触发事件
  const event = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const idx = sc.state.players.map(() => 0)
    // 找一个事件格
    let evIdx = -1
    for (let i = 0; i < 40; i++) { const c = sc.cellPos(i); const cell = (window.__BOARD || null) }
    // 直接用引擎：把位置设到第一个 type 为 event 的格（从 BOARD 通过 cellOfIsland 无法取，改用刷新后的图标 key 判断）
    for (let i = 0; i < 40; i++) {
      s.players[s.current].position = i
      sc.refresh()
      const key = sc.cellIcon ? sc.cellIcon.texture.key : ''
      if (key === 'cell_event') { evIdx = i; break }
    }
    return { evIdx }
  })

  // 3) 岛屿升级：给玩家一座岛 + 现金，点开岛屿面板并执行一次升级
  const upgrade = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const p = s.players[s.current]
    p.islandIds.push(1)
    p.cash = 5000
    sc.refresh()
    sc.openIslandPanel()
    await new Promise(r => setTimeout(r, 250))
    const opened = !!sc.customPanel
    let levelBefore = s.islandState && s.islandState[1] ? s.islandState[1].level : null
    sc.doUpgrade(1)
    await new Promise(r => setTimeout(r, 300))
    const levelAfter = s.islandState && s.islandState[1] ? s.islandState[1].level : null
    return { opened, levelBefore, levelAfter, cash: p.cash }
  })

  console.log('card:', JSON.stringify(card))
  console.log('event:', JSON.stringify(event))
  console.log('upgrade:', JSON.stringify(upgrade))
  console.log('errors:', JSON.stringify(errors))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
