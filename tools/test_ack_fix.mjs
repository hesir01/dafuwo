// 验证 ack 修复：模拟 BoardScene.act 的三参 emit（无载荷事件 + {} + 回调）
import { io } from 'socket.io-client'

const URL = 'http://127.0.0.1:3100'
const OPTS = { extraHeaders: { origin: 'http://localhost:5173' } }
const a = io(URL, OPTS)
const b = io(URL, OPTS)

const fail = (msg) => { console.error('❌ ' + msg); process.exit(1) }
const ok = (msg) => console.log('✅ ' + msg)

const emit = (sock, event, payload) => new Promise((resolve) => {
  sock.emit(event, payload, (res) => resolve(res))
  setTimeout(() => resolve({ __timeout: true }), 5000)
})

const main = async () => {
  const r1 = await emit(a, 'room:create', { name: '甲', maxPlayers: 2 })
  if (!r1?.ok) fail('room:create')
  const r2 = await emit(b, 'room:join', { code: r1.room.code, name: '乙' })
  if (!r2?.ok) fail('room:join')
  const s1 = await emit(a, 'player:selectChar', { charId: 1 })
  if (!s1?.ok) fail('selectChar a: ' + JSON.stringify(s1))
  const s2 = await emit(b, 'player:selectChar', { charId: 2 })
  if (!s2?.ok) fail('selectChar b: ' + JSON.stringify(s2))
  const r3 = await emit(a, 'game:start', {})
  if (!r3?.ok) fail('game:start: ' + JSON.stringify(r3))
  ok('建房/加入/选角/开局 全部 ack 正常')

  // 关键用例：与 BoardScene.act 完全一致的三参 emit（extra={}，事件无载荷）
  for (const [sock, name] of [[a, 'game:roll'], [a, 'game:endTurn']]) {
    const r = await emit(sock, name, {})
    if (r?.__timeout) fail(`${name} 三参 emit 5s 未收到 ack —— 复现误报！`)
    ok(`${name} 三参 emit 收到 ack：${JSON.stringify(r.error ? { error: r.error } : { ok: true })}`)
    // 等服务器广播后 AI 行动完成，再发下一个
    await new Promise((res) => setTimeout(res, 1200))
  }
  a.close(); b.close(); process.exit(0)
}

main().catch((e) => fail(e.message))
setTimeout(() => fail('总超时'), 20000)
