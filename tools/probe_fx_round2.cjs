// 程序化特效 / 数字滚动 / 升级星星 / 最终航行 验证
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

  // 1) 程序化特效一次全放（不同格子）
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const keys = ['fx_haki_lightning', 'fx_ice', 'fx_slash', 'fx_teleport', 'fx_coin_burst']
    keys.forEach((k, i) => sc.playProcFx(k, sc.boardCX - 160 + i * 80, sc.boardCY - 60, sc.cell * 1.4))
  })
  await sleep(240)
  await page.screenshot({ path: '/tmp/x1_procfx.png' })

  // 2) 升级星星
  await page.evaluate(() => window.__game.scene.getScene('BoardScene').playUpgradeFx(5))
  await sleep(520)
  await page.screenshot({ path: '/tmp/x2_stars.png' })

  // 3) 数字滚动：refresh 基线后改现金，读中间值
  const rolling = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const sc = window.__game.scene.getScene('BoardScene')
    sc.refresh()
    await wait(50)
    sc.state.players[0].cash = 2750
    sc.refresh()
    await wait(220) // 滚动中
    const mid = sc.playerCards[0].cashTxt.text
    await wait(600)
    const end = sc.playerCards[0].cashTxt.text
    return { mid, end }
  })
  console.log('cash rolling:', JSON.stringify(rolling))

  // 4) 最终航行：laftel 胜利 → 船在途中截图，面板延迟出现
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    s.players[0].hand.push(
      { uid: 'h1', kind: 'history', defId: 'history', historyId: 1 },
      { uid: 'h2', kind: 'history', defId: 'history', historyId: 2 },
      { uid: 'h3', kind: 'history', defId: 'history', historyId: 3 },
      { uid: 'h4', kind: 'history', defId: 'history', historyId: 4 }
    )
    s.winner = s.players[0]
    s.winKind = 'laftel'
    s.phase = 'ended'
    sc.refresh()
  })
  await sleep(1300)
  await page.screenshot({ path: '/tmp/x3_voyage.png' })
  const panelAt = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const sc = window.__game.scene.getScene('BoardScene')
    return { victory: sc.victoryShown }
  })
  console.log('victory:', JSON.stringify(panelAt), 'JS 错误:', errors.length ? errors.join(' || ') : '无')
  await browser.close()
  process.exit(errors.length ? 1 : 0)
})()
