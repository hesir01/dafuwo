// 滚动日志回归（适配逐行渲染实现）：填充大量日志 → 断言滚动/贴底/跟随/新消息浮标 → 截图
const { chromium } = require('playwright-core')

const URL = process.env.OP_URL || 'http://127.0.0.1:3000'

async function main() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 860 } })).newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await page.waitForTimeout(1000)

  let fail = 0
  const assert = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) fail = 1 }

  // ---- 填 40 条超区日志，断言初始贴底 ----
  const r1 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    window.__baseLog = s.log.length        // 场景开局可能自带初始日志，记基线
    window.__baseLines = sc.logLineObjs.filter(o => o.active).length
    for (let i = 1; i <= 40; i++) s.log.push({ turn: 1, text: `历史事件 #${i}：路飞掷出 6+3 前进 9 格` })
    sc.refresh()
    const maxScroll = Math.max(0, sc.logContentH - sc.logArea.h)
    return {
      built: !!sc.logLines && !!sc.logArea,
      lineDelta: sc.logLineObjs.filter(o => o.active).length - window.__baseLines,
      contentH: sc.logContentH,
      areaH: sc.logArea.h,
      overflow: sc.logContentH > sc.logArea.h,
      pinnedInitial: sc.logPinned,
      atBottomInitial: Math.abs(sc.logScroll - maxScroll) <= 1
    }
  })
  assert('日志区构建', r1.built)
  assert('40 条日志逐行渲染', r1.lineDelta === 40)
  assert('内容超出可视区（可滚）', r1.overflow)
  assert('初始贴底（最新）', r1.pinnedInitial && r1.atBottomInitial)

  // ---- 上翻 4 次（滚轮向上 dy<0 = 翻历史）----
  const r2 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.scrollLog(-1); sc.scrollLog(-1); sc.scrollLog(-1); sc.scrollLog(-1)
    const maxScroll = Math.max(0, sc.logContentH - sc.logArea.h)
    return { moved: sc.logScroll < maxScroll - 1, unpinned: !sc.logPinned, thumbLifted: sc.logScrollThumb.y < sc.logScrollTrack.y + sc.logScrollTrack.height / 2 - 1 }
  })
  assert('上翻解除贴底且位置移动', r2.moved && r2.unpinned)
  assert('滚动条滑块上移', r2.thumbLifted)

  // ---- 上翻状态下来新消息：不跟随 + 浮标计数 ----
  const r3 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const before = sc.logScroll
    const n0 = sc.logLineObjs.filter(o => o.active).length
    s.log.push({ turn: 1, text: '最新事件：索隆购买了一座岛屿' })
    s.log.push({ turn: 1, text: '最新事件2：娜美到达港口' })
    sc.refresh()
    const objs = sc.logLineObjs.filter(o => o.active)
    return {
      stayed: sc.logScroll === before,            // 视线不被拽走
      chipShown: sc.logNewChipBg.visible,          // 浮标出现
      chipCount: sc.logNewCount,                   // 计 2 条
      lastLineUpdated: objs[objs.length - 1].t.text.includes('娜美到达港口'),
      countDelta: objs.length - n0
    }
  })
  assert('上翻时新消息不拽走视线', r3.stayed)
  assert('新消息浮标出现且计数=2', r3.chipShown && r3.chipCount === 2)
  assert('新行已渲染', r3.countDelta === 2 && r3.lastLineUpdated)

  // ---- 点浮标跳回最新 + 恢复贴底 ----
  const r4 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.logNewChipBg.emit('pointerdown')
    const maxScroll = Math.max(0, sc.logContentH - sc.logArea.h)
    return { backToBottom: Math.abs(sc.logScroll - maxScroll) <= 1, repinned: sc.logPinned, chipHidden: !sc.logNewChipBg.visible }
  })
  assert('点浮标跳回最新', r4.backToBottom && r4.repinned)
  assert('浮标消失', r4.chipHidden)

  // ---- 滚到底后再来新消息：自动跟随 ----
  const r5 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    const maxScrollBefore = Math.max(0, sc.logContentH - sc.logArea.h)
    s.log.push({ turn: 1, text: '跟随测试：山治使用了技能' })
    sc.refresh()
    const maxScrollAfter = Math.max(0, sc.logContentH - sc.logArea.h)
    return { followed: Math.abs(sc.logScroll - maxScrollAfter) <= 1 && maxScrollAfter >= maxScrollBefore, pinned: sc.logPinned }
  })
  assert('贴底时新消息自动跟随', r5.followed && r5.pinned)

  // ---- 上翻状态截图 ----
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.scrollLog(-1); sc.scrollLog(-1); sc.scrollLog(-1); sc.scrollLog(-1); sc.scrollLog(-1)
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/op_ui/4_log_scroll.png' })
  await browser.close()

  console.log(fail ? 'SOME FAIL' : 'ALL PASS')
  process.exit(fail)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
