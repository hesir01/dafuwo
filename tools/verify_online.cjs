// M3 联机全流程验证（双浏览器上下文）：建房 → 加入 → 选角 → 开局 → 多回合驱动
// → B 断线（服务器托管 AI）→ B 重连回对局。全部走真实 socket，断言两端状态一致。
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173/'

async function newClient(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/socket\.io|404/.test(m.text())) errs.push(`[${tag}] console: ${m.text()}`)
  })
  page.on('requestfailed', (r) => { if (!/socket\.io/.test(r.url())) errs.push(`[${tag}] reqfail: ${r.url()}`) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(2500)
  return { ctx, page, errs, tag }
}

// 在页面里跑：进大厅并建房
async function createRoom(page, name) {
  return page.evaluate(async (nm) => {
    const g = window.__game
    g.scene.start('LobbyScene')
    await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => {
      s.socket.emit('room:create', { name: nm }, (r) => {
        s.roomData = r.room
        localStorage.setItem('op_game_old_id', r.room.socketId || s.socket.id)
        s.rebuild()
        res({ code: r.room.code, socketId: s.socket.id })
      })
    })
  }, name)
}

async function joinRoom(page, code, name) {
  return page.evaluate(async ({ code, nm }) => {
    const g = window.__game
    g.scene.start('LobbyScene')
    await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => {
      s.socket.emit('room:join', { code, name: nm }, (r) => {
        if (!r.ok) return res({ error: r.error })
        s.roomData = r.room
        localStorage.setItem('op_game_old_id', r.socketId || s.socket.id)
        s.rebuild()
        res({ socketId: s.socket.id, players: r.room.players.length })
      })
    })
  }, { code, nm: name })
}

async function selectChar(page, charId) {
  return page.evaluate((id) => new Promise((res) => {
    const s = window.__game.scene.getScene('LobbyScene')
    s.socket.emit('player:selectChar', { charId: id }, (r) => res(r))
  }), charId)
}

async function startGame(page) {
  return page.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('LobbyScene')
    s.socket.emit('game:start', (r) => res(r))
  }))
}

// 只在轮到该客户端时行动：roll → 需要决策时 buy/decline → endTurn
async function takeTurnIfMine(page) {
  return page.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('BoardScene')
    if (!s || !s.state) return res({ skip: 'no board' })
    const mySeat = s.mySeat
    if (s.state.current !== mySeat) return res({ skip: 'not my turn', current: s.state.current, mySeat })
    const sock = s.socket
    // 带超时：服务器不回 ack 时不要卡死整个验证
    const emit = (ev, payload) => new Promise((r) => {
      const t = setTimeout(() => r({ ok: false, error: 'ack timeout' }), 4000)
      sock.emit(ev, payload, (res2) => { clearTimeout(t); r(res2 || { ok: false, error: 'no ack' }) })
    })
    ;(async () => {
      const out = []
      const r1 = await emit('game:roll')
      out.push(['roll', r1.ok, r1.error])
      // 落点需要决策就买/放弃（最多 3 次保险）
      for (let i = 0; i < 3; i++) {
        const st = window.__game.scene.getScene('BoardScene').state
        if (st.phase === 'awaitBuy') { const r = await emit('game:buy'); out.push(['buy', r.ok, r.error]); break }
        if (st.phase === 'awaitHistory') { const r = await emit('game:declineHistory'); out.push(['declineHistory', r.ok, r.error]); break }
        if (st.phase === 'awaitReroll') { const r = await emit('game:reroll', { reroll: false }); out.push(['reroll', r.ok, r.error]); continue }
        if (st.phase === 'awaitEventCancel') { const r = await emit('game:eventCancel', { cancel: false }); out.push(['eventCancel', r.ok, r.error]); continue }
        if (st.phase === 'awaitTarget') { const r = await emit('game:cancelTarget', {}); out.push(['cancelTarget', r.ok, r.error]); continue }
        break
      }
      const r2 = await emit('game:endTurn')
      out.push(['endTurn', r2.ok, r2.error])
      res({ acted: true, out })
    })()
  }))
}

