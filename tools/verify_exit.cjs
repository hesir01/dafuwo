// 对局内「离船」按钮验证：进棋盘 → 截工具行 → 打开确认弹层 → 截图 → 点继续 → 再点返回大厅
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await sleep(2600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2600)
  await page.screenshot({ path: '.playwright-cli/exit-board.png' })
  // 程序化点「离船」
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    s.btnExit.root.emit('pointerdown')
  })
  await sleep(600)
  await page.screenshot({ path: '.playwright-cli/exit-confirm.png' })
  // 点「继续对局」
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    s.btnExit.root.scene // noop
    const layer = s._quitLayer
    console.assert(!!layer, 'quit layer should exist')
    // 找到继续对局按钮：遍历 layer 里 makeButton 容器，第二个是继续
    const btns = layer.list.filter((c) => c.list && c.input)
    btns[btns.length - 1].emit('pointerdown')
  })
  await sleep(400)
  const stillBoard = await page.evaluate(() => window.__game.scene.isActive('BoardScene'))
  console.log('after 继续 still board:', stillBoard)
  // 再开一次，点返回大厅
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    s.btnExit.root.emit('pointerdown')
  })
  await sleep(400)
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    const btns = s._quitLayer.list.filter((c) => c.list && c.input)
    btns[0].emit('pointerdown')
  })
  await sleep(900)
  const lobby = await page.evaluate(() => window.__game.scene.isActive('LobbyScene'))
  console.log('after 返回大厅 lobby active:', lobby)
  console.log('errors:', errs.length ? errs.slice(0, 10) : 'none')
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
