// 验证：高分屏（DPR>1）下画布按设备像素渲染、铺满视口、点击坐标仍然准确
// 背景：Phaser 的 RESIZE 模式默认把画布背衬缓冲设成 CSS 像素，Retina 上被浏览器
// 拉伸 2 倍显示 → 整屏发糊；不同电脑（dpr 1 / 2）观感差一截。
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CASES = [
  [960, 533, 2],
  [1280, 720, 1],
  [1280, 720, 2],
  [1512, 760, 2]
]

// 页面底色 #1a1a2e；画布没铺满时，剩下的区域会大面积是它
const BG = [26, 26, 46]

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let fail = 0

  for (const [W, H, dpr] of CASES) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr })
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
    await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
    await sleep(2000)
    await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
    await sleep(2400)

    const geo = await page.evaluate(() => {
      const g = window.__game
      const c = g.canvas
      const css = { w: g.scale.width, h: g.scale.height }
      return {
        dpr: window.devicePixelRatio,
        canvas: [c.width, c.height],
        expect: [Math.round(css.w * window.devicePixelRatio), Math.round(css.h * window.devicePixelRatio)],
        css: [c.style.width, c.style.height],
        scale: [css.w, css.h],
        rect: (() => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })(),
        renderScale: window.__renderScale || 1,
        cards: g.scene.getScene('BoardScene').playerCards.map((p) => [Math.round(p.cx), Math.round(p.cy)])
      }
    })

    // 1) 画布背衬缓冲 == CSS 尺寸 × DPR（dpr=1 时等于 CSS 尺寸）
    const sizeOk = geo.canvas[0] === geo.expect[0] && geo.canvas[1] === geo.expect[1]
    // 2) CSS 显示尺寸 == 逻辑尺寸（浏览器不做二次缩放）
    const cssOk = geo.rect[0] === geo.scale[0] && geo.rect[1] === geo.scale[1]

    // 3) 画面是否铺满：统计等于页面底色的像素占比
    const shot = await page.screenshot()
    const b64 = shot.toString('base64')
    const cover = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const ctx = cv.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height)
      let bg = 0
      const total = data.length / 4
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - 26) <= 2 && Math.abs(data[i + 1] - 26) <= 2 && Math.abs(data[i + 2] - 46) <= 2) bg++
      }
      return { ratio: bg / total, w: cv.width, h: cv.height }
    }, b64)
    const coverOk = cover.ratio < 0.01

    // 4) 点击命中：点第二张玩家卡应打开档案（坐标换算不受背衬尺寸影响）
    const target = geo.cards[1]
    await page.mouse.click(target[0], target[1])
    await sleep(500)
    const clickOk = await page.evaluate(() => !!window.__game.scene.getScene('BoardScene').customPanel)

    const ok = sizeOk && cssOk && coverOk && clickOk && errs.length === 0
    if (!ok) fail++
    console.log(
      `${W}x${H}@${dpr}x 画布=${geo.canvas.join('×')}(期望 ${geo.expect.join('×')}) ` +
      `CSS=${geo.rect.join('×')} 渲染=${geo.renderScale}x 页面底色占比=${(cover.ratio * 100).toFixed(2)}% ` +
      `点击=${clickOk ? 'OK' : 'NG'} ${ok ? 'PASS' : 'FAIL'}`
    )
    if (!ok) console.log('  详情', JSON.stringify({ geo, cover, errs }))
    await page.screenshot({ path: `/tmp/hidpi_${W}x${H}_${dpr}x.png` })
    await page.close()
  }

  await browser.close()
  console.log(fail === 0 ? 'ALL PASS' : `${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
