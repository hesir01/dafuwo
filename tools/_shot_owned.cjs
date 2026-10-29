const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const p = await b.newPage({ viewport: { width: 1080, height: 610 }, deviceScaleFactor: 2 })
  await p.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1600)
  await p.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)
  await p.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    s.islandState[17] = { ownerId: 0, level: 2 }
    s.players[0].islandIds = [17, 18, 19]
    sc.showIslandCard(sc.boardCX, sc.boardCY, sc.cell, 17)
  })
  await sleep(500)
  await p.screenshot({ path: '/tmp/panel_owned.png' })
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
