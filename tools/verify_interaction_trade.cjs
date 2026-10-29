// 联机实测（深度诊断）：定位聊天广播为何到不了 B
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173/'

async function newClient(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__findText = function (o, pat) {
      const re = new RegExp(pat)
      let f = false
      const w = (x) => { if (!x) return; if (x.type === 'Text' && re.test(x.text || '')) { f = true; return } if (x.list) x.list.forEach(w) }
      w(o); return f
    }
  })
  const errs = []
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/socket\.io|404/.test(m.text())) errs.push(`[${tag}] console: ${m.text()}`) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(2500)
  return { ctx, page, errs, tag }
}
async function createRoom(page, name) {
  return page.evaluate(async (nm) => {
    const g = window.__game; g.scene.start('LobbyScene'); await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => { s.socket.emit('room:create', { name: nm }, (r) => { s.roomData = r.room; res({ code: r.room.code }) }) })
  }, name)
}
async function joinRoom(page, code, name) {
  return page.evaluate(async ({ code, nm }) => {
    const g = window.__game; g.scene.start('LobbyScene'); await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => { s.socket.emit('room:join', { code, name: nm }, (r) => { if (!r.ok) return res({ error: r.error }); s.roomData = r.room; res({ ok: true }) }) })
  }, { code, nm: name })
}
async function selectChar(page, charId) {
  return page.evaluate((id) => new Promise((res) => { window.__game.scene.getScene('LobbyScene').socket.emit('player:selectChar', { charId: id }, (r) => res(r)) }), charId)
}
async function startGame(page) {
  return page.evaluate(() => new Promise((res) => { window.__game.scene.getScene('LobbyScene').socket.emit('game:start', (r) => res(r)) }))
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE })
  const A = await newClient(browser, 'A')
  const B = await newClient(browser, 'B')

  const room = await createRoom(A.page, '路飞')
  const j = await joinRoom(B.page, room.code, '索隆')
  if (j.error) throw new Error('加入失败: ' + j.error)
  await selectChar(A.page, 1)
  await selectChar(B.page, 2)
  const st = await startGame(A.page)
  if (!st.ok) throw new Error('开局失败: ' + st.error)
  await sleep(1500)

  // 两端都注册监听 + 记录 online/seat/roomCode
  const before = await Promise.all([
    A.page.evaluate(() => {
      const s = window.__game.scene.getScene('BoardScene')
      const reg = window.__game.registry.get('socket')
      window.__msgs = []
      reg.on('chat:message', (m) => window.__msgs.push(m))
      return { online: s.online, seat: s.mySeat, connected: s.socket.connected, boardSocketId: s.socket.id, regSocketId: reg.id, sameSocket: s.socket === reg }
    }),
    B.page.evaluate(() => { const s = window.__game.scene.getScene('BoardScene'); window.__msgs = []; window.__game.registry.get('socket').on('chat:message', (m) => window.__msgs.push(m)); return { online: s.online, seat: s.mySeat, connected: s.socket.connected } })
  ])

  // A 发真实互动，明确等待 ack
  const sendRes = await A.page.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('BoardScene')
    let done = false
    const t = setTimeout(() => { if (!done) res({ ack: 'TIMEOUT' }) }, 5000)
    s.socket.emit('chat:send', { kind: 'emoji', value: '⚓' }, (r) => { done = true; clearTimeout(t); res({ ack: r }) })
  }))
  // 对照：A 发一个确定有 handler 的 game:autoplay，看是否也超时
  const autoplayRes = await A.page.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('BoardScene')
    let done = false
    const t = setTimeout(() => { if (!done) res({ ack: 'TIMEOUT' }) }, 5000)
    s.socket.emit('game:autoplay', { on: false }, (r) => { done = true; clearTimeout(t); res({ ack: r }) })
  }))
  await sleep(1000)

  const after = await Promise.all([
    A.page.evaluate(() => ({ received: (window.__msgs || []).length, msgs: (window.__msgs || []).map((m) => ({ from: m.from, v: m.value })) })),
    B.page.evaluate(() => {
      const s = window.__game.scene.getScene('BoardScene')
      return {
        received: (window.__msgs || []).length,
        msgs: (window.__msgs || []).map((m) => ({ from: m.from, v: m.value })),
        bubbleRects: s.children.list.filter((c) => c.type === 'Rectangle' && c.depth === 620).length,
        bubbleText: window.__findText(s, '⚓')
      }
    })
  ])

  console.log(JSON.stringify({ room: room.code, before, sendRes, autoplayRes, after, errors: [...A.errs, ...B.errs] }, null, 1))
  await browser.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
