// 真机浏览器验收：房主身份识别（isHost）+ 断线重连（resumeToken 持久化）
// 背景：playerView 不再下发 socketId，客户端改用 isHost 判断房主；
//       重连改为「旧 socketId + 座位私发 token」两件套，token 存 localStorage。
// 用法：起 vite(5173) + server(3000) 后 node tools/verify_room_identity.cjs
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.OP_WEB || 'http://localhost:5173/'

let pass = 0, fail = 0
const ok = (c, msg, detail = '') => {
  if (c) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg + (detail ? ' — ' + detail : '')) }
}

async function newClient(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/socket\.io|404/.test(m.text())) errs.push(`[${tag}] console: ${m.text()}`) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(2200)
  return { ctx, page, errs, tag }
}
// 直接调 socket 建房/加入，并把 roomData 落到场景里（等价于点按钮后的结果）
async function create(page) {
  return page.evaluate(() => new Promise((res) => {
    const g = window.__game
    g.scene.start('LobbyScene')
    setTimeout(() => {
      const s = g.scene.getScene('LobbyScene')
      s.socket.emit('room:create', { maxPlayers: 2 }, (r) => {
        if (!r.ok) return res({ error: r.error })
        // 与 LobbyScene.showJoinForm 中一致的持久化行为
        localStorage.setItem('op_game_resume', JSON.stringify({ id: r.socketId || s.socket.id, token: r.resumeToken }))
        s.roomData = r.room
        s.rebuild()
        res({ code: r.room.code, hasToken: typeof r.resumeToken === 'string' && r.resumeToken.length >= 16 })
      })
    }, 500)
  }))
}
async function join(page, code) {
  return page.evaluate((code) => new Promise((res) => {
    const g = window.__game
    g.scene.start('LobbyScene')
    setTimeout(() => {
      const s = g.scene.getScene('LobbyScene')
      s.socket.emit('room:join', { code }, (r) => {
        if (!r.ok) return res({ error: r.error })
        localStorage.setItem('op_game_resume', JSON.stringify({ id: r.socketId || s.socket.id, token: r.resumeToken }))
        s.roomData = r.room
        s.rebuild()
        res({ ok: true, hasToken: typeof r.resumeToken === 'string' && r.resumeToken.length >= 16 })
      })
    }, 500)
  }), code)
}
async function hostFlag(page) {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('LobbyScene')
    const r = s.roomData
    if (!r) return { err: 'no roomData' }
    return {
      isHost: r.players.some((p) => p.isYou && p.isHost),
      hasSocketIdKey: r.players.some((p) => 'socketId' in p),
      players: r.players.length
    }
  })
}
// 进选角界面：先选角，再看「出航」按钮是否只给房主开放
async function startBtnState(page, charId) {
  return page.evaluate(async (charId) => {
    const g = window.__game
    g.scene.start('SelectScene')
    await new Promise((r) => setTimeout(r, 700))
    const s = g.scene.getScene('SelectScene')
    await new Promise((r) => {
      s.socket.emit('player:selectChar', { charId }, (res) => {
        if (res && res.ok) s.myCharId = charId
        r()
      })
    })
    await new Promise((r) => setTimeout(r, 300))
    s.updateStartState()
    return {
      enabled: !!(s.startBtn && s.startBtn.enabled !== false),
      hint: s.startHint ? s.startHint.text : ''
    }
  }, charId)
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const A = await newClient(browser, 'A')
  const B = await newClient(browser, 'B')

  console.log('\n=== 1. 房主身份（isHost，不再依赖 socketId）===')
  const rA = await create(A.page)
  const rB = await join(B.page, rA.code)
  ok(!!rA.code && rB.ok, `两人进同一房间（${rA.code}）`)
  ok(rA.hasToken && rB.hasToken, '建房/入房 ack 都私发 resumeToken')
  const fA = await hostFlag(A.page)
  const fB = await hostFlag(B.page)
  ok(fA.isHost === true && fB.isHost === false, `房主识别正确（A=${fA.isHost}, B=${fB.isHost}）`)
  ok(!fA.hasSocketIdKey && !fB.hasSocketIdKey, '房间视图不含 socketId 字段')
  const sA = await startBtnState(A.page, 1)
  const sB = await startBtnState(B.page, 2)
  ok(sA.enabled, `房主选角后可点「出航」（hint: ${sA.hint}）`)
  ok(!sB.enabled && /等待房主/.test(sB.hint), `非房主不能出航（hint: ${sB.hint}）`)

  console.log('\n=== 2. 断线重连（旧 socketId + resumeToken）===')
  const before = await A.page.evaluate(() => {
    const s = window.__game.scene.getScene('LobbyScene')
    return { code: s.roomData && s.roomData.code }
  })
  await A.page.reload({ waitUntil: 'networkidle' })
  // 刷新后回到标题页，点「出航」进大厅 → LobbyScene.create() 会用本地凭证自动重连
  await A.page.waitForFunction(() => !!(window.__game && window.__game.scene.getScene('BootScene').scene.isActive()), null, { timeout: 20000 })
  await sleep(600)
  await A.page.evaluate(() => window.__game.scene.start('LobbyScene'))
  await sleep(2500)
  const after = await A.page.evaluate(() => {
    const s = window.__game.scene.getScene('LobbyScene')
    return {
      code: s.roomData && s.roomData.code,
      me: s.roomData && s.roomData.players.findIndex((p) => p.isYou),
      isHost: !!(s.roomData && s.roomData.players.some((p) => p.isYou && p.isHost))
    }
  })
  ok(after.code === before.code, `刷新后自动回到原房间（${before.code} → ${after.code}）`)
  ok(after.me === 0 && after.isHost, `座位与房主身份保持不变（座位 ${after.me}，host=${after.isHost}）`)

  const errs = [...A.errs, ...B.errs]
  ok(errs.length === 0, `两端无 JS 运行时报错${errs.length ? '（' + errs.slice(0, 3).join(' | ') + '）' : ''}`)

  console.log(`\n=== 结果：${pass} 通过, ${fail} 失败 ===`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('脚本异常：', e && e.stack ? e.stack : e); process.exit(2) })
