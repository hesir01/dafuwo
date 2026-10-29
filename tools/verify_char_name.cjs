// 验证：联机模式下玩家显示名只取自角色本身
// 断言：① 客户端即便上送自定义昵称，服务端也不再采用；
//       ② 大厅/选角/棋盘三处的名字都是角色名；③ 对局内不存在昵称残留。
// 前置：npm run dev（vite:5173 + server:3000）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.OP_URL || 'http://localhost:5173/'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg) }
  else { failed++; console.log('  ✗', msg) }
}

async function newClient(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1.2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/socket\.io|404|favicon|Failed to load resource/.test(t)) return
    errs.push(`[${tag}] console: ${t.slice(0, 160)}`)
  })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(2200)
  return { ctx, page, errs, tag }
}

// 故意上送自定义昵称：服务端必须忽略
async function createRoom(page, junkName) {
  return page.evaluate(async (nm) => {
    const g = window.__game
    g.scene.start('LobbyScene')
    await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => {
      s.socket.emit('room:create', { name: nm, maxPlayers: 2 }, (r) => {
        s.roomData = r.room
        localStorage.setItem('op_game_old_id', r.room.socketId || s.socket.id)
        s.rebuild()
        res({ code: r.room.code, players: r.room.players.map((p) => p.name) })
      })
    })
  }, junkName)
}

async function joinRoom(page, code, junkName) {
  return page.evaluate(async ({ code, nm }) => {
    const g = window.__game
    g.scene.start('LobbyScene')
    await new Promise((r) => setTimeout(r, 600))
    const s = g.scene.getScene('LobbyScene')
    return new Promise((res) => {
      s.socket.emit('room:join', { code, name: nm }, (r) => {
        if (!r.ok) return res({ error: r.error })
        s.roomData = r.room
        localStorage.setItem('op_game_old_id', r.socketId || s.socket.id)
        s.rebuild()
        res({ players: r.room.players.map((p) => p.name), charNames: r.room.players.map((p) => p.charName) })
      })
    })
  }, { code, nm: junkName })
}

async function selectChar(page, charId) {
  return page.evaluate((id) => new Promise((res) => {
    const s = window.__game.scene.getScene('LobbyScene')
    s.socket.emit('player:selectChar', { charId: id }, (r) => res(r))
  }), charId)
}

async function startGame(page) {
  return page.evaluate(() => new Promise((res) => {
    const s = window.__game.scene.getScene('LobbyScene')
    s.socket.emit('game:start', (r) => res(r))
  }))
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE })
  const A = await newClient(browser, 'A')
  const B = await newClient(browser, 'B')

  const room = await createRoom(A.page, '甚平51')
  console.log('1. 建房:', room.code, '座位名:', JSON.stringify(room.players))
  assert(room.players.every((n) => !n.includes('51')), '建房时上送的自定义昵称被忽略，座位名回落为「玩家N」')

  const j = await joinRoom(B.page, room.code, '罗宾71')
  if (j.error) throw new Error('加入失败: ' + j.error)
  assert(j.players.every((n) => !n.includes('71')), '加入时上送的自定义昵称同样被忽略')

  const sa = await selectChar(A.page, 6)   // 乔巴
  const sb = await selectChar(B.page, 7)   // 罗宾
  assert(sa.ok && sb.ok, '两端选角成功（乔巴 / 罗宾）')
  await sleep(600)

  // 大厅列表读的是服务端下发的 room:update，取实际渲染文本
  const lobbyText = await A.page.evaluate(() => {
    const s = window.__game.scene.getScene('LobbyScene')
    return s.children.list.filter((o) => o.type === 'Text').map((o) => o.text).join(' | ')
  })
  assert(lobbyText.includes('乔巴') && lobbyText.includes('罗宾'), '大厅列表显示角色名（乔巴 / 罗宾）')
  assert(!/甚平51|罗宾71/.test(lobbyText), '大厅列表未出现任何自定义昵称')

  const st = await startGame(A.page)
  if (!st.ok) throw new Error('开局失败: ' + st.error)
  await sleep(2600)

  // 对局状态里的玩家名
  const names = await A.page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    return { names: s.state.players.map((p) => p.name), mySeat: s.mySeat }
  })
  assert(names.names.length === 2 && names.names.includes('乔巴') && names.names.includes('罗宾'),
    `对局状态玩家名取自角色：${JSON.stringify(names.names)}`)
  assert(!names.names.some((n) => /51|71/.test(n)), '对局状态无昵称残留')

  // 左栏卡片实际渲染文本（名字行）
  const cards = await A.page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    return { cardNames: s.playerCards.map((c) => c.nameTxt.text), mySeat: s.mySeat }
  })
  console.log('   卡片名字行:', JSON.stringify(cards.cardNames), 'mySeat:', cards.mySeat)
  assert(cards.cardNames.every((t) => /^(乔巴|罗宾|路飞|索隆|娜美|山治|乌索普|弗兰克?奇?|布鲁克|甚平)/.test(t)),
    '卡片名字行只含角色名')
  assert(!cards.cardNames.some((t) => t.includes('·')), '卡片名字行不再出现「昵称 · 角色名」的双名拼接')
  assert(cards.cardNames[cards.mySeat].includes('（你）'), '自己的卡片仍有「（你）」标记')

  // 中央指挥台名字
  const centerName = await A.page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene')
    return s.centerNameTxt ? s.centerNameTxt.text : ''
  })
  console.log('   中央名字行:', centerName)
  assert(!/甚平51|罗宾71/.test(centerName), '中央指挥台不含自定义昵称')

  const errs = [...A.errs, ...B.errs]
  assert(errs.length === 0, errs.length ? '页面报错：' + errs.slice(0, 3).join(' / ') : '两端无 JS 报错')

  await A.page.screenshot({ path: '/tmp/char_name_after.png' })

  console.log(`\n=== 结果：${passed} 通过, ${failed} 失败 ===`)
  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
})()
