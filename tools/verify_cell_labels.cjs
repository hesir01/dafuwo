// 验证：棋盘格名牌与图标都在自己的格子内，中央头像+倒计时环不越出羊皮纸安全区
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SIZES = [[1080, 610], [1280, 720], [1512, 760], [900, 540]]
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let fail = 0
  for (const [W, H] of SIZES) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
    await sleep(1800)
    await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
    await sleep(2400)
    const r = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      const c = sc.cell
      const half = (c - 2) / 2
      const issues = []
      let labels = 0, cells = 0, hidden = []
      // 逐格收集：格子中心 -> 该格内应包含的文本/图标
      for (let i = 0; i < 40; i++) {
        const p = sc.cellPos(i)
        cells++
        const inCell = sc.children.list.filter((o) => {
          if (!['Text', 'Image'].includes(o.type)) return false
          if (o.text !== undefined) return false
          return Math.abs(o.x - p.x) < 2 && Math.abs(o.y - p.y) < c * 0.6
        })
        for (const obj of inCell) {
          const b = obj.getBounds()
          if (b.x < p.x - half - 1 || b.x + b.width > p.x + half + 1 || b.y < p.y - half - 1 || b.y + b.height > p.y + half + 1) {
            issues.push({ kind: 'icon', i, name: obj.texture?.key, cell: [p.x, p.y], bounds: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] })
          }
        }
      }
      // 名牌：文本原点在格心水平方向 ±2，垂直在格内
      for (const t of sc.children.list) {
        if (t.type !== 'Text' || !t.text) continue
        const p = sc.cellPos(0)
        void p
        const b = t.getBounds()
        // 判断是否落在棋盘 40 格区域里
        const gridLeft = sc.boardLeft - c / 2, gridTop = sc.boardTop - c / 2
        if (b.x < gridLeft - 1 || b.x + b.width > gridLeft + c * 11 + 1) continue
        if (b.y < gridTop - 1 || b.y + b.height > gridTop + c * 11 + 1) continue
        // 找所属格
        let owner = null
        for (let i = 0; i < 40; i++) {
          const cp = sc.cellPos(i)
          if (t.x >= cp.x - c / 2 && t.x <= cp.x + c / 2 && b.y >= cp.y - c / 2 - 1 && b.y <= cp.y + c / 2) { owner = { i, ...cp }; break }
        }
        if (!owner) continue
        labels++
        if (b.y + b.height > owner.y + half + 1 || b.y < owner.y - half - 1) {
          issues.push({ kind: 'label-v', i: owner.i, text: t.text, dy: Math.round(b.y + b.height - (owner.y + half)) })
        }
      }
      // 中央：头像圆 + 倒计时环必须落在羊皮纸安全矩形内
      const cr = sc.centerRect
      const av = sc.centerAvatar, ring = sc.centerTimerRing
      const ringOuter = ring.r + (ring.w + 3) / 2
      const avatarMax = Math.max(av.displayWidth, av.displayHeight) / 2 * 1.09 // 含弹跳余量
      const rOuter = Math.max(ringOuter, avatarMax)
      const centerFit = {
        left: av.x - rOuter >= cr.x - 0.5,
        right: av.x + rOuter <= cr.x + cr.w + 0.5,
        top: av.y - rOuter >= cr.y - 0.5,
        bottom: av.y + rOuter <= cr.y + cr.h + 0.5,
        ringOuter, cr, av: { x: Math.round(av.x), y: Math.round(av.y) }
      }
      return { cell: c, labels, cells, issues, centerFit }
    })
    const centerOk = Object.values(r.centerFit).slice(0, 4).every(Boolean)
    const ok = r.issues.length === 0 && centerOk
    if (!ok) fail++
    console.log(`${W}x${H} cell=${r.cell} 名牌=${r.labels} 越界=${r.issues.length} 中央=${centerOk ? 'OK' : 'NG'} ${ok ? 'PASS' : 'FAIL'}`)
    if (!ok) console.log(JSON.stringify(r.issues.slice(0, 6), null, 1), JSON.stringify(r.centerFit, null, 1))
    await page.screenshot({ path: `/tmp/board_${W}x${H}.png` })
    await page.close()
  }
  await browser.close()
  console.log(fail === 0 ? 'ALL PASS' : `${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
