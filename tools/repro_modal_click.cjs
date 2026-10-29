// 复现「事件弹窗按钮点击无效」：真实鼠标点击弹窗按钮，检查命中情况
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 160)) })

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => !!window.__game)) break
    await sleep(500)
  }
  await sleep(2200)

  // 进入单机对局
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2500)

  // 强制进入 awaitBuyHistory（与用户截图一致），触发弹窗
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    s.phase = 'awaitBuyHistory'
    s.pendingHistoryPrice = 200
    // 找一块无主的历史正文，补全引擎要求的 pendingHistoryId
    const free = Object.values(s.historyPieces).find((h) => h.ownerId == null)
    s.pendingHistoryId = free ? free.id : null
    s.players[s.current].cash = 5000
    sc.refresh()
  })
  await sleep(600)

  const probe = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const modal = sc.modal
    if (!modal) return { hasModal: false }
    // 找弹窗内可交互容器（按钮）
    const interactives = []
    modal.root.list.forEach((c) => {
      if (c.input) interactives.push(c)
    })
    return {
      hasModal: true,
      rootDepth: modal.root.depth,
      nInteractive: interactives.length,
      btns: interactives.map((b) => {
        const m = b.getWorldTransformMatrix()
        const label = Array.isArray(b.list) ? (b.list.find((o) => o.type === 'Text') || {}).text : null
        return { x: Math.round(m.tx), y: Math.round(m.ty), w: b.width, h: b.height, label }
      })
    }
  })
  console.log('probe:', JSON.stringify(probe, null, 2))

  if (probe.hasModal && probe.btns.length) {
    // 逐个按钮（跳过遮罩）：挂监听 → 真实鼠标点击 → 看是否触发 + 状态是否变化
    // 可传 argv[2] 指定先点哪个按钮（如「放弃」）
    const ordered = probe.btns.filter((b) => b.label)
    const first = process.argv[2]
    if (first) ordered.sort((a, b) => (a.label === first ? -1 : 0) - (b.label === first ? -1 : 0))
    for (const btn of ordered) {
      await page.evaluate((label) => {
        const sc = window.__game.scene.getScene('BoardScene')
        window.__downFired = null
        sc.modal && sc.modal.root.list.forEach((c) => {
          if (!c.input || !Array.isArray(c.list)) return
          const t = c.list.find((o) => o.type === 'Text')
          if (t && t.text === label) c.on('pointerdown', () => { window.__downFired = label })
        })
      }, btn.label)
      await page.mouse.click(btn.x, btn.y)
      await sleep(400)
      const res = await page.evaluate(() => {
        const sc = window.__game.scene.getScene('BoardScene')
        return { downFired: window.__downFired, phase: sc.state ? sc.state.phase : 'GONE', modalAlive: !!sc.modal }
      })
      console.log(`click "${btn.label}" @(${btn.x},${btn.y}) -> downFired=${res.downFired} phase=${res.phase} modalAlive=${res.modalAlive}`)
      if (res.modalAlive) break // 点击生效弹窗才会关，关了就不用继续
    }

    // 补充：hitTestPointer 诊断（点击后若弹窗还在）
    const diag = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      if (!sc.modal) return null
      const p = sc.input.activePointer
      const hits = sc.input.hitTestPointer(p).map((o) => o.type || o.name)
      return { hits }
    })
    if (diag) console.log('hitTestPointer:', JSON.stringify(diag))
  }

  console.log('errors:', errors.filter((e) => !e.includes('404')).slice(0, 5))
  await browser.close()
})()
