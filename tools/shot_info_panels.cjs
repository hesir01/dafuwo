// 截图：岛屿资料卡 + 玩家档案（左对齐分段）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const p = await b.newPage({ viewport: { width: 1080, height: 610 }, deviceScaleFactor: 2 })
  await p.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1800)
  await p.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)
  // 岛屿卡：庞克哈萨德（id 17）
  await p.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const idx = sc.state ? null : null
    void idx
    // 找到该岛屿在棋盘上的格子
    const BOARD = sc.children ? null : null
    void BOARD
    sc.showIslandCard(sc.boardCX, sc.boardCY, sc.cell, 17)
  })
  await sleep(500)
  await p.screenshot({ path: '/tmp/panel_island.png' })
  const islandGeo = await p.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const lay = sc.islandCard
    const b = lay.getBounds()
    const bad = []
    for (const ch of lay.list) {
      if (ch.type !== 'Text' || !ch.text) continue
      const bb = ch.getBounds()
      if (bb.x < b.x - 1 || bb.x + bb.width > b.x + b.width + 1 || bb.y < b.y - 1 || bb.y + bb.height > b.y + b.height + 1) {
        bad.push({ text: ch.text.slice(0, 24), dx: Math.round(bb.x + bb.width - (b.x + b.width)), dy: Math.round(bb.y + bb.height - (b.y + b.height)) })
      }
    }
    return { card: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], bad }
  })
  console.log('岛卡:', JSON.stringify(islandGeo))
  // 玩家档案
  await p.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.closeIslandCard()
    sc.openPlayerInfo(0)
  })
  await sleep(500)
  await p.screenshot({ path: '/tmp/panel_player.png' })
  const playerGeo = await p.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const root = sc.customPanel.root
    const texts = root.list.filter((o) => o.type === 'Text')
    return texts.map((t) => ({ text: t.text.slice(0, 30).replace(/\n/g, '\\n'), x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.width), h: Math.round(t.height) }))
  })
  console.log('档案文本:', JSON.stringify(playerGeo, null, 1))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
