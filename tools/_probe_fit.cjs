const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: parseInt(process.argv[2]), height: parseInt(process.argv[3]) } })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2000)
  const r = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const rect = sc.centerRect
    const over = (b) => Math.round(b.root.y + b.h / 2 - (rect.y + rect.h))
    return {
      console: { y: Math.round(rect.y), h: Math.round(rect.h), bottom: Math.round(rect.y + rect.h) },
      islands: { top: Math.round(sc.btnIslands.root.y - sc.btnIslands.h / 2), bottom: Math.round(sc.btnIslands.root.y + sc.btnIslands.h / 2), over: over(sc.btnIslands) },
      voyageOver: over(sc.btnVoyage),
      idH: Math.round(sc.centerAvatar ? sc.centerAvatar.displayHeight : -1)
    }
  })
  console.log(JSON.stringify(r))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
