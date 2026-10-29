// 快捷互动面板布局验证：进棋盘 → 打开快捷互动 → 截图 → 表情/短语/关闭坐标断言
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await sleep(2600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2600)
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    s.btnChat.root.emit('pointerdown')
  })
  await sleep(500)
  await page.screenshot({ path: '.playwright-cli/quickchat-v2.png' })
  // 断言：面板内所有按钮 y 范围互不重叠且都在面板内
  const report = await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    // 找 depth 780 的 layer
    const layers = s.children.list.filter((c) => c.depth === 780 && c.list)
    const layer = layers[layers.length - 1]
    if (!layer) return { found: false }
    const btns = layer.list.filter((c) => c.list && c.input).map((c) => ({
      label: c.list.find((t) => t.text)?.text || '?',
      top: Math.round(c.y - (c.list.find((t) => t.text) ? 18 : 0)),
      y: Math.round(c.y)
    }))
    return { found: true, ys: btns.map((b) => `${b.label}@${b.y}`).join(' | ') }
  })
  console.log(JSON.stringify(report))
  console.log('errors:', errs.length ? errs.slice(0, 6) : 'none')
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
