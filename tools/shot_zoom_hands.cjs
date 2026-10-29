// 局部放大截图：左栏玩家卡（手牌区）/ 中央指挥台
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = process.env.URL || 'http://localhost:5173/index.html'

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 2 })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)
  await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const me = sc.state.players[sc.state.current]
    me.hand = [
      { uid: 'h1', kind: 'history', historyId: 1 },
      { uid: 'h2', kind: 'history', historyId: 2 },
      { uid: 'h3', kind: 'fruit', defId: 'dark' },
      { uid: 'h4', kind: 'haki', defId: 'arm' }
    ]
    sc.state.players[1].hand = [{ uid: 'o1', kind: 'fruit', defId: 'quake' }, { uid: 'o2', kind: 'haki', defId: 'arm' }]
    sc.state.players[2].hand = [{ uid: 'o3', kind: 'history', historyId: 3 }]
    sc.state.players[1].islandIds = [3, 5]
    sc.state.phase = 'awaitAction'
    sc.refresh()
    await wait(200)
  })
  await page.screenshot({ path: '/tmp/zoom_left.png', clip: { x: 8, y: 8, width: 240, height: 560 } })
  await page.screenshot({ path: '/tmp/zoom_center.png', clip: { x: 330, y: 150, width: 420, height: 330 } })
  await browser.close()
  console.log('ok')
})().catch((e) => { console.error(e); process.exit(1) })
