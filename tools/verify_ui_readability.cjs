// 字号与行动横幅视觉验证：进入真实对局，截取三个关键状态
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const URL = process.env.OP_URL || 'http://127.0.0.1:3000'
const OUT = '/tmp/op_ui'

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 直进单机对局（避免联机选角流程）
  const started = await page.evaluate(() => {
    const g = window.__game
    if (!g) return false
    g.scene.start('BoardScene', { autoPlay: false })
    return true
  })
  console.log('enter board:', started)
  await page.waitForTimeout(1200)

  // 状态1：掷骰阶段（我的回合）
  await page.screenshot({ path: path.join(OUT, '1_roll.png') })
  const banner1 = await page.evaluate(() => {
    const sc = window.__game && window.__game.scene ? window.__game.scene.getScene('BoardScene') : null
    return sc && sc.actionBannerTxt ? sc.actionBannerTxt.text : null
  })
  console.log('banner@roll:', JSON.stringify(banner1))

  // 状态2：购买决策阶段 —— 手动构造 pendingIslandId
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    // 从 islandState 键取第一个岛屿 id（无需引擎 BOARD 模块）
    const islandId = Number(Object.keys(s.islandState || {})[0])
    if (!Number.isNaN(islandId)) {
      const p = s.players[s.current]
      p.position = p.position || 0
      const st = s.islandState[islandId] || (s.islandState[islandId] = { ownerId: null, level: 0 })
      if (st.ownerId == null) {
        s.phase = 'awaitBuy'
        s.pendingIslandId = islandId
      }
    }
    sc.refresh()
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, '2_buy.png') })
  const banner2 = await page.evaluate(() => {
    const sc = window.__game && window.__game.scene ? window.__game.scene.getScene('BoardScene') : null
    return sc && sc.actionBannerTxt ? sc.actionBannerTxt.text : null
  })
  console.log('banner@buy:', JSON.stringify(banner2))

  // 状态3：非本人回合观战（模拟 online）
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.online = true
    sc.mySeat = 1
    sc.refresh()
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, '3_watch.png') })
  const banner3 = await page.evaluate(() => {
    const sc = window.__game && window.__game.scene ? window.__game.scene.getScene('BoardScene') : null
    return sc && sc.actionBannerTxt ? sc.actionBannerTxt.text : null
  })
  console.log('banner@watch:', JSON.stringify(banner3))

  // 字号抽查：横幅文字的实际显示尺寸
  const sizeInfo = await page.evaluate(() => {
    const sc = window.__game && window.__game.scene ? window.__game.scene.getScene('BoardScene') : null
    if (!sc) return null
    return {
      bannerFontSize: sc.actionBannerTxt && sc.actionBannerTxt.style ? sc.actionBannerTxt.style.fontSize : null,
      cashFontSize: sc.cashTxt && sc.cashTxt.style ? sc.cashTxt.style.fontSize : null,
      cellFontSize: sc.cellTxt && sc.cellTxt.style ? sc.cellTxt.style.fontSize : null,
      logFontSize: sc.logTxt && sc.logTxt.style ? sc.logTxt.style.fontSize : null
    }
  })
  console.log('font sizes:', JSON.stringify(sizeInfo))

  await browser.close()
  console.log('screenshots at', OUT)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
