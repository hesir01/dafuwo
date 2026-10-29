const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await sleep(2200)
  // 进大厅并创建房间
  await page.evaluate(async () => {
    const g = window.__game
    g.scene.start('LobbyScene')
    await new Promise(r => setTimeout(r, 800))
    const sc = g.scene.getScene('LobbyScene')
    g.registry.get('socket').emit('room:create', { name: '船长A' }, (res) => {
      if (res.ok) { sc.roomData = res.room; sc.rebuild() }
    })
  })
  await sleep(1500)
  await page.screenshot({ path: '.playwright-cli/lobby-room-v2.png' })
  // 布局断言：出航按钮与聊天元素不重叠
  const check = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('LobbyScene')
    const btns = sc.children.list.filter(c => c.type === 'Container' && c.list)
    const labeled = btns.map(c => ({ c, t: (c.list.find(x => x.type === 'Text') || {}).text || '' }))
    const sail = labeled.find(b => b.t.includes('出航'))
    const chat = labeled.find(b => b.t.includes('说点什么'))
    const leave = labeled.find(b => b.t.includes('离开'))
    const rect = (b) => b ? { top: b.c.y - b.c.height / 2, bottom: b.c.y + b.c.height / 2 } : null
    const s = rect(sail), c = rect(chat), l = rect(leave)
    return {
      found: { sail: !!sail, chat: !!chat, leave: !!leave },
      sail: s, chat: c, leave: l,
      noOverlapSailChat: s && c ? c.top > s.bottom : 'n/a',
      noOverlapChatLeave: c && l ? l.top > c.bottom : 'n/a'
    }
  })
  console.log(JSON.stringify(check))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
