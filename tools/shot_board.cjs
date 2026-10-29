// 棋盘清晰度截图：单机进入棋盘后截整屏 + 左上角格子放大图
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2400)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2600)
  await page.screenshot({ path: '.playwright-cli/board-sharp.png' })
  console.log('ok')
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
