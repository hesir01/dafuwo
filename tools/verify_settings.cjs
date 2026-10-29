const { chromium } = require('playwright-core')
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  await page.screenshot({ path: '.playwright-cli/set-title.png' })

  const r = await page.evaluate(() => {
    const g = window.__game
    const sc = g.scene.getScene('BootScene')
    const api = g.registry.get('openSettings')(sc)
    window.__setApi = api
    const labels = api.layer.list
      .filter((c) => c.type === 'Container' && c.list)
      .map((c) => (c.list.find((x) => x.type === 'Text') || {}).text)
      .filter(Boolean)
    return { labels }
  })
  console.log('controls:', JSON.stringify(r.labels))
  await page.waitForTimeout(300)
  await page.screenshot({ path: '.playwright-cli/set-panel.png' })

  // 关闭音效开关 + 调低音乐音量，再点完成 → 校验持久化
  const res = await page.evaluate(() => {
    const api = window.__setApi
    const btns = api.layer.list
      .filter((c) => c.type === 'Container' && c.list.some((x) => x.type === 'Text'))
      .map((c) => ({ c, label: (c.list.find((x) => x.type === 'Text') || {}).text }))
    const sfxToggle = btns.find((b) => b.label === '开')
    const bgmMinus = btns.filter((b) => b.label === '−')[1]
    sfxToggle.c.emit('pointerdown')
    if (bgmMinus) { bgmMinus.c.emit('pointerdown'); bgmMinus.c.emit('pointerdown') }
    const done = btns.find((b) => b.label === '完 成')
    done.c.emit('pointerdown')
    return { saved: JSON.parse(localStorage.getItem('op_settings') || 'null') }
  })
  console.log('saved:', JSON.stringify(res.saved))
  await page.waitForTimeout(300)
  await page.screenshot({ path: '.playwright-cli/set-closed.png' })
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
