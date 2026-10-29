const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 } })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 300)) })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2000)
  const has = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return { sceneActive: sc.scene.isActive(), hasRoll: !!sc.btnRoll, hasIslands: !!sc.btnIslands, hasBanner: !!sc.actionBanner }
  })
  console.log('state:', JSON.stringify(has))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
