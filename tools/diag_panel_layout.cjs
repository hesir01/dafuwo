// 诊断：读取棋盘右栏布局数值（可用空间 / 当前格档位 / 日志高度）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const W = Number(process.env.W || 1080)
const H = Number(process.env.H || 610)
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1800)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)
  const info = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const p = sc.panel
    return {
      H: sc.H, panel: { y: p.y, h: p.h },
      handTop: sc.handTop, cellMode: sc.cellMode,
      cellPanelY: sc.cellPanel ? sc.cellPanel.y : null,
      cellPanelH: sc.cellPanel ? sc.cellPanel.list[1].height : null,
      logArea: sc.logArea || null,
      handPanelH: sc.handCardH,
      rollBtn: sc.btnRoll ? sc.btnRoll.y : null,
      row3: sc.btnIslands ? sc.btnIslands.y : null
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
