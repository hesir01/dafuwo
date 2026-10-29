// 验证：左栏玩家卡在「联机长昵称 / 有手牌 / 状态标签」下不越界、不重叠
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SIZES = [[1080, 610], [1280, 720], [1512, 760], [900, 540]]
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let fail = 0
  for (const [W, H] of SIZES) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
    await sleep(1600)
    await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
    await sleep(2200)
    const res = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('BoardScene')
      sc.online = true
      sc.mySeat = 0
      const names = ['甚平51', '路飞飞飞飞飞飞飞', '娜美', '山治']
      sc.state.players.forEach((pl, i) => { pl.name = names[i] })
      sc.state.players[0].inJail = true
      sc.state.players[0].hand = [{ kind: 'history' }, { kind: 'fruit', defId: 1 }]
      sc.state.players[1].islandIds = [1, 2, 3, 4, 5, 6]
      sc.state.players[1].frozen = 2
      sc.state.players[1].hand = []
      sc.state.players[2].hand = [{ kind: 'haki', defId: 1 }, { kind: 'history' }, { kind: 'fruit', defId: 2 }]
      sc.refresh()
      const bad = []
      sc.playerCards.forEach((c, i) => {
        const box = { l: c.cx - c.w / 2, r: c.cx + c.w / 2, t: c.cy - c.ch / 2, b: c.cy + c.ch / 2 }
        const checks = { name: c.nameTxt, cash: c.cashTxt, stat: c.statTxt }
        for (const [k, t] of Object.entries(checks)) {
          if (!t.visible) continue
          const b = t.getBounds()
          if (b.x < box.l - 1 || b.x + b.width > box.r + 1 || b.y < box.t - 1 || b.y + b.height > box.b + 1) {
            bad.push({ i, k, text: t.text, overL: Math.round(box.l - b.x), overR: Math.round(b.x + b.width - box.r), overB: Math.round(b.y + b.height - box.b) })
          }
        }
        // 名字必须单行且不与现金行重叠
        const nb = c.nameTxt.getBounds(), cb = c.cashTxt.getBounds()
        if (c.nameTxt.getWrappedText(c.nameTxt.text).length > 1) bad.push({ i, k: 'name-multiline', text: c.nameTxt.text })
        if (nb.y + nb.height > cb.y + 1) bad.push({ i, k: 'name-cash-overlap', text: c.nameTxt.text })
        if (c.badgeTxt && c.badgeTxt.visible) {
          const bb = c.badgeTxt.getBounds()
          if (bb.x < box.l - 1 || bb.x + bb.width > box.r + 1) bad.push({ i, k: 'badge', text: c.badgeTxt.text })
        }
      })
      return { bad, names: sc.playerCards.map((c) => c.nameTxt.text), stats: sc.playerCards.map((c) => c.statTxt.text) }
    })
    const ok = res.bad.length === 0
    if (!ok) { fail++; console.log(`${W}x${H} FAIL`, JSON.stringify(res.bad, null, 1)) } else console.log(`${W}x${H} PASS names=${JSON.stringify(res.names)} stats=${JSON.stringify(res.stats)}`)
    await page.close()
  }
  await browser.close()
  console.log(fail === 0 ? 'ALL PASS' : `${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
