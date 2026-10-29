// 点头像 → 玩家档案 → 发起交易：真实鼠标点击链路验证 + 截图
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = process.env.URL || 'http://localhost:5173/index.html'

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)

  // 给 1 号玩家（索隆）一块正文，便于验证「出售」行
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const me = sc.state.players[sc.state.current]
    me.hand = [{ uid: 'h1', kind: 'history', historyId: 2 }]
    sc.state.phase = 'awaitAction'
    sc.state.players[1].islandIds = [3, 5]   // 对方有岛，档案里能看到岛屿清单
    sc.refresh()
  })
  await sleep(300)

  // 真实点击第 2 张玩家卡（他人）
  const pos = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const c = sc.playerCards[1]
    return { x: Math.round(c.bg.x), y: Math.round(c.bg.y) }
  })
  await page.mouse.click(pos.x, pos.y)
  await sleep(500)
  const infoOpen = await page.evaluate(() => !!window.__game.scene.getScene('BoardScene').customPanel)
  await page.screenshot({ path: '/tmp/info_other.png' })

  // 点「发起交易」：遍历 modal 里的按钮容器找文字
  const clicked = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const root = sc.customPanel && sc.customPanel.root
    if (!root) return false
    let found = null
    const walk = (o) => {
      if (!o) return
      if (o.type === 'Container' && o.list) {
        const t = o.list.find((x) => x.type === 'Text' && /发起交易/.test(x.text || ''))
        if (t && o.input) found = o
      }
      if (o.list) o.list.forEach(walk)
    }
    walk(root)
    if (!found) return false
    found.emit('pointerdown')
    return true
  })
  await sleep(600)
  const tradeOpen = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return { open: !!sc.customPanel, title: sc.customPanel ? sc.customPanel.title : null }
  })
  await page.screenshot({ path: '/tmp/trade_targeted.png' })

  // 自己的档案
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.closeCustomPanel(); sc.openPlayerInfo(sc.state.current)
  })
  await sleep(400)
  await page.screenshot({ path: '/tmp/info_self.png' })

  console.log(JSON.stringify({ pos, infoOpen, clicked, tradeOpen, errors }, null, 2))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
