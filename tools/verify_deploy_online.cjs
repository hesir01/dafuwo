// 外网部署真实联机验证：建房(房号纯数字) + 双端加入 + A发互动B收气泡
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'https://op-monopoly.app.workbuddy.host/?sharecode=E5MPKIRY3F'

async function newClient(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__findText = function (o, pat) {
      const re = new RegExp(pat); let f = false
      const w = (x) => { if (!x) return; if (x.type === 'Text' && re.test(x.text || '')) { f = true; return } if (x.list) x.list.forEach(w) }
      w(o); return f
    }
  })
  const errs = []
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${e.message}`))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(3500)
  return { ctx, page, errs, tag }
}
async function createRoom(page, name) {
  return page.evaluate(async (nm) => {
    const g = window.__game; g.scene.start('LobbyScene'); await new Promise((r) => setTimeout(r, 800))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => { s.socket.emit('room:create', { name: nm }, (r) => { s.roomData = r.room; res({ code: r.room.code }) }) })
  }, name)
}
async function joinRoom(page, code, name) {
  return page.evaluate(async ({ code, nm }) => {
    const g = window.__game; g.scene.start('LobbyScene'); await new Promise((r) => setTimeout(r, 800))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => { s.socket.emit('room:join', { code, name: nm }, (r) => { if (!r.ok) return res({ error: r.error }); s.roomData = r.room; res({ ok: true }) }) })
  }, { code, nm: name })
}
async function selectChar(page, id) {
  return page.evaluate((c) => new Promise((res) => { window.__game.scene.getScene('LobbyScene').socket.emit('player:selectChar', { charId: c }, (r) => res(r)) }), id)
}
async function startGame(page) {
  return page.evaluate(() => new Promise((res) => { window.__game.scene.getScene('LobbyScene').socket.emit('game:start', (r) => res(r)) }))
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE })
  const A = await newClient(browser, 'A')
  const B = await newClient(browser, 'B')

  const room = await createRoom(A.page, '路飞')
  const codeOk = /^\d{6}$/.test(room.code)
  const j = await joinRoom(B.page, room.code, '索隆')
  if (j.error) throw new Error('加入失败: ' + j.error)
  await selectChar(A.page, 1)
  await selectChar(B.page, 2)
  const st = await startGame(A.page)
  if (!st.ok) throw new Error('开局失败: ' + st.error)
  await sleep(1500)

  const before = await Promise.all([
    A.page.evaluate(() => { const s = window.__game.scene.getScene('BoardScene'); const reg = window.__game.registry.get('socket'); window.__msgs = []; reg.on('chat:message', (m) => window.__msgs.push(m)); return { online: s.online, seat: s.mySeat } }),
    B.page.evaluate(() => { const s = window.__game.scene.getScene('BoardScene'); window.__msgs = []; window.__game.registry.get('socket').on('chat:message', (m) => window.__msgs.push(m)); return { online: s.online, seat: s.mySeat } })
  ])
  const sendRes = await A.page.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('BoardScene')
    let done = false
    const t = setTimeout(() => { if (!done) res({ ack: 'TIMEOUT' }) }, 6000)
    s.socket.emit('chat:send', { kind: 'emoji', value: '⚓' }, (r) => { done = true; clearTimeout(t); res({ ack: r }) })
  }))
  await sleep(1000)
  const after = await Promise.all([
    A.page.evaluate(() => ({ received: (window.__msgs || []).length, msgs: (window.__msgs || []).map((m) => ({ from: m.from, v: m.value })) })),
    B.page.evaluate(() => { const s = window.__game.scene.getScene('BoardScene'); return { received: (window.__msgs || []).length, msgs: (window.__msgs || []).map((m) => ({ from: m.from, v: m.value })), bubbleRects: s.children.list.filter((c) => c.type === 'Rectangle' && c.depth === 620).length } })
  ])

  const out = { room: room.code, codeOk, before, sendRes, after, errors: [...A.errs, ...B.errs] }
  console.log(JSON.stringify(out, null, 1))
  const ok = codeOk && before[0].online && before[1].online && sendRes.ack && sendRes.ack.ok && after[1].received >= 1 && after[1].bubbleRects >= 1
  console.log(ok ? '\n✅ 外网联机验证通过（房号纯数字 + 双端互通 + 互动气泡渲染）' : '\n❌ 外网联机验证失败')
  await browser.close()
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
