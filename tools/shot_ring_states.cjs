// 环形倒计时视觉验证：把 deadline 分别置于 30s / 18s / 6s，截图确认弧长递减与配色变化
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 2 })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)

  for (const secs of [30, 18, 6]) {
    await page.evaluate((s) => {
      const sc = window.__game.scene.getScene('BoardScene')
      sc.turnDeadline = sc.time.now + s * 1000
    }, secs)
    await sleep(320)
    const info = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      const a = sc.centerTimerArc
      const ring = sc.centerTimerRing
      return {
        cmds: a.commandBuffer.length,
        avatar: { x: Math.round(sc.centerAvatar.x), y: Math.round(sc.centerAvatar.y), w: Math.round(sc.centerAvatar.displayWidth) },
        r: Math.round(ring.r), w: Math.round(ring.w),
        secsLeft: Math.round((sc.turnDeadline - sc.time.now) / 1000)
      }
    })
    const box = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      const cam = sc.cameras.main
      const x = sc.centerAvatar.x - 90, y = sc.centerAvatar.y - 90
      return { x: Math.round(x - cam.scrollX), y: Math.round(y - cam.scrollY) }
    })
    await page.screenshot({ path: `/tmp/ring_${secs}.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: 180, height: 180 } })
    console.log(secs + 's ->', JSON.stringify(info))
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
