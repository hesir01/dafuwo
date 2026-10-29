// 反馈系统真机验证：垄断仪式 / 金币飞行 / 发牌翻转
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

  // 1) 垄断仪式：先 refresh 建立基线快照，再给玩家0 集齐 g1（东海·A）
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.refresh() // 基线快照
    const s = sc.state
    ;[1, 2, 3].forEach((id) => { s.islandState[id] = { ownerId: 0, level: 1 }; s.players[0].islandIds.push(id) })
    sc.refresh() // diff → 仪式
  })
  await sleep(700)
  await page.screenshot({ path: '/tmp/fb1_monopoly.png' })

  // 2) 金币飞行：玩家0 → 玩家1 转 300
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.refresh()
    sc.state.players[0].cash -= 300
    sc.state.players[1].cash += 300
    sc.refresh()
  })
  await sleep(320)
  await page.screenshot({ path: '/tmp/fb2_coins.png' })

  // 3) 发牌翻转：在行动者所在格翻开一枚岩浆果实
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const pos = sc.state.players[sc.state.current].position
    sc.playCardReveal(sc.cellPos(pos), { uid: 'probe', kind: 'fruit', defId: 'magma' })
  })
  await sleep(560)
  await page.screenshot({ path: '/tmp/fb3_reveal.png' })

  const state = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return {
      snapRecorded: !!sc._fbSnap,
      banners: sc.children.list.filter((c) => c.type === 'Graphics').length,
      alive: !sc.portraitBlocked
    }
  })
  console.log('state:', JSON.stringify(state), 'JS 错误:', errors.length ? errors.join(' || ') : '无')
  await browser.close()
  process.exit(errors.length ? 1 : 0)
})()
