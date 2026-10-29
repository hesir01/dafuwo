// 造景截图：①站在已购岛屿上 ②持有 2 块历史正文（验证中央牌位与当前格 mini 两行）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const W = Number(process.env.W || 1080)
const H = Number(process.env.H || 700)
const out = process.env.OUT || '/tmp/board_island.png'
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1800)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2000)
  const info = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const me = s.players[s.current]
    // 找一个岛屿格，让 0 号玩家持有，当前玩家站上去
    const islandCell = sc.constructor.name && s ? null : null
    const BOARD = sc.BOARD || null
    const cellIdx = (sc.state && sc.cellOfIsland) ? null : null
    // 直接操作：给 1 号玩家一座岛，把当前玩家放到该格
    const islId = 3
    s.islandState[islId] = { ownerId: 1, level: 2 }
    s.players[1].islandIds = [islId]
    const idx = sc.cellOfIsland(islId)
    me.position = idx
    me.hand = [
      { uid: 'h1', kind: 'history', historyId: 2 },
      { uid: 'h2', kind: 'fruit', defId: 'quake' }
    ]
    s.phase = 'awaitAction'
    s.lastDice = { d1: 3, d2: 4, total: 7, isDoubles: false }
    sc.refresh()
    await new Promise((r) => setTimeout(r, 300))
    return { cellMode: sc.cellMode, cellText: sc.cellTxt ? sc.cellTxt.text : null, pos: idx }
  })
  // 等掷骰定格动画走完（12 帧 + 650ms settle），否则骰面还处于隐藏态
  await sleep(1700)
  await page.screenshot({ path: out })
  console.log(JSON.stringify(info), '->', out)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
