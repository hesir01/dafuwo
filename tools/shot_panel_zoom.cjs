// 局部放大截图：用于检查右栏底部手牌区 / 当前格卡片细节
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const W = Number(process.env.W || 1080)
const H = Number(process.env.H || 700)
const out = process.env.OUT || '/tmp/crop_hand.png'
const CX = Number(process.env.CX || 0.72)
const CW = Number(process.env.CW || 0.28)
const CY = Number(process.env.CY || 0.55)
const CH = Number(process.env.CH || 0.45)
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 3 })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)
  await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const me = s.players[s.current]
    s.islandState[3] = { ownerId: 1, level: 2 }
    s.players[1].islandIds = [3]
    me.position = sc.cellOfIsland(3)
    me.hand = [
      { uid: 'h1', kind: 'history', historyId: 2 },
      { uid: 'h2', kind: 'fruit', defId: 'quake' },
      { uid: 'h3', kind: 'haki', defId: 'armament' }
    ]
    s.phase = 'awaitAction'
    sc.refresh()
    await new Promise((r) => setTimeout(r, 250))
  })
  await sleep(400)
  await page.screenshot({ path: out, clip: { x: W * CX, y: H * CY, width: W * CW, height: H * CH } })
  console.log('ok', out)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
