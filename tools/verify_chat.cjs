const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 两个页面：A 建房，B 加入，然后在房间里互发消息，验证收发与频控
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const ctxA = await browser.newContext({ viewport: { width: 1100, height: 700 } })
  const ctxB = await browser.newContext({ viewport: { width: 1100, height: 700 } })
  const A = await ctxA.newPage()
  const B = await ctxB.newPage()
  const errs = []
  for (const [tag, p] of [['A', A], ['B', B]]) {
    p.on('pageerror', (e) => errs.push(tag + ' PAGEERROR: ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(tag + ' CONSOLE: ' + m.text().slice(0, 120)) })
  }

  // dev 服务器（vite 代理 /socket.io → 3000）
  const base = 'http://localhost:5173/'
  await A.goto(base, { waitUntil: 'networkidle' })
  await B.goto(base, { waitUntil: 'networkidle' })
  await sleep(2500)

  const out = {}

  // A 创建房间
  out.create = await A.evaluate(async () => {
    const g = window.__game
    await new Promise((r) => {
      g.registry.get('socket').emit('room:create', { name: '船长A' }, (res) => { window.__room = res; r() })
    })
    return { ok: window.__room.ok, code: window.__room.room && window.__room.room.code }
  })

  // B 加入
  out.join = await B.evaluate(async (code) => {
    const g = window.__game
    await new Promise((r) => {
      g.registry.get('socket').emit('room:join', { code, name: '船员B' }, (res) => { window.__room = res; r() })
    })
    return { ok: window.__room.ok }
  }, out.create.code)

  // 双方各注册消息监听
  for (const p of [A, B]) {
    await p.evaluate(() => {
      window.__msgs = []
      window.__game.registry.get('socket').on('chat:message', (m) => window.__msgs.push(m))
    })
  }

  // A 发表情，B 发快捷短语
  out.send = await A.evaluate(async () => {
    const sock = window.__game.registry.get('socket')
    const send = (payload) => new Promise((r) => sock.emit('chat:send', payload, (res) => r(res)))
    const r1 = await send({ kind: 'emoji', value: '⚓' })
    const r2 = await send({ kind: 'emoji', value: '⚓' }) // 立即再发 → 应被频控
    await new Promise((r) => setTimeout(r, 800))
    const r3 = await send({ kind: 'phrase', value: '好牌！' })
    await new Promise((r) => setTimeout(r, 800))
    const r4 = await send({ kind: 'emoji', value: '💎' }) // 非法值（已过频控窗口）
    return { r1, r2, r3, r4 }
  })
  out.sendB = await B.evaluate(async () => {
    const sock = window.__game.registry.get('socket')
    const send = (payload) => new Promise((r) => sock.emit('chat:send', payload, (res) => r(res)))
    const r1 = await send({ kind: 'text', value: '大家好，我是B' })
    return { r1 }
  })

  await sleep(600)
  out.receivedA = await A.evaluate(() => window.__msgs)
  out.receivedB = await B.evaluate(() => window.__msgs)

  // 对局内气泡：单机场景下本地冒泡不报错
  out.localBubble = await A.evaluate(async () => {
    window.__game.scene.start('BoardScene', { autoPlay: false })
    await new Promise((r) => setTimeout(r, 2200))
    const sc = window.__game.scene.getScene('BoardScene')
    sc.showChatBubble({ from: 0, name: '我', value: '⚓' })
    await new Promise((r) => setTimeout(r, 300))
    const bubbles = sc.children.list.filter((c) => (c.type === 'Rectangle' && c.depth === 620)).length
    return { bubbles, hasQuickBtn: !!sc.children.list.length }
  })

  out.errors = errs
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
