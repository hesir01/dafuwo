// 验证按钮使用频率分级：主行(掷骰/结束回合)加高、次行缩矮；岛屿速查挪进操作区第三行
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
    const r = {
      roll: geo(sc.btnRoll), end: geo(sc.btnEnd),
      skill: geo(sc.btnSkill), voyage: geo(sc.btnVoyage),
      islands: geo(sc.btnIslands),
      auto: geo(sc.btnAuto), rules: geo(sc.btnRules), settings: geo(sc.btnSettings), exit: geo(sc.btnExit)
    }
    // 溢出与重叠检查
    const tb = [sc.btnExit, sc.btnSettings, sc.btnRules, sc.btnAuto]
    const spans = tb.map((b) => [b.root.x - b.w / 2, b.root.x + b.w / 2]).sort((a, b) => a[0] - b[0])
    let minGap = Infinity
    for (let i = 1; i < spans.length; i++) minGap = Math.min(minGap, spans[i][0] - spans[i - 1][1])
    r.toolbar = {
      leftMost: Math.round(spans[0][0]), panelLeft: Math.round(sc.panel.x + 16),
      minGap: Math.round(minGap * 10) / 10,
      ok: spans[0][0] >= sc.panel.x + 16 && minGap >= 4
    }
    // 岛屿行应在次行下方、不与其重叠，宽度=操作区全宽
    const skillTop = sc.btnSkill.root.y - sc.btnSkill.h / 2
    const islTop = sc.btnIslands.root.y - sc.btnIslands.h / 2
    r.islandsRow = { belowRow2: islTop >= skillTop + 4, gap: Math.round(islTop - (skillTop + sc.btnSkill.h)) }
    return r
  })
  console.log(JSON.stringify(info, null, 1))

  // 截图：中央操作区（含岛屿行）+ 右栏顶部工具条
  const c1 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const cam = sc.cameras.main
    return { x: sc.actionBannerBg.x - sc.actionBannerBg.width / 2 - 8 - cam.scrollX, y: sc.actionBannerBg.y - 20 - cam.scrollY, width: sc.actionBannerBg.width + 16, height: 230 }
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
