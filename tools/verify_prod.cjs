// 生产环境验证：从本机浏览器访问 http://43.128.149.78:8010，进标题 → 单机开局 → 掷骰
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) errs.push('reqfail: ' + r.url()) })
  await page.goto('http://43.128.149.78:8010/', { waitUntil: 'networkidle', timeout: 60000 })
  await sleep(3000)
  await page.screenshot({ path: '.playwright-cli/prod-title.png' })
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2500)
  await page.evaluate(() => window.__game.scene.getScene('BoardScene').handleRoll())
  await sleep(4000)
  const st = await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    return { phase: s.state.phase, turn: s.state.turn, cash: s.state.players.map(p => p.cash) }
  })
  await page.screenshot({ path: '.playwright-cli/prod-board.png' })
  console.log('board state:', JSON.stringify(st))
  console.log('errors:', errs.length ? errs.slice(0, 8) : 'none')
  await browser.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
