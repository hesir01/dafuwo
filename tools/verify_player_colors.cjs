// 验证「每个角色一种颜色」的一致性：左栏卡片边框 / 棋盘岛主圆点 / 右栏日志行
// 三者必须同源（PLAYER_COLORS 与 PLAYER_TEXT_COLORS 同序号），系统播报回落正文米色。
// 用法：先起静态服务 http://127.0.0.1:8765 指向 dist/，再 node tools/verify_player_colors.cjs
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PLAYER_COLORS = ['#d9453a', '#2f7fd0', '#3aa05a', '#e0a32e']
const PLAYER_TEXT_COLORS = ['#ef5a48', '#6cb2f5', '#6bd58f', '#ffc35c']
const MUTED = '#c4b494'

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  const noise = (s) => /socket\.io|favicon\.ico/.test(s)
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text().slice(0, 180)
    const loc = (m.location && m.location() && m.location().url) || ''
    if (noise(t) || noise(loc)) return
    errors.push('CONSOLE: ' + t)
  })

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' })
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => !!window.__game)) break
    await sleep(500)
  }
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2500)

  // 4 名玩家各说一句话 + 一条系统播报，0 号玩家持有磁鼓岛（岛 id=9）
  await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    s.players.forEach((pl, i) => { pl.name = 'P' + (i + 1) })
    s.players[0].islandIds = [9]
    s.islandState[9] = { level: 0, ownerId: 0 }
    s.current = 0
    s.phase = 'awaitAction'
    s.log = [
      { turn: 1, text: '对局开始，共 4 名玩家，每人 2000 贝利。' },
      ...s.players.map((pl, i) => ({ turn: 1, text: `P${i + 1} 买下「磁鼓岛」，花费 220。` })),
      { turn: 2, text: '轮到 P2。' }
    ]
    sc.refresh()
  })
  await sleep(700)

  const probe = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const hex = (n) => '#' + n.toString(16).padStart(6, '0')
    return {
      cardBorders: sc.playerCards.map((c) => hex(c.bg.strokeColor)),
      dot: hex(sc.ownerDots[9].fillColor),
      log: sc.logLineObjs.filter((o) => o.active).map((o) => ({ c: o.t.style.color, t: o.t.text }))
    }
  })

  const results = []
  const check = (ok, msg) => results.push((ok ? '✓ ' : '✗ ') + msg)

  const bordersOk = probe.cardBorders.every((c, i) => c === PLAYER_COLORS[i])
  check(bordersOk, `左栏 4 张卡片边框 = 各自身份色（实际 ${probe.cardBorders.join(' / ')}）`)
  check(probe.dot === PLAYER_COLORS[0], `岛主圆点 = 岛主身份色（实际 ${probe.dot}）`)

  const byPlayer = probe.log.slice(1, 5)
  const logOk = byPlayer.every((l, i) => l.c === PLAYER_TEXT_COLORS[i])
  check(logOk, `日志按角色上色（实际 ${byPlayer.map((l) => l.c).join(' / ')}）`)
  check(probe.log[0].c === MUTED, `系统播报回落正文米色（实际 ${probe.log[0].c}）`)
  check(probe.log[5].c === PLAYER_TEXT_COLORS[1], `「轮到 X」计入该角色（实际 ${probe.log[5].c}）`)

  // 身份色与日志文字色必须同色相：逐通道比较色相序（R/G/B 大小关系一致）
  const sameHue = PLAYER_COLORS.every((c, i) => {
    const a = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16))
    const b = [1, 3, 5].map((k) => parseInt(PLAYER_TEXT_COLORS[i].slice(k, k + 2), 16))
    const order = (v) => v.indexOf(Math.max(...v)) + '/' + v.indexOf(Math.min(...v))
    return order(a) === order(b)
  })
  check(sameHue, '身份色与日志文字色同色相（只有亮度提升）')

  check(errors.length === 0, `页面无 JS 报错${errors.length ? '：' + errors.slice(0, 2).join(' | ') : ''}`)

  console.log(results.join('\n'))
  const failed = results.filter((r) => r.startsWith('✗')).length
  console.log(`\n=== ${results.length - failed} 通过, ${failed} 失败 ===`)
  await browser.close()
  process.exit(failed ? 1 : 0)
})()
