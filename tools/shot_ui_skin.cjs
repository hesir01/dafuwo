// 静态构建版 UI 截图：主菜单 + 大厅（无房间 / 有房间）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' })
  await sleep(2500)
  await page.screenshot({ path: '.playwright-cli/ui-menu.png' })

  await page.evaluate(async () => {
    const g = window.__game
    g.scene.start('LobbyScene')
    await new Promise(r => setTimeout(r, 800))
  }).catch(() => {})
  await sleep(600)
  await page.screenshot({ path: '.playwright-cli/ui-lobby-join.png' })

  // 模拟房间视图（本地造数据，不依赖后端）
  await page.evaluate(() => {
    const g = window.__game
    const sc = g.scene.getScene('LobbyScene')
    sc.roomData = {
      code: '482913',
      hostId: 'me',
      players: [
        { name: '船长A', isYou: true, isHost: true, socketId: 'me' },
        { name: '剑士B', isYou: false, isHost: false, charId: 'char_02' },
        { name: '航海C', isYou: false, isHost: false }
      ]
    }
    sc.rebuild()
  })
  await sleep(700)
  await page.screenshot({ path: '.playwright-cli/ui-lobby-room.png' })

  console.log(JSON.stringify({ errors: errors.slice(0, 5) }))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
