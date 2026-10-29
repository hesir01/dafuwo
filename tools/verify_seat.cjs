// 座位感知验证：联机时非当前玩家的「改变对局」按钮必须置灰，且 act() 不再往服务器发无效请求
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await sleep(2400)
    return page
  }
  const A = await mk(); const B = await mk()
  const code = await A.evaluate(async () => {
    const g = window.__game; g.scene.start('LobbyScene')
    await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => s.socket.emit('room:create', { name: 'A' }, (r) => {
      s.roomData = r.room; localStorage.setItem('op_game_old_id', r.room.socketId || s.socket.id); s.rebuild(); res(r.room.code)
    }))
  })
  await B.evaluate(async (c) => {
    const g = window.__game; g.scene.start('LobbyScene')
    await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => s.socket.emit('room:join', { code: c, name: 'B' }, (r) => {
      s.roomData = r.room; localStorage.setItem('op_game_old_id', r.socketId || s.socket.id); s.rebuild(); res()
    }))
  }, code)
  await A.evaluate(() => new Promise((r) => window.__game.scene.getScene('LobbyScene').socket.emit('player:selectChar', { charId: 1 }, r)))
  await B.evaluate(() => new Promise((r) => window.__game.scene.getScene('LobbyScene').socket.emit('player:selectChar', { charId: 2 }, r)))
  await A.evaluate(() => new Promise((r) => window.__game.scene.getScene('LobbyScene').socket.emit('game:start', r)))
  await sleep(1800)

  const probe = (page) => page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    const g = (b) => (b ? { on: b.enabled } : null)
    return {
      mySeat: s.mySeat, current: s.state.current, phase: s.state.phase,
      roll: g(s.btnRoll), buy: g(s.btnBuy), end: g(s.btnEnd), skill: g(s.btnSkill),
      turnTxt: s.turnTxt.text
    }
  })
  await A.screenshot({ path: '.playwright-cli/seat-A-mine.png' })
  await B.screenshot({ path: '.playwright-cli/seat-B-watch.png' })
  const a = await probe(A); const b = await probe(B)
  console.log('A(座位0):', JSON.stringify(a))
  console.log('B(座位1):', JSON.stringify(b))
  const cur = a.current
  const ownerExpected = cur === a.mySeat ? a : b
  const otherExpected = cur === a.mySeat ? b : a
  console.log('当前回合方 掷骰按钮可用 =', ownerExpected.roll.on, '（应为 true）')
  console.log('非回合方   掷骰按钮可用 =', otherExpected.roll.on, '（应为 false）')
  console.log('回合方标题:', ownerExpected.turnTxt, '| 非回合方标题:', otherExpected.turnTxt)
  await browser.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
