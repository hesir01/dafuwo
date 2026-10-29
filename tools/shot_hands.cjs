// 截图：左栏角色卡右侧手牌 / 卡牌详情弹窗 / 日志配色 / 新消息浮标
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = process.env.URL || 'http://localhost:5173/index.html'
const W = +(process.env.W || 1440), H = +(process.env.H || 820)

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)

  await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const me = sc.state.players[sc.state.current]
    me.hand = [
      { uid: 'h1', kind: 'history', historyId: 1 },
      { uid: 'h2', kind: 'history', historyId: 2 },
      { uid: 'h3', kind: 'fruit', defId: 'dark' },
      { uid: 'h4', kind: 'haki', defId: 'arm' }
    ]
    sc.state.players[1].hand = [{ uid: 'o1', kind: 'fruit', defId: 'quake' }, { uid: 'o2', kind: 'haki', defId: 'arm' }]
    sc.state.players[2].hand = [{ uid: 'o3', kind: 'history', historyId: 3 }]
    sc.state.players[1].islandIds = [3, 5]
    sc.state.phase = 'awaitAction'
    ;[
      '路飞 缴纳天上金 300 贝利。',
      '娜美 港口补给，领取 80 贝利。',
      '索隆 获得恶魔果实「暗暗果实」。',
      '山治 买下「谢尔兹镇」，花费 60。',
      '乌索普 资不抵债，宣告破产出局！',
      '乔巴 抽到事件「暴风雨」。',
      '🏆 路飞 抵达拉夫德鲁，成为海贼王！'
    ].forEach((t) => sc.state.log.push({ text: t, turn: 1 }))
    sc.refresh()
    await wait(200)
  })
  await page.screenshot({ path: `/tmp/hands_${W}x${H}.png` })

  // 新消息浮标：上翻历史后再来 3 条
  await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 26; i++) sc.state.log.push({ text: `第 ${i} 回合：索隆 掷出 3+4=7，停在自己的「空岛」。`, turn: 1 })
    sc.refresh(); await new Promise((r) => setTimeout(r, 150))
    for (let i = 0; i < 8; i++) sc.scrollLog(-1)
    for (let i = 0; i < 3; i++) sc.state.log.push({ text: `新消息 ${i}：娜美 缴纳天上金 200 贝利。`, turn: 1 })
    sc.refresh(); await wait(200)
  })
  await page.screenshot({ path: `/tmp/chip_${W}x${H}.png` })

  // 卡牌详情（自己的果实卡）
  await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    sc.openCardDetail(sc.state.players[sc.state.current], { uid: 'h3', kind: 'fruit', defId: 'dark' }, true)
    await new Promise((r) => setTimeout(r, 150))
  })
  await page.screenshot({ path: `/tmp/card_${W}x${H}.png` })
  console.log(JSON.stringify({ errors }))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
