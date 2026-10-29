// 布局验证：直接切 BoardScene 截图（headless 下 Phaser 点击映射不可靠，用实例 API 绕过）
const { chromium } = require('playwright-core')

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '.playwright-cli/layout-left-1280.png' })

  // 小屏检查
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '.playwright-cli/layout-left-1000.png' })
  await browser.close()
  console.log('done')
})().catch((e) => { console.error(e); process.exit(1) })
