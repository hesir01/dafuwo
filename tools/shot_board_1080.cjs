// UI 调整验证截图：按用户实际窗口尺寸 1080x610 进入棋盘
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const url = process.env.URL || 'http://localhost:5173/index.html'
const out = process.env.OUT || '/tmp/board_current.png'
const W = Number(process.env.W || 1080)
const H = Number(process.env.H || 610)
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await sleep(2200)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2600)
  await page.screenshot({ path: out })
  console.log('ok', out)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