async function snap(page) {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    if (!s || !s.state) return null
    return {
      current: s.state.current,
      turn: s.state.turn,
      cash: s.state.players.map((p) => p.cash),
      pos: s.state.players.map((p) => p.position),
      islands: s.state.players.map((p) => p.islandIds.length),
      phase: s.state.phase,
      mySeat: s.mySeat
    }
  })
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE })
  const A = await newClient(browser, 'A')
  const B = await newClient(browser, 'B')

  const room = await createRoom(A.page, '路飞')
  console.log('1. 建房:', room.code)
  const j = await joinRoom(B.page, room.code, '索隆')
  if (j.error) throw new Error('加入失败: ' + j.error)
  console.log('2. B 加入成功，房间人数:', j.players)

  const sa = await selectChar(A.page, 1)
  const sb = await selectChar(B.page, 2)
  console.log('3. 选角:', sa.ok, sb.ok)

  const st = await startGame(A.page)
  if (!st.ok) throw new Error('开局失败: ' + st.error)
  await sleep(1500)
  const boardA = await A.page.evaluate(() => window.__game.scene.isActive('BoardScene'))
  const boardB = await B.page.evaluate(() => window.__game.scene.isActive('BoardScene'))
  const seatA = await A.page.evaluate(() => window.__game.scene.getScene('BoardScene').mySeat)
  const seatB = await B.page.evaluate(() => window.__game.scene.getScene('BoardScene').mySeat)
  console.log('4. 开局: 两端都进棋盘 =', boardA, boardB, '| 座位 A/B =', seatA, seatB)

  // 5. 驱动 8 个回合：每轮让当前持有者行动，AI 座位由服务器自行推进
  let mismatches = 0
  for (let t = 0; t < 4; t++) {
    await takeTurnIfMine(A.page)
    await sleep(300)
    await takeTurnIfMine(B.page)
    await sleep(400)
    const a = await snap(A.page)
    const b = await snap(B.page)
    if (!a || !b) { console.log('   快照缺失', t); break }
    const strip = ({ mySeat, ...rest }) => rest
    const same = JSON.stringify(strip(a)) === JSON.stringify(strip(b))
    if (!same) mismatches++
    console.log(`   turn${t} phase=${a.phase} cur=${a.current} cash=${a.cash.join('/')} 两端一致=${same}`)
  }

  // 6. B 断线 → 服务器托管 AI → 重连回对局
  const beforeCut = await snap(A.page)
  await B.page.evaluate(() => window.__game.registry.get('socket').disconnect())
  await sleep(1200)
  const afterCut = await snap(A.page)
  console.log('5. B 断线后 A 端仍在棋盘，phase =', afterCut && afterCut.phase)

  await B.page.reload({ waitUntil: 'networkidle' })
  await new Promise((r) => setTimeout(r, 3000))
  await B.page.evaluate(() => { window.__game.scene.start('LobbyScene') })
  await sleep(2000)
  const rejoined = await B.page.evaluate(() => ({
    board: window.__game.scene.isActive('BoardScene'),
    lobby: window.__game.scene.isActive('LobbyScene'),
    roomCode: (window.__game.scene.getScene('LobbyScene').roomData || {}).code || null
  }))
  console.log('6. B 刷新后重连:', JSON.stringify(rejoined), '（房间号应为', room.code, '）')
  await sleep(1500)
  const afterRejoin = await snap(B.page)
  console.log('   重连后 B 端状态:', JSON.stringify(afterRejoin))

  const errs = [...A.errs, ...B.errs]
  console.log('---')
  console.log('状态不一致次数:', mismatches)
  console.log('错误数:', errs.length, errs.slice(0, 8))
  await browser.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
