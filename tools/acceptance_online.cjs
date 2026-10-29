// ============================================================
// 联机规则真机验收（真实 Socket.IO 连接，本地或线上 server）
// 依据 PRD §7（交易）/ §8（联机、权威、托管、断线）
// 用法：
//   本地：node server/index.js 后  node tools/acceptance_online.cjs
//   线上：OP_URL=http://43.128.149.78:8010 node tools/acceptance_online.cjs
// 说明：
//   1. 每个用例都用真实网络请求，不做任何进程内 mock。
//   2. 监听器一律在触发动作之前挂好，避免漏收广播。
//   3. 每节使用独立房间，避免上一节的状态污染下一节。
// ============================================================
const { io } = require('socket.io-client')

const URL = process.env.OP_URL || 'http://localhost:3000'
let pass = 0, fail = 0
const failures = []
const notes = []
function note(ref, msg) {
  notes.push(`[${ref}] ${msg}`)
  console.log(`  · [${ref}] ${msg}`)
}
function ok(cond, ref, msg, detail = '') {
  if (cond) { pass++; console.log(`  ✓ [${ref}] ${msg}`) }
  else { fail++; failures.push(`[${ref}] ${msg}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ [${ref}] ${msg}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const all = []
function connect(tag) {
  return new Promise((res, rej) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false })
    s.tag = tag
    s.__state = null
    s.on('game:state', (st) => { s.__state = st })
    s.on('connect', () => { all.push(s); res(s) })
    s.on('connect_error', rej)
    setTimeout(() => rej(new Error('connect timeout ' + tag)), 6000)
  })
}
function emit(s, ev, payload = {}, ms = 4000) {
  return new Promise((r) => {
    const t = setTimeout(() => r({ __timeout: true }), ms)
    s.emit(ev, payload, (res) => { clearTimeout(t); r(res || {}) })
  })
}
// 先挂监听再触发：返回 Promise，超时得到 null
function watch(s, ev, ms = 3000) {
  let resolve
  const h = (v) => { clearTimeout(t); s.off(ev, h); resolve(v) }
  const t = setTimeout(() => { s.off(ev, h); resolve(null) }, ms)
  const p = new Promise((r) => { resolve = r })
  s.on(ev, h)
  return p
}
async function seatAll(sockets) {
  for (let i = 0; i < sockets.length; i++) {
    const r = await emit(sockets[i], 'player:selectChar', { charId: i + 1 })
    if (!r.ok) return r
  }
  return { ok: true }
}
// 建房 + 加入 + 选角 + 开局，返回 { code, ok, error, state, seats }
// seats[i] 是 sockets[i] 的座位号（必须在 game:start 之前挂监听）
async function bootGame(sockets, maxPlayers = 2) {
  const r = await emit(sockets[0], 'room:create', { maxPlayers })
  if (!r.ok) return { ok: false, error: r.error || '建房失败' }
  for (let i = 1; i < sockets.length; i++) await emit(sockets[i], 'room:join', { code: r.room.code })
  await seatAll(sockets)
  const seatPs = sockets.map((s) => watch(s, 'game:seat', 2500))
  const stP = watch(sockets[0], 'game:state', 2500)
  const start = await emit(sockets[0], 'game:start', {})
  const state = start.ok ? await stP : null
  const seats = start.ok ? await Promise.all(seatPs) : []
  return { code: r.room.code, ok: start.ok, error: start.error, state, seats }
}
// 当前行动者的 socket（用于必须「轮到自己」才能发的指令）
function actorOf(g, sockets) {
  if (!g.state) return null
  const i = g.seats.findIndex((s) => s === g.state.current)
  return i < 0 ? null : sockets[i]
}
// 迷你机器人：把当前回合走完（掷骰 → 放弃购买 → 结束回合），决策弹窗一律选最保守项。
// 用于验证「服务端驱动的回合循环」与「断线后 AI 接管能继续推进对局」。
async function finishTurn(sock, mySeat, budget = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    const s = sock.__state
    if (!s) { await sleep(80); continue }
    if (s.phase === 'ended' || s.gameOver) return 'ended'
    if (s.current !== mySeat) return 'passed'
    if (s.phase === 'awaitRoll') await emit(sock, 'game:roll')
    else if (s.phase === 'awaitBuy') await emit(sock, 'game:decline')
    else if (s.phase === 'awaitBuyHistory') await emit(sock, 'game:declineHistory')
    else if (s.phase === 'awaitAction') await emit(sock, 'game:endTurn')
    else if (s.phase === 'awaitTarget') await emit(sock, 'game:cancelTarget')
    else if (s.modal && s.modal.type === 'observationCancel') await emit(sock, 'game:eventCancel', { cancel: true })
    else if (s.modal && s.modal.type === 'preview') await emit(sock, 'game:reroll', { reroll: false })
    else if (s.modal && s.modal.type === 'trade') await emit(sock, 'game:trade', { accept: false })
    else if (s.modal && s.modal.type === 'flowerEvent') await emit(sock, 'game:flowerEvent', { accept: false })
    else await sleep(120)
    await sleep(140)
  }
  return 'timeout'
}

;(async () => {
  const A = await connect('A')
  const B = await connect('B')
  const C = await connect('C')

  // ---------------- 1. 房间流程 ----------------
  console.log('\n=== 1. 房间流程（PRD §8.1）===')
  const room = await emit(A, 'room:create', { maxPlayers: 2 })
  ok(room.ok && /^\d{6}$/.test(room.room.code), '§8.1', `创建房间生成 6 位数字房号（${room.room && room.room.code}）`)
  const join = await emit(B, 'room:join', { code: room.room.code })
  ok(join.ok && join.room.players.length === 2, '§8.1', '第二名玩家可用房号加入')
  ok(join.room.players.every((p) => p.charName === null), '§8.1', '未选角时 charName 为 null（大厅回落座位号，不再有自定义昵称）')
  const overfill = await emit(C, 'room:join', { code: room.room.code })
  ok(!overfill.ok, '§8.1', `满员房间不能再加入（实际 ${overfill.ok ? '第 3 人被塞进 2 人房' : '被拒：' + overfill.error}）`)
  const badCode = await emit(C, 'room:join', { code: '000000' })
  ok(!badCode.ok, '§8.1', `不存在的房号应被拒绝（实际 ${badCode.ok ? '成功' : '拒绝'}）`)

  // ---------------- 2. 开局条件与随机先手 ----------------
  console.log('\n=== 2. 开局条件与先后手（PRD §8.4）===')
  const soloRoom = await emit(C, 'room:create', { maxPlayers: 2 })
  await emit(C, 'player:selectChar', { charId: 4 })
  const soloStart = await emit(C, 'game:start', {})
  ok(!soloStart.ok, '§8.4', `满 2 人才可开局：单人房应被拒绝（实际 ${soloStart.ok ? '单人开局成功' : '拒绝：' + soloStart.error}）`)

  const g2 = await bootGame([A, B], 2)
  ok(g2.ok && g2.state && g2.state.players.length === 2, '§8.1', '两人选角后房主可开局，双方收到对局状态')
  const nameOk = g2.state.players.every((p) => typeof p.name === 'string' && p.name.length > 0 && !/^玩家\d+$/.test(p.name))
  ok(nameOk, '§8.1', `对局内玩家名一律取所选角色名（${g2.state.players.map((p) => p.name).join(' / ')}）`)
  ok(g2.seats[0] === 0 && g2.seats[1] === 1, '§8.4', `服务器按座位单点下发座位号（A=${g2.seats[0]}, B=${g2.seats[1]}）`)
  const firsts = new Set([g2.state.current])
  for (let i = 0; i < 7; i++) {
    const g = await bootGame([A, B], 2)
    if (g.state) firsts.add(g.state.current)
    await sleep(80)
  }
  ok(firsts.size > 1, '§8.4', `先后手由服务器随机决定（8 局首手座位集合：${[...firsts].join(',')}）`)

  // ---------------- 3. 服务器权威：骰子 ----------------
  console.log('\n=== 3. 服务器权威（PRD §8.2）===')
  const g3 = await bootGame([A, B], 2)
  ok(g3.ok && !!g3.state, '§8.2', '对局已建立')
  const actor3 = actorOf(g3, [A, B])
  const seat3 = g3.state.current
  const stP3 = watch(A, 'game:state')
  // 伪造骰面 + 伪造落点（198 % 40 = 38，正常骰点 2~12 永远到不了 38）
  const rollRes = await emit(actor3, 'game:roll', { d1: 99, d2: 99, total: 198, force: 198 })
  const afterRoll = await stP3
  ok(rollRes.ok && !!afterRoll, '§8.2', `行动者的掷骰请求由服务器受理并广播新状态（${JSON.stringify(rollRes)}）`)
  const d = afterRoll && afterRoll.lastDice
  ok(d && d.d1 >= 1 && d.d1 <= 6 && d.d2 >= 1 && d.d2 <= 6,
    '§8.2', `客户端伪造 d1=99/d2=99 被忽略，服务端自行掷出 ${d ? d.d1 + '+' + d.d2 + '=' + d.total : 'null'}`)
  ok(afterRoll && afterRoll.players[seat3].position !== 38,
    '§8.2', `客户端伪造 total=198 被忽略（落点 ${afterRoll ? afterRoll.players[seat3].position : '?'}，伪造落点应为 38）`)
  ok(afterRoll && afterRoll.current === seat3 && afterRoll.phase !== 'awaitRoll',
    '§8.2', `掷骰后阶段由服务端推进（phase=${afterRoll ? afterRoll.phase : '?'}），客户端不能自选阶段`)

  // ---------------- 4. 交易权限与价格校验 ----------------
  console.log('\n=== 4. 交易权限与价格校验（PRD §7）===')
  const g4 = await bootGame([A, B], 2)
  ok(g4.ok, '§7', '对局已建立')
  const actor4 = actorOf(g4, [A, B])
  const other4 = actor4 === A ? B : A
  const noCard = await emit(actor4, 'game:tradePropose', { targetId: 1 - g4.state.current, historyId: 1, price: 500, direction: 'buy' })
  ok(!noCard.ok && noCard.error !== '还没轮到你',
    '§7', `没有该历史正文时不能发起交易（实际 ${noCard.ok ? '成功发起' : '拒绝：' + noCard.error}）`)
  const strPrice = await emit(actor4, 'game:tradePropose', { targetId: 1 - g4.state.current, historyId: 1, price: 'abc', direction: 'buy' })
  ok(!strPrice.ok && strPrice.error !== '还没轮到你',
    '§7', `交易价格非整数应被拒绝（实际 ${strPrice.ok ? '接受' : '拒绝：' + strPrice.error}）`)
  // 关键权限模型：被交易方的指令必须能进入决策通道（不被「还没轮到你」拦死）
  const otherDecide = await emit(other4, 'game:trade', { accept: true })
  ok(otherDecide.error !== '还没轮到你',
    '§7', `非当前行动者（被交易方）可以进入交易决策通道（返回：${otherDecide.error || '成交'}）`)
  ok(!otherDecide.ok, '§7', `没有待处理交易时被交易方点击不产生成交（实际 ${otherDecide.ok ? '凭空成交' : '拒绝'}）`)
  const selfDecide = await emit(actor4, 'game:trade', { accept: true })
  ok(!selfDecide.ok, '§7', `发起方不能单方面确认交易（实际 ${selfDecide.ok ? '自买自卖成功' : '被拒：' + selfDecide.error}）`)

  // ---------------- 5. 对局中重开 ----------------
  console.log('\n=== 5. 对局中重开（PRD §8.2）===')
  const beforeTurn = g4.state.turn
  const restart = await emit(A, 'game:start', {})
  ok(!restart.ok, '§8.2', `开局后房主不能再次触发 game:start（实际 ${restart.ok ? '整局被重置' : '被拒：' + restart.error}）`)
  await sleep(200)
  ok(A.__state && A.__state.turn === g4.state.turn, '§8.2', `对局没有被重置（回合数仍为 ${A.__state && A.__state.turn}，开局时应为 ${beforeTurn}）`)

  // ---------------- 6. 手牌信息可见性 ----------------
  console.log('\n=== 6. 手牌信息可见性（观察项）===')
  const handsVisible = !!(g4.state && g4.state.players.some((p) => Array.isArray(p.hand)))
  if (handsVisible) {
    note('§8.2', 'game:state 全量广播 room.state：对手手牌（果实/霸气/历史正文 uid）对其他客户端可见。'
      + 'PRD 未禁止（历史正文可交易、发起交易需指定 historyId），但果实/霸气属于隐藏信息，建议按座位裁剪。')
  } else {
    ok(true, '§8.2', '对手手牌已按座位裁剪')
  }

  // ---------------- 7. 回合循环与断线托管 ----------------
  console.log('\n=== 7. 回合循环与断线托管（PRD §8.2 / §8.3）===')
  const G = await connect('G')
  const H = await connect('H')
  const g7 = await bootGame([G, H], 2)
  ok(g7.ok && !!g7.state, '§8.3', '对局已建立')
  await sleep(200)
  const actorIdx7 = g7.seats.findIndex((s) => s === g7.state.current)
  const actor7 = actorIdx7 === 0 ? G : H
  const idle7 = actorIdx7 === 0 ? H : G
  const idleSeat7 = g7.seats[actorIdx7 === 0 ? 1 : 0]
  const r7 = await finishTurn(actor7, g7.state.current)
  ok(r7 === 'passed' || r7 === 'ended', '§8.2', `一个完整回合可在服务端跑通（掷骰→放弃购买→结束回合，结果 ${r7}）`)
  ok(idle7.__state && idle7.__state.current === idleSeat7, '§8.2', `回合结束后行动权交到对手（current=${idle7.__state && idle7.__state.current}）`)
  // 断线：轮到谁就把谁断开，验证 AI 接手后对局继续推进
  const before = idle7.__state ? { current: idle7.__state.current, turn: idle7.__state.turn } : null
  idle7.close()
  let after7 = actor7.__state
  let progressed = false
  for (let i = 0; i < 60; i++) {
    await sleep(300)
    after7 = actor7.__state
    if (after7 && (after7.current !== (before && before.current) || after7.turn !== (before && before.turn) || after7.phase === 'ended')) {
      progressed = true
      break
    }
  }
  ok(progressed, '§8.3', `玩家断线后由 AI 接管并继续推进对局（断线前 current=${before && before.current}/turn=${before && before.turn}，接管后 current=${after7 && after7.current}/turn=${after7 && after7.turn}）`,
    '断线座位未被 AI 接管，对局会卡死在等该玩家操作')

  // ---------------- 8. 聊天与快捷互动 ----------------
  console.log('\n=== 8. 聊天与快捷互动（PRD §8.1）===')
  const g8 = await bootGame([A, B], 2)
  const chatWatch = watch(B, 'chat:message')
  const c1 = await emit(A, 'chat:send', { kind: 'text', value: '起航！' })
  const c2 = await emit(A, 'chat:send', { kind: 'text', value: '再来一条' })
  const got = await chatWatch
  ok(c1.ok && got && got.value === '起航！', '§8.1', `文本聊天可送达同房玩家（收到「${got && got.value}」）`)
  ok(!c2.ok, '§8.1', `同一连接 700ms 内连发被频控（实际 ${c2.ok ? '两条都通过' : '拒绝：' + c2.error}）`)
  ok(got && typeof got.name === 'string' && !/^玩家\d+$/.test(got.name), '§8.1', `聊天显示角色名而非自定义昵称（${got && got.name}）`)

  // ---------------- 9. 异常指令容错 ----------------
  console.log('\n=== 9. 异常指令容错（PRD §10 稳定性）===')
  const D = await connect('D')
  const DseatP = watch(D, 'game:seat', 2500)
  const BseatP = watch(B, 'game:seat', 2500)
  const g9r = await emit(D, 'room:create', { maxPlayers: 2 })
  await emit(B, 'room:join', { code: g9r.room.code })
  await emit(D, 'player:selectChar', { charId: 5 })
  await emit(B, 'player:selectChar', { charId: 6 })
  await emit(D, 'game:start', {})
  const dSeat = await DseatP
  const bSeat = await BseatP
  await sleep(300)
  // 决策类指令只在「轮到自己」时才会进到引擎的决策函数里，
  // 所以先把回合推到 D 手上，再发无前置状态的决策指令。
  if (D.__state && D.__state.current !== dSeat) await finishTurn(B, bSeat)
  ok(!!D.__state && D.__state.current === dSeat, '§10', `已把行动权推到探测用连接上（current=${D.__state && D.__state.current}）`)
  await emit(D, 'game:trade', { accept: true })          // 无 modal
  await emit(D, 'game:eventCancel', { cancel: true })    // 无 modal
  await emit(D, 'game:confirmTarget', { targetId: 99 })  // 无 pending
  await emit(D, 'game:buyHistory', {})                   // 无 pending
  await emit(D, 'game:reroll', { reroll: true })         // 无 pending
  await emit(D, 'game:flowerEvent', { accept: true })    // 无 modal
  await sleep(400)
  const probe = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false })
  const alive = await new Promise((res) => {
    probe.on('connect', () => res(true)); probe.on('connect_error', () => res(false))
    setTimeout(() => res(false), 3000)
  })
  ok(alive, '§10', `连续发送无前置状态的决策指令后服务端仍存活（${alive ? '可建立新连接' : '进程已崩溃'}）`,
    '缺 try/catch 与 modal 守卫：任意玩家可让 Node 进程退出，全部房间丢失')
  probe.close()

  // ---------------- 10. 座位安全与重连（放最后，避免污染前面用例） ----------------
  console.log('\n=== 10. 座位安全与重连（PRD §8.3）===')
  const E = await connect('E')
  const F = await connect('F')
  const r10 = await emit(E, 'room:create', { maxPlayers: 2 })
  const j10 = await emit(F, 'room:join', { code: r10.room.code })
  const fId = F.id // socket.io 客户端断开后会把 id 清空，必须先记下来
  const leakView = j10.room.players.some((p) => 'socketId' in p) || JSON.stringify(j10.room).includes(fId)
  ok(!leakView, '§8.3', '房间视图不向其他客户端暴露任何 socketId（重连凭据不外泄）')
  ok(r10.room.players.some((p) => p.isYou && p.isHost) && j10.room.players.some((p) => p.isYou && !p.isHost),
    '§8.3', '房主身份按座位标记 isHost 下发，客户端不再依赖 socketId 比对')
  ok(typeof j10.resumeToken === 'string' && j10.resumeToken.length >= 16, '§8.3', '入房 ack 私发重连凭证 resumeToken（仅本人可见）')
  // 让 F 断线：座位保留 + 标记离线
  F.close()
  await sleep(400)
  const hijackNoToken = await emit(C, 'room:reconnect', { oldSocketId: fId })
  ok(!hijackNoToken.ok, '§8.3', `他人仅凭 socketId 不能抢座（实际 ${hijackNoToken.ok ? '抢座成功' : '被拒：' + hijackNoToken.error}）`)
  const hijackFakeToken = await emit(C, 'room:reconnect', { oldSocketId: fId, resumeToken: 'f'.repeat(32) })
  ok(!hijackFakeToken.ok, '§8.3', `伪造 resumeToken 不能抢座（实际 ${hijackFakeToken.ok ? '抢座成功' : '被拒：' + hijackFakeToken.error}）`)
  const F2 = await connect('F2')
  const seatP10 = watch(F2, 'game:seat', 1500)
  const good = await emit(F2, 'room:reconnect', { oldSocketId: fId, resumeToken: j10.resumeToken })
  ok(good.ok && good.room && good.room.players.some((p) => p.isYou),
    '§8.3', `本人持凭证可正常恢复座位（${good.ok ? '重连成功' : '失败：' + good.error}）`,
    '加了凭证校验后重连必须仍然可用，否则玩家掉线就回不来')

  console.log(`\n=== 结果：${pass} 通过, ${fail} 失败 ===`)
  if (notes.length) { console.log('\n观察项：'); notes.forEach((n) => console.log(' · ' + n)) }
  if (failures.length) { console.log('\n未通过项：'); failures.forEach((f) => console.log(' - ' + f)) }
  all.forEach((s) => { try { s.close() } catch (e) {} })
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error('验收脚本异常：', e && e.stack ? e.stack : e); process.exit(2) })
