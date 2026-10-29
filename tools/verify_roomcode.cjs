// 验证房间码已改为纯 6 位数字
const { io } = require('socket.io-client')
const s = io('http://localhost:3000')
const codes = []
s.on('connect', () => {
  let n = 0
  const next = () => {
    if (n >= 5) {
      const allOk = codes.every((c) => /^\d{6}$/.test(c))
      console.log(JSON.stringify({ codes, allNumeric6: allOk }))
      s.close()
      process.exit(allOk ? 0 : 1)
    }
    s.emit('room:create', { name: '测试' + n }, (r) => {
      if (!r.ok) { console.error('创建失败', r); process.exit(1) }
      codes.push(r.room.code); n++; next()
    })
  }
  next()
})
s.on('connect_error', (e) => { console.error('connect_error', e.message); process.exit(1) })
