// 视觉验证：加载 dist 构建（3100 端口），截取大厅与棋盘，检查文字清晰度
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 2 // 模拟 Retina，正是之前模糊的场景
  })
  await page.goto('http://127.0.0.1:3100', { waitUntil: 'networkidle' })
  await page.waitForTimeout(6000) // 等 BootScene 资源与大厅渲染
  await page.screenshot({ path: '/tmp/op_lobby.png' })

  // 进单机对局：点击"单机"按钮（按文本找 canvas 内按钮不可行，走场景注入）
  const result = await page.evaluate(() => {
    const game = window.__game
    if (!game) return 'no-game'
    game.scene.stop('LobbyScene')
    game.scene.start('BoardScene', { solo: true })
    return 'started'
  })
  console.log('scene:', result)
  await page.waitForTimeout(5000)
  await page.screenshot({ path: '/tmp/op_board.png' })
  await browser.close()
  console.log('done')
})()
