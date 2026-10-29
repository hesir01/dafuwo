const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2000)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)

  const res = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const p = s.players[s.current]
    p.cash = 5000
    // 合法购买：进入 awaitBuy 后走引擎买下
    let idx = -1, id = null
    for (let i = 1; i <= 30 && idx < 0; i++) { const n = sc.cellOfIsland(i); if (n >= 0) { idx = n; id = i } }
    p.position = idx
    s.phase = 'awaitBuy'
    s.pendingIslandId = id
    sc.refresh()
    sc.handleBuy()
    await new Promise(r => setTimeout(r, 300))
    const st1 = s.islandState[id] ? { ...s.islandState[id] } : null
    const cash1 = p.cash
    // 再升级
    sc.doUpgrade(id)
    await new Promise(r => setTimeout(r, 300))
    const st2 = s.islandState[id] ? { ...s.islandState[id] } : null
    return { islandId: id, ownerAfterBuy: st1 && st1.owner, levelBefore: st1 && st1.level, levelAfter: st2 && st2.level, cashAfterBuy: cash1, cashAfterUpgrade: p.cash }
  })
  console.log(JSON.stringify(res))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
