// 验证：中央骰面尺寸 / 骰子+点数牌不越界 / 名字单行不压骰子 / 点数牌可读
const { chromium } = require('playwright-core')
const fs = require('fs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SIZES = [[1080, 610], [1280, 720], [1512, 760], [900, 540]]
const OUT = '/tmp/dice_shots'
fs.mkdirSync(OUT, { recursive: true })
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let fail = 0
  for (const [W, H] of SIZES) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
    await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
    await sleep(1600)
    await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
    await sleep(2200)
    const res = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      sc.state.lastDice = { d1: 3, d2: 4, total: 7, isDoubles: false }
      sc._diceAnnounced = '3,4'   // 拦掉 refresh 里的自动掷骰动画，直接看定格态
      sc.refresh()
      const r = sc.centerRect
      const d1 = sc.centerDie1, d2 = sc.centerDie2, chip = sc.diceChipBox, tot = sc.diceTotalTxt
      const d1b = d1.getBounds(), d2b = d2.getBounds(), tb = tot.getBounds()
      const nb = sc.centerNameTxt.getBounds()
      const badge = sc.actionBannerBg.getBounds()
      const bad = []
      if (d1.displayWidth < 21) bad.push({ k: 'dice-small', v: d1.displayWidth })
      if (d1b.x < r.x - 0.5) bad.push({ k: 'die1-left', over: Math.round(r.x - d1b.x) })
      if (d2b.x + d2b.width > r.x + r.w + 0.5) bad.push({ k: 'die2-right', over: Math.round(d2b.x + d2b.width - (r.x + r.w)) })
      if (chip.x + chip.w > r.x + r.w + 0.5) bad.push({ k: 'chip-right', over: Math.round(chip.x + chip.w - (r.x + r.w)) })
      if (chip.y + chip.h > r.y + r.h + 0.5) bad.push({ k: 'chip-bottom', over: Math.round(chip.y + chip.h - (r.y + r.h)) })
      if (tb.x < chip.x - 0.5 || tb.x + tb.width > chip.x + chip.w + 0.5) bad.push({ k: 'total-out-of-chip' })
      if (sc.centerNameTxt.getWrappedText(sc.centerNameTxt.text).length > 1) bad.push({ k: 'name-multiline', t: sc.centerNameTxt.text })
      if (nb.y + nb.height > d1b.y + 0.5) bad.push({ k: 'name-dice-overlap' })
      if (nb.x + nb.width > r.x + r.w + 0.5) bad.push({ k: 'name-right' })
      if (badge.y + badge.height > r.y + r.h + 0.5) bad.push({ k: 'buttons-overflow', over: Math.round(badge.y + badge.height - (r.y + r.h)) })
      return {
        bad,
        ds: Math.round(d1.displayWidth),
        total: tot.text,
        chip: { w: Math.round(chip.w), h: Math.round(chip.h) },
        rect: { w: Math.round(r.w), h: Math.round(r.h) },
        colW: Math.round(sc.centerColW),
        name: sc.centerNameTxt.text,
        chipBottomGap: Math.round(r.y + r.h - (chip.y + chip.h))
      }
    })
    const ok = res.bad.length === 0
    if (!ok) fail++
    console.log(`${W}x${H} ${ok ? 'PASS' : 'FAIL'} ds=${res.ds} colW=${res.colW} chip=${res.chip.w}x${res.chip.h} total="${res.total}" rect=${res.rect.w}x${res.rect.h} gapBottom=${res.chipBottomGap}${ok ? '' : ' ' + JSON.stringify(res.bad)}`)
    const r = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      return { x: sc.centerRect.x, y: sc.centerRect.y, w: sc.centerRect.w, h: sc.centerRect.h }
    })
    await page.screenshot({ path: `${OUT}/${W}x${H}.png`, clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(W - Math.max(0, r.x - 8), r.w + 16), height: Math.min(H - Math.max(0, r.y - 8), r.h + 16) } })
    // 滚动中途截一帧：数字应在跳动（不 await，否则会等动画结束才返回）
    await page.evaluate(() => { window.__game.scene.getScene('BoardScene').animateDiceRoll(3, 4) })
    const samples = []
    for (let i = 0; i < 4; i++) {
      await sleep(110)
      samples.push(await page.evaluate(() => window.__game.scene.getScene('BoardScene').diceTotalTxt.text))
    }
    await page.screenshot({ path: `${OUT}/${W}x${H}_rolling.png`, clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(W - Math.max(0, r.x - 8), r.w + 16), height: Math.min(H - Math.max(0, r.y - 8), r.h + 16) } })
    await sleep(1200)
    const settle = await page.evaluate(() => window.__game.scene.getScene('BoardScene').diceTotalTxt.text)
    const aspect = await page.evaluate(() => {
      const d = window.__game.scene.getScene('BoardScene').centerDie1
      return { w: d.displayWidth, h: d.displayHeight, angle: d.angle, sx: d.scaleX, sy: d.scaleY }
    })
    const ratio = aspect.w / aspect.h
    if (Math.abs(ratio - 96 / 115) > 0.02) { fail++; console.log(`   aspect FAIL ${JSON.stringify(aspect)}`) }
    const rolling = samples.join(',')
    if (settle !== '7') { fail++; console.log(`   settle FAIL total=${settle}`) } else console.log(`   rolling=[${rolling}] → settle="${settle}"`)
    await page.close()
  }
  await browser.close()
  console.log(fail === 0 ? 'ALL PASS' : `${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
