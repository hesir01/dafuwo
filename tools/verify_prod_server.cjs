// 生产服务器（43.128.149.78:8010）真实联机验证：房号纯数字 + 互动广播
// 用法：node tools/verify_prod_server.cjs
const { io } = require('socket.io-client')
const URL = 'http://43.128.149.78:8010'

const log = (...a) => console.log(...a)
const emitAck = (sock, ev, data) =>
  new Promise((res) => sock.emit(ev, data, (r) => res(r)))

function connect() {
  return new Promise((res, rej) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false })
    s.on('connect', () => res(s))
    s.on('connect_error', (e) => rej(e))
    setTimeout(() => rej(new Error('connect timeout')), 12000)
  })
}

;(async () => {
  let A, B
  try {
    A = await connect()
    log('A 连接:', A.id)
    const createRes = await emitAck(A, 'room:create', { name: 'A', maxPlayers: 4 })
    const code = (createRes.room && createRes.room.code) || ''
    log('建房返回房号:', JSON.stringify(code))
    const codeOk = /^\d{6}$/.test(code)
    log('房号纯6位数字?', codeOk ? '✅' : '❌')

    B = await connect()
    const joinRes = await emitAck(B, 'room:join', { code, name: 'B' })
    log('B 加入:', joinRes.ok ? '✅' : '❌ ' + joinRes.error)

    // 互动：A 发 ⚓，B 收
    const got = []
    B.on('chat:message', (m) => got.push(m))
    const sendRes = await emitAck(A, 'chat:send', { kind: 'emoji', value: '⚓' })
    log('A 发互动 ack:', JSON.stringify(sendRes))
    await new Promise((r) => setTimeout(r, 800))
    const chatOk = got.some((m) => m.kind === 'emoji' && m.value === '⚓')
    log('B 收到互动广播?', chatOk ? '✅' : '❌', JSON.stringify(got))

    log('\n=== 结论 ===')
    log('房号纯数字 :', codeOk ? 'PASS' : 'FAIL')
    log('联机加入   :', joinRes.ok ? 'PASS' : 'FAIL')
    log('互动生效   :', chatOk ? 'PASS' : 'FAIL')
    process.exit(codeOk && joinRes.ok && chatOk ? 0 : 1)
  } catch (e) {
    log('验证异常:', e.message)
    process.exit(2)
  } finally {
    if (A) A.close()
    if (B) B.close()
  }
})()
