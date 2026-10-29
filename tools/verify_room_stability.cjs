// 房间稳定性验证：房号不跳 + 加入可见 + 纯 socket 层（不依赖浏览器 UI）
// 场景1：A 连建两次房间 → 旧房间必须被清掉（不再收旧房 room:update）→ 房号稳定
// 场景2：B 加入 A 的房间 → A 端 room:update 立刻出现 2 人
// 场景3：C 加入 → A 端看到 3 人；C 离开 → A 端回到 2 人
const { io } = require('socket.io-client')

const URL = process.env.OP_URL || 'http://127.0.0.1:3456'
const log = (...a) => console.log(...a)
let pass = 0, fail = 0
const ok = (cond, label) => { cond ? pass++ : fail++; log(`${cond ? '✅' : '❌'} ${label}`) }

function connect() {
  return new Promise((res) => {
    const s = io(URL, { transports: ['websocket'] })
    s.on('connect', () => res(s))
  })
}
const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, (r) => res(r || {})))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const A = await connect()
  const updatesA = []
  A.on('room:update', (room) => updatesA.push(room))

  // ---- 场景1：A 连建两次房间，房号必须稳定为第二个，且不再收到第一个房间的更新 ----
  const r1 = await emit(A, 'room:create', { name: '房主A', maxPlayers: 4 })
  ok(r1.ok && /^\d{6}$/.test(r1.room.code), `A 第一次建房得到纯数字房号 ${r1.room && r1.room.code}`)
  const code1 = r1.room.code

  const r2 = await emit(A, 'room:create', { name: '房主A', maxPlayers: 4 })
  ok(r2.ok && /^\d{6}$/.test(r2.room.code), `A 重复建房得到新房号 ${r2.room && r2.room.code}（旧房被清）`)
  const code2 = r2.room.code
  ok(code1 !== code2, '两个房号不同')

  await wait(300)
  const staleUpdates = updatesA.filter((u) => u.code === code1)
  ok(staleUpdates.length === 0, `A 不再收到旧房间(${code1})的更新（收到 ${staleUpdates.length} 条）`)

  // ---- 场景2：B 加入 → A 端立刻看到 2 人 ----
  const B = await connect()
  const j1 = await emit(B, 'room:join', { code: code2, name: '船员B' })
  ok(j1.ok, `B 加入房间 ${code2}: ${j1.ok ? 'ok' : j1.error}`)
  await wait(400)
  const last2 = updatesA[updatesA.length - 1]
  ok(last2 && last2.code === code2 && last2.players.length === 2,
    `A 端看到房间变为 2 人（实际 ${last2 ? last2.players.length : '无更新'}）`)
  // 契约变更：服务端统一用「玩家N / 角色名」对外显示，客户端传入的昵称不再透传，
  // 因此断言改为「非房主座位出现且名字非空」，而不是具体昵称。
  const guest2 = last2 && last2.players.find((p) => !p.isHost)
  ok(guest2 && typeof guest2.name === 'string' && guest2.name.length > 0,
    `A 端能看到新玩家（显示名「${guest2 ? guest2.name : '无'}」）`)

  // ---- 场景3：C 加入再离开 → A 端人数 3 → 2 ----
  const C = await connect()
  const j2 = await emit(C, 'room:join', { code: code2, name: '船员C' })
  ok(j2.ok, `C 加入: ${j2.ok ? 'ok' : j2.error}`)
  await wait(400)
  const last3 = updatesA[updatesA.length - 1]
  ok(last3 && last3.players.length === 3, `A 端看到 3 人（实际 ${last3 ? last3.players.length : '?'}）`)

  await emit(C, 'room:leave', {})
  await wait(400)
  const lastAfter = updatesA[updatesA.length - 1]
  ok(lastAfter && lastAfter.players.length === 2, `C 离开后 A 端回到 2 人（实际 ${lastAfter ? lastAfter.players.length : '?'}）`)

  // ---- 场景4：B 刷新页面模拟（新 socket + 旧 socketId + resumeToken 重连） ----
  // 契约：仅凭 socketId 不能接管座位，必须同时持有该座位私发的 resumeToken
  const tokenB = j1.resumeToken
  const B2 = await connect()
  const oldId = B.id
  B.disconnect()
  await wait(200)
  const bad = await emit(B2, 'room:reconnect', { oldSocketId: oldId })
  ok(!bad.ok, `无 resumeToken 的重连被拒绝（${bad.error || '意外通过'}）`)
  const rec = await emit(B2, 'room:reconnect', { oldSocketId: oldId, resumeToken: tokenB })
  ok(rec.ok, `B 持「旧 id + resumeToken」重连: ${rec.ok ? 'ok' : rec.error}`)
  await wait(300)
  const lastRe = updatesA[updatesA.length - 1]
  ok(lastRe && lastRe.players.length === 2, `重连后房间仍为 2 人（实际 ${lastRe ? lastRe.players.length : '无更新'}）`)

  log(`\n===== 结果: ${pass} PASS / ${fail} FAIL =====`)
  ;[A, B2, C].forEach((s) => s.connected && s.disconnect())
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
