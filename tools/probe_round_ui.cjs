// 圆角化视觉验证：大厅 / 选角 / 棋盘 / 胜利 / 数据详情 五屏截图
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
  await sleep(1600)
  await page.screenshot({ path: '/tmp/r1_lobby.png' })

  await page.evaluate(() => window.__game.scene.start('SelectScene'))
  await sleep(1400)
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('SelectScene')
    sc.pickChar(1) // 选中路飞：触发选中态绿色样式
  })
  await sleep(600)
  await page.screenshot({ path: '/tmp/r2_select.png' })

  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)
  await page.screenshot({ path: '/tmp/r3_board.png' })

  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    s.players[0].cash = 3200
    s.players[0].islandIds = [1, 5, 9]
    s.players[0].stats = { eventsDrawn: 4, cardsUsed: 3 }
    s.players[1].bankrupt = s.players[2].bankrupt = s.players[3].bankrupt = true
    s.winner = s.players[0]
    s.phase = 'ended'
    sc.refresh()
  })
  await sleep(2600)
  await page.screenshot({ path: '/tmp/r4_victory.png' })
  console.log('JS 错误:', errors.length ? errors.join(' || ') : '无')
  await browser.close()
  process.exit(errors.length ? 1 : 0)
})()
