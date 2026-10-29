const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const p = await b.newPage({ viewport: { width: 1080, height: 610 }, deviceScaleFactor: 2 })
  await p.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(1600)
  await p.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2200)
  const geo = await p.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    // 模拟联机：长昵称 + 进城状态
    sc.online = true
    sc.mySeat = 0
    const names = ['甚平51', '路飞飞飞飞飞', '娜美']
    sc.state.players.forEach((pl, i) => { pl.name = names[i] || pl.name })
    sc.state.players[0].inJail = true
    sc.state.players[1].islandIds = [1, 2, 3, 4, 5, 6]
    sc.state.players[1].frozen = 2
    sc.refresh()
    const out = []
    sc.playerCards.forEach((c, i) => {
      const nb = c.nameTxt.getBounds()
      const cb = c.cashTxt.getBounds()
      const sb = c.statTxt.getBounds()
      const cardTop = c.cy - c.ch / 2, cardBottom = c.cy + c.ch / 2
      out.push({
        i, name: c.nameTxt.text, nameFs: c.nameTxt.style.fontSize,
        nameH: Math.round(nb.height), overlapCash: nb.y + nb.height > cb.y + 1,
        stat: c.statTxt.text, statFs: c.statTxt.style.fontSize,
        statInside: sb.y + sb.height <= cardBottom + 1 && sb.y >= cardTop,
        statBottomOver: Math.round(sb.y + sb.height - cardBottom)
      })
    })
    return out
  })
  console.log(JSON.stringify(geo, null, 1))
  await p.screenshot({ path: '/tmp/card_longname.png' })
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
