// 胜利演出真机验证：注入终局 → 分时点截图（聚光/金币 → 暗幕 → 面板弹入 → 彩带+完整面板）
// 用法：起 vite(5173) 后 node tools/probe_victory_fx.cjs
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = process.env.URL || 'http://localhost:5173/index.html'

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/socket\.io|Failed to load resource|ERR_CONNECTION/.test(m.text())) errors.push('CONSOLE: ' + m.text().slice(0, 160))
  })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)
  // 强制终局：胜者 = 座位 0（含统计，模拟真实结算数据）
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    s.players[0].cash = 3200
    s.players[0].islandIds = [1, 5, 9]
    s.players[0].hand.push({ uid: 'h1', kind: 'history', defId: 'history', historyId: 1 })
    s.players[0].stats = { eventsDrawn: 4, cardsUsed: 3 }
    s.players[1].bankrupt = true
    s.players[2].bankrupt = true
    s.players[3].bankrupt = true
    s.winner = s.players[0]
    s.winKind = 'bankruptcy'
    s.phase = 'ended'
    sc.refresh()
  })
  for (const [name, ms] of [['v1_spotlight', 450], ['v2_dim', 1050], ['v3_panel_in', 1700], ['v4_final', 3200]]) {
    await sleep(name === 'v1_spotlight' ? 450 : ms - (name === 'v2_dim' ? 450 : name === 'v3_panel_in' ? 1050 : 1700))
    await page.screenshot({ path: `/tmp/${name}.png` })
  }
  const state = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return { victoryShown: sc.victoryShown, tweens: sc.tweens.getTweens().length }
  })
  console.log('state:', JSON.stringify(state), 'JS 错误:', errors.length ? errors.join(' || ') : '无')
  await browser.close()
  process.exit(errors.length ? 1 : 0)
})()
