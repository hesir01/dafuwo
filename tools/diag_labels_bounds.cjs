const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1080, height: 610 }, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1800)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2400)
  const rows = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const c = sc.cell, half = (c - 2) / 2
    const out = []
    for (const t of sc.children.list) {
      if (t.type !== 'Text' || !t.text) continue
      let owner = null
      for (let i = 0; i < 40; i++) {
        const p = sc.cellPos(i)
        if (Math.abs(t.x - p.x) < 2 && Math.abs(t.y - p.y) < c * 0.6) { owner = { i, ...p }; break }
      }
      if (!owner) continue
      const b = t.getBounds()
      out.push({
        i: owner.i, text: t.text, fs: t.style.fontSize,
        leftOver: +(owner.x - half - b.x).toFixed(1),
        rightOver: +(b.x + b.width - (owner.x + half)).toFixed(1),
        topOver: +(owner.y - half - b.y).toFixed(1),
        bottomOver: +(b.y + b.height - (owner.y + half)).toFixed(1),
        w: Math.round(b.width), h: Math.round(b.height)
      })
    }
    return { cell: c, rows: out }
  })
  const bad = rows.rows.filter((r) => r.leftOver > 1 || r.rightOver > 1 || r.topOver > 1 || r.bottomOver > 1)
  console.log('cell', rows.cell, 'labels', rows.rows.length, 'bad', bad.length)
  console.log(JSON.stringify(bad, null, 1))
  console.log('widest', JSON.stringify(rows.rows.sort((a, b) => b.w - a.w).slice(0, 5)))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
