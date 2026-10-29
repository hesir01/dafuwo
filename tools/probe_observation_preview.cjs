// 见闻色「预览下一格」真机冒烟：注入见闻色卡 → 点使用 → 二选一弹窗 → 预览面板内容正确。
// 用法：起 vite(5173) 后 node tools/probe_observation_preview.cjs
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

  const out = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const sc = window.__game.scene.getScene('BoardScene')
    // 面板文本藏在多层 Container 里，递归收集
    const collectTexts = (root) => {
      const out = []
      const walk = (c) => {
        if (c.type === 'Text') { out.push(c.text); return }
        if (Array.isArray(c.list)) c.list.forEach(walk)
      }
      if (root && Array.isArray(root.list)) root.list.forEach(walk)
      return out
    }
    const res = {}
    const s = sc.state
    // 固定条件：行动者为 0 号、行动阶段、注入见闻色
    s.current = 0
    s.phase = 'awaitAction'
    s.players[0].position = 5
    s.players[0].cardsUsedThisTurn = 0
    s.players[0].hand.push({ uid: 'probe_obs', kind: 'haki', defId: 'observation' })
    sc.refresh(); await wait(150)

    // 1) 使用入口 → 二选一确认弹窗
    const card = s.players[0].hand[0]
    sc.confirmObservationPreview(card); await wait(150)
    const chooserTexts = sc.customPanel ? collectTexts(sc.customPanel.root) : []
    res.chooserShown = !!sc.customPanel
    res.chooserHasPreviewBtn = chooserTexts.some((t) => /预览下一格/.test(t))
    res.chooserHasKeepBtn = chooserTexts.some((t) => /收手保留/.test(t))

    // 2) 点预览 → 卡被消耗 → 预览面板显示下一格情报（位置 6）
    sc.doPreview(card); await wait(200)
    const panelTexts = sc.customPanel ? collectTexts(sc.customPanel.root) : []
    res.previewShown = !!sc.customPanel
    res.previewHasPos = panelTexts.some((t) => /位置 6/.test(t))
    res.handConsumed = s.players[0].hand.length === 0
    res.usedThisTurn = s.players[0].cardsUsedThisTurn === 1
    res.modalMarked = s.modal && s.modal.type === 'preview' && s.modal.position === 6
    res.panelTitle = (panelTexts[0] || '')
    return res
  })
  console.log(JSON.stringify(out, null, 2))
  const pass = out.chooserShown && out.chooserHasPreviewBtn && out.chooserHasKeepBtn &&
    out.previewShown && out.previewHasPos && out.handConsumed && out.usedThisTurn && out.modalMarked
  console.log(`\nJS 错误: ${errors.length ? errors.join('\n') : '无'}`)
  console.log(pass && errors.length === 0 ? '结果：通过' : '结果：失败')
  await browser.close()
  process.exit(pass && errors.length === 0 ? 0 : 1)
})()
