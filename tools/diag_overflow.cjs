// 诊断：棋盘格子名字越界 + 中央头像越界
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const W = Number(process.env.W || 1080), H = Number(process.env.H || 610)
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(2200)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2600)
  const info = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const out = { cell: sc.cell, av: {}, labels: [], pct: {} }
    const av = sc.centerAvatar, bg = sc.centerAvatarBg
    out.av = {
      avX: av.x, avY: av.y, dispW: av.displayWidth, dispH: av.displayHeight,
      scaleX: av.scaleX, bgR: bg.radius, bgD: bg.radius * 2,
      ring: sc.centerTimerRing,
      // 头像方框四角距离圆心
      cornerDist: Math.hypot(av.displayWidth / 2, av.displayHeight / 2)
    }
    // 岛屿标签越界检查
    const { BOARD, ISLAND_BY_ID } = window.__data || {}
    return out
  }).catch(async () => null)
  // 直接在页面里做标签检查（不依赖 __data）
  const labels = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const res = []
    const c = sc.cell
    const texts = sc.children.list.filter((o) => o.type === 'Text')
    for (const t of texts) {
      const b = t.getBounds()
      const grid = { left: sc.boardLeft - c / 2, top: sc.boardTop - c / 2, right: sc.boardLeft + c * 10.5, bottom: sc.boardTop + c * 10.5 }
      if (b.x < grid.left - 1 || b.y < grid.top - 1 || b.x + b.width > grid.right + 1 || b.y + b.height > grid.bottom + 1) {
        res.push({ text: t.text, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), fs: t.style.fontSize })
      }
    }
    return { cell: c, grid: { left: sc.boardLeft - c / 2, top: sc.boardTop - c / 2 }, bad: res }
  })
  console.log(JSON.stringify({ info, labels }, null, 2))
  await page.screenshot({ path: process.env.OUT || '/tmp/board_before.png' })
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
