// 房间层测试：选角倒计时分配（缺口A）/ 再来一局（缺口C）/ 无人房间回收（缺口E）
// 用法：node tests/rooms.test.js
import {
  createRoom, joinRoom, assignRandomChars, restartRoom, sweepRooms,
  playerView, startGame, leaveRoom, getRoomBySocket, clearRoomTimers
} from '../server/rooms.js'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg) }
  else { failed++; console.log('  ✗', msg) }
}
// rooms.js 只用 socket.id 和 socket.join()，假 socket 足够
const fakeSocket = (id) => ({ id, join() {} })

console.log('=== 1. 选角超时随机分配（PRD §8.4） ===')
{
  const room = createRoom(fakeSocket('s1'), null, 4)
  joinRoom(room.code, fakeSocket('s2'), null)
  joinRoom(room.code, fakeSocket('s3'), null)
  // 两人已选角，一人未选 + 一个空位（开局才补 AI，分配只针对真人）
  room.players[0].charId = 1
  room.players[1].charId = 3
  const assigned = assignRandomChars(room)
  assert(assigned.length === 1, '只给未选角的 1 名真人分配（返回 1 条记录）')
  const p3 = room.players[2]
  assert(p3.charId != null && p3.charId !== 1 && p3.charId !== 3, '分配到未被选走的角色')
  assert(p3.ready === true, '分配后座位 ready')
  // 全员未选：分配数量正确且互不重复
  const room2 = createRoom(fakeSocket('t1'), null, 4)
  joinRoom(room2.code, fakeSocket('t2'), null)
  joinRoom(room2.code, fakeSocket('t3'), null)
  joinRoom(room2.code, fakeSocket('t4'), null)
  const assigned2 = assignRandomChars(room2)
  assert(assigned2.length === 4, '4 名真人全部被分配')
  const ids = new Set(room2.players.map((p) => p.charId))
  assert(ids.size === 4, '分配的角色互不重复')
  assert(room2.players.every((p) => p.charId >= 1 && p.charId <= 10), '角色都在 1-10 范围内')
  // playerView 暴露 selectDeadline 给客户端倒计时
  room2.selectDeadline = Date.now() + 60000
  const view = playerView(room2, 't1')
  assert(typeof view.selectDeadline === 'number', 'playerView 下发 selectDeadline')
}

console.log('\n=== 2. 再来一局：保留座位、清空状态（PRD §7/§9） ===')
{
  const room = createRoom(fakeSocket('r1'), null, 4)
  joinRoom(room.code, fakeSocket('r2'), null)
  room.players[0].charId = 2
  room.players[1].charId = 5
  const r = startGame(room)
  assert(!r.error && room.started, '开局成功（空位自动补 AI 到 4 人）')
  assert(room.players.length === 4, '开局后 4 个座位（2 真人 + 2 补位 AI）')
  // 真人1 断线转托管（模拟离线），真人0 在线托管中
  room.players[1].disconnected = true
  room.players[1].disconnectedAt = Date.now()
  room.players[1].isAI = true
  room.players[0].isAI = true // 在线但开了托管
  room.state.phase = 'ended'
  room.state.winner = room.state.players[0]
  const back = restartRoom(room)
  assert(back != null, '房间仍在（有真人座位保留）')
  assert(room.players.length === 2, '纯 AI 补位座位被清掉，只剩 2 个真人座位')
  assert(room.started === false && room.state === null, '对局状态已清空')
  assert(room.players.every((p) => p.charId === null && p.ready === false), '座位角色/就绪已重置，等待重选')
  assert(room.players[0].isAI === false, '在线真人解除托管')
  assert(room.players[1].isAI === true && room.players[1].disconnected === true, '离线真人继续托管（凭证保留可重连）')
  assert(room.players.every((p) => !!p.resumeToken), '重连凭证全部保留')
  assert(room.players.some((p) => p.socketId === room.hostId), '房主指向仍然有效')
  // 全员走光：房间销毁
  const room3 = createRoom(fakeSocket('x1'), null, 2)
  joinRoom(room3.code, fakeSocket('x2'), null)
  room3.players.forEach((p) => { p.disconnected = true; p.isAI = true })
  room3.started = true
  room3.players[0].resumeToken = null
  room3.players[1].resumeToken = null
  const gone = restartRoom(room3)
  assert(gone === null, '没有真人座位时房间销毁并返回 null')
}

console.log('\n=== 3. 无人房间回收（PRD §10 稳定性） ===')
{
  const live = createRoom(fakeSocket('l1'), null, 4)
  const dead = createRoom(fakeSocket('d1'), null, 4)
  // dead：全员离线（真人座位标离线）且闲置很久
  dead.players[0].disconnected = true
  dead.players[0].isAI = true
  dead.createdAt = Date.now() - 60 * 60 * 1000
  dead.lastActiveAt = Date.now() - 60 * 60 * 1000
  const removed = sweepRooms(30 * 60 * 1000)
  assert(removed >= 1, '回收至少 1 个无人房间')
  assert(!getRoomBySocket('d1'), '闲置且无在线真人的房间已被销毁')
  assert(getRoomBySocket('l1'), '有在线真人的房间保留')
  // 有在线真人但同样闲置很久：不回收
  live.createdAt = Date.now() - 60 * 60 * 1000
  live.lastActiveAt = Date.now() - 60 * 60 * 1000
  sweepRooms(30 * 60 * 1000)
  assert(getRoomBySocket('l1'), '闲置但有在线真人的房间不回收')
  // 清理，不污染其他用例
  leaveRoom('l1', { graceful: true })
  clearRoomTimers(live)
}

console.log(`\n=== 结果：${passed} 通过, ${failed} 失败 ===`)
process.exit(failed > 0 ? 1 : 0)
