// 验证「见闻色取消负面事件」弹窗：phase=awaitEventCancel 时必须出现可点的
// 「见闻色取消 / 承受」弹窗，且页面无 JS 报错（此前 modal.event 取值抛错导致整局软锁死）
// 用法：先起静态服务 http://127.0.0.1:8765 指向 dist/，再 node tools/verify_event_cancel.cjs
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  // 纯静态服务没有后端：/socket.io 与 /favicon.ico 的 404 属预期噪声，不计入报错
  const noise = (s) => /socket\.io|favicon\.ico/.test(s)
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text().slice(0, 180)
    const loc = (m.location && m.location() && m.location().url) || ''
    if (noise(t) || noise(loc)) return
    errors.push('CONSOLE: ' + t + (loc ? ' @' + loc : ''))
  })

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => !!window.__game)) break
    await sleep(500)
  }
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2500)

  // 造出引擎真实产物：负面事件 + 手牌有见闻色 → awaitEventCancel
  const injected = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const p = s.players[s.current]
    p.hand.push({ uid: 'haki_probe', kind: 'haki', defId: 'observation' })
    s.lastDice = { d1: 3, d2: 4, total: 7, isDoubles: false }
    s.modal = { type: 'observationCancel', eventId: 'evt_10' }
    s.phase = 'awaitEventCancel'
    sc.refresh()
    return { phase: s.phase, modal: JSON.parse(JSON.stringify(s.modal)), cash: p.cash }
  })
  await sleep(600)

  const probe = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const modal = sc.modal
    if (!modal) return { hasModal: false }
    const labels = []
    const walk = (obj) => {
      if (!obj) return
      if (obj.type === 'Text' && obj.text) labels.push(obj.text)
      if (Array.isArray(obj.list)) obj.list.forEach(walk)
    }
    walk(modal.root)
    const banner = sc.actionBanner ? sc.actionBanner.txt.text : null
    return { hasModal: true, labels, banner }
  })

  const results = []
  const check = (ok, msg) => results.push((ok ? '✓ ' : '✗ ') + msg)
  check(probe.hasModal, `awaitEventCancel 阶段渲染出决策弹窗（modal=${JSON.stringify(injected.modal)}）`)
  const flat = (probe.labels || []).join(' | ')
  check(flat.includes('见闻色取消') && flat.includes('承受'), `弹窗含「见闻色取消 / 承受」按钮（实际：${flat}）`)
  check((probe.banner || '').includes('见闻色霸气'), `行动横幅文案不再误写「花贝利」（实际：${probe.banner}）`)

  // 点「承受」：弹窗关闭 + 卡片保留 + 回到 awaitAction
  if (probe.hasModal) {
    const pos = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      let hit = null
      const walk = (obj) => {
        if (!obj) return
        if (obj.type === 'Text' && obj.text === '承受') hit = obj
        if (Array.isArray(obj.list)) obj.list.forEach(walk)
      }
      walk(sc.modal.root)
      if (!hit) return null
      const r = hit.getBounds()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    if (!pos) {
      check(false, '未能在弹窗中定位「承受」按钮')
    } else {
      await page.mouse.click(pos.x, pos.y)
      await sleep(600)
      const state = await page.evaluate(() => {
        const sc = window.__game.scene.getScene('BoardScene')
        const s = sc.state
        const p = s.players[s.current]
        return {
          phase: s.phase,
          modalClosed: !sc.modal,
          keepCard: p.hand.some((c) => c.defId === 'observation')
        }
      })
      check(state.modalClosed, '点击「承受」后弹窗关闭')
      check(state.phase === 'awaitAction', `点击后回到 awaitAction（实际 ${state.phase}）`)
      check(state.keepCard, '选择承受保留见闻色霸气卡')
    }
  }

  check(errors.length === 0, `页面无 JS 报错${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`)

  console.log(results.join('\n'))
  const failed = results.filter((r) => r.startsWith('✗')).length
  console.log(`\n=== ${results.length - failed} 通过, ${failed} 失败 ===`)
  await browser.close()
  process.exit(failed ? 1 : 0)
})()
