const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const missing = []
  page.on('response', (r) => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()) })
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2000)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)

  const res = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const out = {}
    // 先给玩家一座岛，让岛屿面板有内容
    sc.state.players[0].islandIds.push(1)
    sc.openIslandPanel()
    await new Promise(r => setTimeout(r, 250))
    out.island = !!sc.customPanel
    if (sc.customPanel) sc.closeCustomPanel()
    sc.openRules()
    await new Promise(r => setTimeout(r, 250))
    out.rulesModal = !!sc.modal
    out.rulesCustom = !!sc.customPanel
    if (sc.modal) sc.closeModal()
    if (sc.customPanel) sc.closeCustomPanel()
    // 交易面板
    sc.openTradePanel()
    await new Promise(r => setTimeout(r, 250))
    out.trade = !!sc.customPanel || !!sc.modal
    if (sc.customPanel) sc.closeCustomPanel()
    if (sc.modal) sc.closeModal()
    return out
  })
  console.log('panels:', JSON.stringify(res))
  console.log('missing:', JSON.stringify(missing, null, 1))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
