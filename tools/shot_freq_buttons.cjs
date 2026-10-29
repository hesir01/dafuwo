// 验证按钮使用频率分级：主行(掷骰/结束回合)加高、次行缩矮；工具条岛屿加大、其余紧凑
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 2 })
  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2000)

  const info = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const geo = (b) => b && { x: Math.round(b.root.x), y: Math.round(b.root.y), w: b.w, h: b.h, on: b.enabled }
    return {
      roll: geo(sc.btnRoll), end: geo(sc.btnEnd),
      skill: geo(sc.btnSkill), voyage: geo(sc.btnVoyage),
      islands: geo(sc.btnIslands), auto: geo(sc.btnAuto),
      rules: geo(sc.btnRules), settings: geo(sc.btnSettings), exit: geo(sc.btnExit)
    }
  })
  console.log(JSON.stringify(info))

  // 溢出与重叠检查：工具条最左端不超出右栏内容区；相邻按钮水平间隙 >= 4px
  const chk = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const btns = [sc.btnExit, sc.btnSettings, sc.btnRules, sc.btnAuto, sc.btnIslands]
    const spans = btns.map((b) => [b.root.x - b.w / 2, b.root.x + b.w / 2]).sort((a, b) => a[0] - b[0])
    let minGap = Infinity
    for (let i = 1; i < spans.length; i++) minGap = Math.min(minGap, spans[i][0] - spans[i - 1][1])
    return { leftMost: Math.round(spans[0][0]), panelLeft: Math.round(sc.panel.x + 16), minGap: Math.round(minGap * 10) / 10 }
  })
  console.log('toolbar:', JSON.stringify(chk), chk.leftMost >= chk.panelLeft && chk.minGap >= 4 ? 'OK' : 'BAD!')

  // 主行应比次行高
  const rows = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return { h1: sc.btnRoll.h, h2: sc.btnSkill.h, total: sc.btnRoll.root.y + sc.btnRoll.h / 2 - (sc.btnSkill.root.y - sc.btnSkill.h / 2) }
  })
  console.log('rows:', JSON.stringify(rows), rows.h1 > rows.h2 ? 'OK' : 'BAD!')

  // 截图：中央操作区 + 右栏顶部工具条
  const c1 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const cam = sc.cameras.main
    return { x: sc.actionBannerBg.x - sc.actionBannerBg.width / 2 - 8 - cam.scrollX, y: sc.actionBannerBg.y - 20 - cam.scrollY, width: sc.actionBannerBg.width + 16, height: 180 }
  })
  await page.screenshot({ path: '/tmp/freq_actions.png', clip: c1 })
  const c2 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const cam = sc.cameras.main
    return { x: sc.panel.x - cam.scrollX, y: sc.panel.y - cam.scrollY, width: sc.panel.w, height: 120 }
  })
  await page.screenshot({ path: '/tmp/freq_toolbar.png', clip: c2 })
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
