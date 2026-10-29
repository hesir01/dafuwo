// 主菜单 + 大厅 wood 按钮验证截图（2x DPR）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => errs.push('reqfail: ' + r.url()))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await sleep(2600)
  await page.screenshot({ path: '.playwright-cli/btn-title.png' })
  // 点「点击出航」进大厅，看三个 wood 大按钮
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('BootScene')
    window.__game.scene.start('LobbyScene')
  })
  await sleep(2400)
  await page.screenshot({ path: '.playwright-cli/btn-lobby.png' })
  console.log('errors:', errs.length ? errs.slice(0, 10) : 'none')
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
