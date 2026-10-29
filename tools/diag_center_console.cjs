// 中央指挥台布局诊断：输出画框/羊皮纸/控件的实际几何，检查是否越界与垂直重心
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SIZES = [[1080, 610], [1280, 720], [1440, 820], [900, 540]]

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  for (const [W, H] of SIZES) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
    await sleep(1400)
    await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
    await sleep(1600)
    const m = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      const r = sc.centerRect
      const btnKeys = ['btnRoll', 'btnEnd', 'btnBuy', 'btnDecline', 'btnSkill', 'btnVoyage']
      const bounds = btnKeys.map((k) => {
        const b = sc[k]
        if (!b) return { k, missing: true }
        return {
          k,
          x1: Math.round(b.root.x - b.w / 2), x2: Math.round(b.root.x + b.w / 2),
          y1: Math.round(b.root.y - b.h / 2), y2: Math.round(b.root.y + b.h / 2),
          w: Math.round(b.w), h: Math.round(b.h)
        }
      })
      const worst = bounds.reduce((a, b) => ({
        right: Math.max(a.right, b.x2), bottom: Math.max(a.bottom, b.y2), left: Math.min(a.left, b.x1), top: Math.min(a.top, b.y1)
      }), { right: -1e9, bottom: -1e9, left: 1e9, top: 1e9 })
      const txt = sc.actionBannerTxt
      return {
        W: sc.W, H: sc.H, cell: sc.cell, console: sc.centerConsole,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
        avatarD: Math.round(sc.centerAvatar.displayWidth),
        banner: { h: Math.round(sc.actionBannerBg.height), lines: Math.round(txt.height / (txt.style.fontSize * 1.2)), txtH: Math.round(txt.height) },
        btns: bounds.map((b) => `${b.k}:${b.w}x${b.h}`).join(' '),
        bounds: worst,
        overflow: {
          right: Math.round(worst.right - (r.x + r.w)), bottom: Math.round(worst.bottom - (r.y + r.h)),
          left: Math.round(r.x - worst.left), top: Math.round(r.y - worst.top)
        },
        panel: { cash: !!sc.cashTxt, player: !!sc.playerTxt, roll: !!sc.rollTxt }
      }
    })
    console.log(`\n=== ${W}x${H} ===`, JSON.stringify(m))
    await page.close()
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
