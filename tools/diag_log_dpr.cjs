// 验证用户重写后的日志实现（逐行 Text + 几何遮罩 + 滚动 + 新消息浮标）
// 复现用户环境：1920x1152 视口 + DPR=2 Retina + ?canvas=1 强制 Canvas 渲染器
const { chromium } = require('playwright-core')

const URL = process.env.OP_URL || 'http://127.0.0.1:3000'

async function main() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  })
  const page = await (await browser.newContext({
    viewport: { width: 1920, height: 1152 },
    deviceScaleFactor: 2
  })).newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(URL + '?canvas=1', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await page.waitForTimeout(1500)

  const checks = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    if (!sc.logLines || !sc.logArea) {
      return { logBuilt: false, W: sc.W, H: sc.H }
    }
    const s = sc.state
    s.log.length = 0
    s.log.push({ turn: 1, text: '对局开始，共 4 名玩家，每人 2000 贝利。' })
    for (let i = 1; i <= 14; i++) {
      s.log.push({ turn: i, text: `路飞 掷出 ${i}+${i}=${i * 2} 点，移动到第 ${i} 格，「谢尔兹镇」过路费收入 200 贝利，这条日志特别长用来测试自动换行是否正常工作在 Retina 高分辨率画布环境下。` })
    }
    sc.refresh()

    const area = sc.logArea
    const first = sc.logLineObjs[0]
    const last = sc.logLineObjs[entriesLength() - 1]
    function entriesLength() { return s.log.length }

    // ① 遮罩存在且覆盖日志区
    const maskOk = !!sc.logMaskGfx

    // ② 最长行宽度不得超出遮罩右缘
    let maxLineW = 0
    for (const o of sc.logLineObjs) {
      if (o.active && o.t.width > maxLineW) maxLineW = o.t.width
    }
    const overflowX = maxLineW - (area.w - 2)

    // ③ 内容总高与滚动范围
    const maxScroll = Math.max(0, sc.logContentH - area.h)

    // ④ 贴底时最后一行必须在可视窗口内
    sc.logScroll = maxScroll
    sc.applyLogScroll()
    const lastTop = last.t.y + area.y - sc.logScroll
    const pinnedLastVisible = lastTop + last.t.height <= area.y + area.h + 1

    // ⑤ 上翻后：视窗外的行必须被隐藏（可见性剔除）。位置越界但 visible=false 是正常的
    // （遮罩+剔除双保险）；只有「位置在剔除缓冲区外仍 visible」才算真失效。
    let overflowY = false
    sc.logScroll = Math.max(0, maxScroll - 120)
    sc.applyLogScroll()
    for (const o of sc.logLineObjs) {
      if (!o.active) continue
      const top = o.t.y + area.y - sc.logScroll
      const bot = top + o.t.height
      if (bot > area.y + area.h + 20 && o.t.visible) overflowY = true
    }
    // 恢复贴底
    sc.logScroll = maxScroll
    sc.applyLogScroll()

    return {
      logBuilt: true,
      dpr: window.devicePixelRatio,
      rendererCanvas: !window.__game.renderer.gl,
      resolution: first.t.style.resolution,
      fontSize: first.t.style.fontSize,
      maskOk,
      maxLineW: Math.round(maxLineW),
      areaW: area.w,
      overflowX: overflowX > 0 ? Math.round(overflowX) : 0,
      logContentH: Math.round(sc.logContentH),
      areaH: Math.round(area.h),
      maxScroll: Math.round(maxScroll),
      pinnedLastVisible,
      overflowY,
      lineCount: sc.logLineObjs.filter(o => o.active).length
    }
  })
  console.log('CHECKS:', JSON.stringify(checks, null, 1))
  let fail = 0
  if (!checks.logBuilt) { console.error('FAIL: 日志区没构建'); fail = 1 }
  else {
    if (!checks.maskOk) { console.error('FAIL: 遮罩没建'); fail = 1 }
    if (checks.overflowX > 0) { console.error(`FAIL: 最长行超出遮罩 ${checks.overflowX}px`); fail = 1 }
    if (!checks.pinnedLastVisible) { console.error('FAIL: 贴底时最后一行不在可视窗口内'); fail = 1 }
    if (checks.overflowY) { applyLogScrollFail() }
  }
  function applyLogScrollFail() { console.error('FAIL: 行对象完整出现在遮罩外（可见性裁剪失效）'); fail = 1 }

  await page.screenshot({ path: '/tmp/op_ui/diag_dpr2.png' })
  await browser.close()
  if (fail) process.exit(1)
  console.log('ALL PASS')
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
