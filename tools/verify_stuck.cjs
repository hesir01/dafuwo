const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2000)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)

  const trace = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    sc.autoPlay = true
    const log = []
    const deadline = Date.now() + 12000
    let last = ''
    while (Date.now() < deadline && s.phase !== 'ended') {
      const key = `${s.phase}|${s.current}|${s.turn}|anim:${sc.animating}|dice:${!!sc.diceAnimating}|autoStepAt:${Math.round(sc.autoStepAt)}`
      if (key.split('|')[0] !== last) {
        log.push({ t: Math.round(Date.now() - (deadline - 12000)), phase: s.phase, current: s.current, turn: s.turn, animating: sc.animating, diceAnimating: !!sc.diceAnimating })
        last = s.phase
      }
      await new Promise(r => setTimeout(r, 200))
    }
    // 卡住时细查：手动推一次 AI 决策看是否报错
    let manualErr = null
    try {
      const before = s.phase
      sc.aiAutoStep()
      await new Promise(r => setTimeout(r, 400))
      manualErr = { before, after: s.phase }
    } catch (e) { manualErr = String(e) }
    return { log, finalPhase: s.phase, manualErr }
  })
  console.log(JSON.stringify(trace, null, 1))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
