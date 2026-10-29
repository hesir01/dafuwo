// 真实点击链路：点左栏手牌小卡 → 卡牌详情（不是玩家档案）；点卡片空白处 → 玩家档案；点中央头像 → 档案
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
  await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const me = sc.state.players[sc.state.current]
    me.hand = [{ uid: 'h3', kind: 'fruit', defId: 'dark' }]
    sc.state.players[1].hand = [{ uid: 'o1', kind: 'history', historyId: 2 }]
    sc.state.phase = 'awaitAction'
    sc.refresh()
    await new Promise((r) => setTimeout(r, 200))
  })

  const pts = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const mini = sc.playerCards[0].handC.list[0]
    return {
      mini: { x: Math.round(mini.x), y: Math.round(mini.y) },
      blank: { x: Math.round(sc.playerCards[0].bg.x - sc.playerCards[0].bg.width / 2 + 24), y: Math.round(sc.playerCards[0].bg.y + 20) },
      otherMini: { x: Math.round(sc.playerCards[1].handC.list[0].x), y: Math.round(sc.playerCards[1].handC.list[0].y) },
      avatar: { x: Math.round(sc.centerAvatar.x), y: Math.round(sc.centerAvatar.y) }
    }
  })

  const open = async (p) => {
    await page.mouse.click(p.x, p.y)
    await sleep(350)
    return page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      const texts = []
      const walk = (o) => { if (!o) return; if (o.type === 'Text') texts.push(o.text); if (o.list) o.list.forEach(walk) }
      walk(sc.customPanel && sc.customPanel.root)
      return { open: !!sc.customPanel, texts: texts.slice(0, 3) }
    })
  }
  const close = async () => {
    await page.evaluate(() => window.__game.scene.getScene('BoardScene').closeCustomPanel())
    await sleep(200)
  }

  const r = {}
  r.miniClick = await open(pts.mini); await close()
  r.otherMiniClick = await open(pts.otherMini); await close()
  r.blankClick = await open(pts.blank); await close()
  r.avatarClick = await open(pts.avatar); await close()

  console.log(JSON.stringify({ pts, r, errors }, null, 2))
  const ok = r.miniClick.open && /暗暗果实/.test(r.miniClick.texts[0] || '')
    && r.otherMiniClick.open && /路标历史正文/.test(r.otherMiniClick.texts[0] || '')
    && r.blankClick.open && /档案/.test(r.blankClick.texts[0] || '')
    && r.avatarClick.open && /档案/.test(r.avatarClick.texts[0] || '')
  await browser.close()
  console.log(ok ? 'CLICK CHECK PASS' : 'CLICK CHECK FAIL')
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
