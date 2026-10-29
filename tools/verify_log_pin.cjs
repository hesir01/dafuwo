// 日志区回归：
// 1) 新日志追加在底部并自动贴底（最新一条可见）
// 2) 上翻历史时位置稳定，新日志不拽走视线，并出现「↓ N 条新消息」浮标
// 3) 点浮标回到最新并继续跟随
// 4) 行级配色：不同事件类型颜色不同
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = process.env.URL || 'http://localhost:5173/index.html'

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)

  const out = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    if (!sc.logLines) return { skipped: '日志区未显示（窗口太矮）' }
    const area = sc.logArea
    const bottomGap = () => {
      const off = sc.logScroll
      return Math.abs(off - Math.max(0, sc.logContentH - area.h))
    }
    sc.state.log.push({ text: 'P 缴纳天上金 300 贝利', turn: 1 })
    sc.state.log.push({ text: 'P 获得恶魔果实「橡胶果实」', turn: 1 })
    sc.state.log.push({ text: 'P 买下「谢尔兹镇」，花费 60', turn: 1 })
    sc.state.log.push({ text: 'P 资不抵债，宣告破产出局！', turn: 1 })
    for (let i = 0; i < 40; i++) sc.state.log.push({ text: `测试日志 ${i}`, turn: 1 })
    sc.refresh(); await wait(150)
    const r = {
      lines: sc.logLineObjs.length,
      contentH: Math.round(sc.logContentH),
      areaH: Math.round(area.h),
      pinnedGap: Math.round(bottomGap()),
      lastLineVisible: sc.logLineObjs[sc.state.log.length - 1].t.visible,
      // 最后一行底边应落在可视区底部附近
      lastLineBottom: Math.round(sc.logLineObjs[sc.state.log.length - 1].t.y + sc.logLines.y + sc.logLineObjs[sc.state.log.length - 1].t.height),
      areaBottom: Math.round(area.y + area.h),
      // 配色抽样：现行规则是「按玩家名着色」（与左栏卡片边框、棋盘岛主圆点同源），
      // 系统播报落回正文米色 —— 因此断言「三个玩家三种色 + 系统一条米色」
      colors: {
        p0: sc.logLineColor('路飞 买下「谢尔兹镇」，花费 60'),
        p1: sc.logLineColor('索隆 缴纳天上金 300 贝利'),
        p2: sc.logLineColor('娜美 获得恶魔果实「橡胶果实」'),
        sys: sc.logLineColor('· 对局开始，共 4 名玩家，每人 2000 贝利。')
      }
    }
    // 上翻 6 格：位置稳定 + 新消息浮标
    for (let i = 0; i < 6; i++) sc.scrollLog(-1)
    await wait(80)
    const yUp = sc.logLines.y
    for (let i = 0; i < 3; i++) sc.state.log.push({ text: `上翻期间的新消息 ${i}`, turn: 1 })
    sc.refresh(); await wait(150)
    r.stableWhileReading = Math.abs(sc.logLines.y - yUp) < 3
    r.newCount = sc.logNewCount
    r.chipVisible = sc.logNewChipBg.visible && /3 条新消息/.test(sc.logNewChipTxt.text)
    // 点浮标 → 回到最新
    sc.logNewChipBg.emit('pointerdown')
    await wait(120)
    r.backToBottom = bottomGap() < 3 && !sc.logNewChipBg.visible
    // 回到最新后再来一条，仍应跟随
    sc.state.log.push({ text: '回到最新后的一条', turn: 1 })
    sc.refresh(); await wait(150)
    r.followsAfterBack = bottomGap() < 3
    return r
  })

  const ok = !errors.length && !out.skipped && out.pinnedGap <= 3 && out.lastLineVisible
    && Math.abs(out.lastLineBottom - out.areaBottom) < 6
    && out.stableWhileReading && out.newCount === 3 && out.chipVisible
    && out.backToBottom && out.followsAfterBack
    && new Set([out.colors.p0, out.colors.p1, out.colors.p2]).size === 3
    && out.colors.sys === '#c4b494'
  console.log(JSON.stringify({ out, errors, ok }, null, 2))
  await page.screenshot({ path: '/tmp/log_pinned.png' })
  await browser.close()
  console.log(ok ? 'LOG CHECK PASS' : 'LOG CHECK FAIL')
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
