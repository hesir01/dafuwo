// 回归四项修复：2人房开局 / 选角生效(AI 用实际角色名) / 离船不回棋盘 / 在线状态
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await sleep(2400)
    return page
  }
  const A = await mk(); const B = await mk()
  const lobby = (page) => page.evaluate(() => { window.__game.scene.start('LobbyScene'); })

  // A 建 2 人房
  await lobby(A); await sleep(800)
  const code = await A.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('LobbyScene')
    s.hostSize = 2
    s.socket.emit('room:create', { name: '剑士', maxPlayers: 2 }, (r) => {
      s.roomData = r.room; localStorage.setItem('op_game_old_id', r.room.socketId || s.socket.id); s.rebuild()
      res({ code: r.room.code, max: r.room.maxPlayers })
    })
  }))
  console.log('1. 建房:', JSON.stringify(code))

  // B 加入
  await lobby(B); await sleep(800)
  await B.evaluate((c) => new Promise((res) => {
    const s = window.__game.scene.getScene('LobbyScene')
    s.socket.emit('room:join', { code: c, name: '航海士' }, (r) => {
      s.roomData = r.room; localStorage.setItem('op_game_old_id', r.socketId || s.socket.id); s.rebuild(); res(r.ok)
    })
  }), code.code)
  await sleep(600)
  const roster = await A.evaluate(() => window.__game.scene.getScene('LobbyScene').roomData.players.map(p => `${p.name}${p.isYou ? '(你)' : ''}`).join(','))
  console.log('2. 房间玩家:', roster)

  // 双方选角 + 房主开局（2 人房，不补 AI）
  await A.evaluate(() => new Promise((r) => window.__game.scene.getScene('LobbyScene').socket.emit('player:selectChar', { charId: 2 }, r)))   // 索隆
  await B.evaluate(() => new Promise((r) => window.__game.scene.getScene('LobbyScene').socket.emit('player:selectChar', { charId: 3 }, r))) // 娜美
  await sleep(500)
  const startRes = await A.evaluate(() => new Promise((r) => window.__game.scene.getScene('LobbyScene').socket.emit('game:start', r)))
  console.log('3. 2人开局:', JSON.stringify(startRes))
  await sleep(1500)
  const names = await A.evaluate(() => window.__game.scene.getScene('BoardScene').state.players.map(p => `${p.name}(${p.charId})`).join(','))
  console.log('4. 对局玩家名单（AI 应用角色名）:', names)

  // A 离船 → 应留在大厅，不被拽回棋盘
  await A.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    s.openQuitConfirm()
  })
  await sleep(400)
  await A.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    const btns = s._quitLayer.list.filter((c) => c.list && c.input)
    btns[0].emit('pointerdown') // 返回大厅
  })
  await sleep(2500)
  const afterQuit = await A.evaluate(() => ({
    board: window.__game.scene.isActive('BoardScene'),
    lobby: window.__game.scene.isActive('LobbyScene')
  }))
  console.log('5. A 离船 2.5s 后:', JSON.stringify(afterQuit), '（board 应为 false）')

  // B 端应看到 A 离线（AI 接管），游戏继续
  const bView = await B.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    return { board: window.__game.scene.isActive('BoardScene'), current: s.state.current, players: s.state.players.length }
  })
  console.log('6. B 端继续对局:', JSON.stringify(bView))
  await browser.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
