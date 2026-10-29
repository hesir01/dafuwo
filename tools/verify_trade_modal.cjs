// 联机实测（问题2 交易弹窗渲染）：验证 awaitTrade 时
//  - 被交易方（非本人回合 myTurn=false）仍能被放行渲染「接受/拒绝」（守卫豁免修复）
//  - 发起方渲染只读「知道了」（分支区分修复）
// 做法：在两端 BoardScene 直接注入 awaitTrade 状态并调用 renderModal，断言渲染结果。
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173/'

async function newClient(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__allText = function (root) {
      const out = []
      const w = (x) => {
        if (!x) return
        if (x.type === 'Text' && x.text) out.push(x.text)
        if (x.list) x.list.forEach(w)
        if (x.children && x.children.list) x.children.list.forEach(w)
      }
      w(root); return out
    }
  })
  const errs = []
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${e.message}`))
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
  const j = await joinRoom(B.page, room.code, '索隆')
  if (j.error) throw new Error('加入失败: ' + j.error)
  await selectChar(A.page, 1)
  await selectChar(B.page, 2)
  const st = await startGame(A.page)
  if (!st.ok) throw new Error('开局失败: ' + st.error)
  await sleep(1500)

  // 取两端座位与回合信息
  const meta = await Promise.all([
    A.page.evaluate(() => { const s = window.__game.scene.getScene('BoardScene'); return { online: s.online, seat: s.mySeat, current: s.state.current, myTurn: s.myTurn() } }),
    B.page.evaluate(() => { const s = window.__game.scene.getScene('BoardScene'); return { online: s.online, seat: s.mySeat, current: s.state.current, myTurn: s.myTurn() } })
  ])

  // 在 B（被交易方）注入 awaitTrade：targetId = B 的座位，direction=sell（对方希望卖给你）
  const bTarget = await B.page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    s.closeModal && s.closeModal()
    s.modal = null
    s.state.phase = 'awaitTrade'
    s.state.modal = { type: 'trade', fromId: s.state.current, targetId: s.mySeat, historyId: 1, price: 200, direction: 'sell' }
    s.renderModal(s.state, s.state.players[s.mySeat])
    const texts = window.__allText(s)
    return {
      myTurn: s.myTurn(),
      modalPresent: !!s.modal,
      hasAccept: texts.some((t) => t.includes('接受')),
      hasReject: texts.some((t) => t.includes('拒绝')),
      hasKnown: texts.some((t) => t.includes('知道了'))
    }
  })

  // 在 A（发起方）注入 awaitTrade：targetId = B 的座位，direction=sell（A 是发起方）
  const aInit = await A.page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    s.closeModal && s.closeModal()
    s.modal = null
    s.state.phase = 'awaitTrade'
    s.state.modal = { type: 'trade', fromId: s.mySeat, targetId: s.state.players[(s.mySeat + 1) % s.state.players.length].id, historyId: 1, price: 200, direction: 'sell' }
    s.renderModal(s.state, s.state.players[s.mySeat])
    const texts = window.__allText(s)
    return {
      myTurn: s.myTurn(),
      modalPresent: !!s.modal,
      hasAccept: texts.some((t) => t.includes('接受')),
      hasReject: texts.some((t) => t.includes('拒绝')),
      hasKnown: texts.some((t) => t.includes('知道了'))
    }
  })

  // 附加：真实发起一次交易（确认服务端 game:tradePropose 不崩；B 可能无对应正文，预期 ok=false 但通道正常）
  const realTrade = await A.page.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('BoardScene')
    const targetId = s.state.players[(s.mySeat + 1) % s.state.players.length].id
    let done = false
    const t = setTimeout(() => { if (!done) res({ ack: 'TIMEOUT' }) }, 5000)
    s.socket.emit('game:tradePropose', { targetId, historyId: 1, price: 200 }, (r) => { done = true; clearTimeout(t); res({ ack: r }) })
  }))

  const result = { room: room.code, meta: { A: meta[0], B: meta[1] }, bTarget, aInit, realTrade, errors: [...A.errs, ...B.errs] }
  console.log(JSON.stringify(result, null, 1))

  // 断言
  const ok = bTarget.modalPresent && bTarget.hasAccept && bTarget.hasReject && !bTarget.hasKnown
    && aInit.modalPresent && aInit.hasKnown && !aInit.hasAccept
    && realTrade.ack !== 'TIMEOUT'
  console.log(ok ? '\n✅ 问题2 修复验证通过' : '\n❌ 问题2 验证失败')
  await browser.close()
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
