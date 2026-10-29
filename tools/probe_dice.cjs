// 新骰子素材真机验证：掷骰动画定格瞬间截图（中央 + 指挥台两处骰子）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = process.env.URL || 'http://localhost:5173/index.html'

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.animateDiceRoll(3, 5) // 定格：3 + 5
  })
  await sleep(1250) // 翻滚 12 拍(~840ms) 后已定格
  await page.screenshot({ path: '/tmp/dice_final.png' })
  await page.evaluate(() => {
    // 再来一次翻滚中截图
    window.__game.scene.getScene('BoardScene').animateDiceRoll(2, 4)
  })
  await sleep(300)
  await page.screenshot({ path: '/tmp/dice_rolling.png' })
  console.log('JS 错误:', errors.length ? errors.join(' || ') : '无')
  await browser.close()
  process.exit(errors.length ? 1 : 0)
})()
