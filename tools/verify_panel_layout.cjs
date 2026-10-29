// 右栏布局回归验证：
// 1) 无 JS 错误；2) 当前格 / 日志 / 手牌三者边界不重叠；
// 3) 各弹层（岛屿 / 交易 / 规则）能正常打开关闭；4) 买岛阶段按钮可用；
// 5) 窗口缩放后重建不报错且几何仍然成立。
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = process.env.URL || 'http://localhost:5173/index.html'

const SIZES = [[1080, 610], [1280, 720], [1440, 820], [900, 540]]

async function run(size, browser) {
  const [W, H] = size
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/socket\.io|Failed to load resource|ERR_CONNECTION/.test(m.text())) errors.push('CONSOLE: ' + m.text().slice(0, 160))
  })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1600)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2000)

  const geo = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    const cellTop = sc.cellPanel ? sc.cellPanel.y - sc.cellPanel.list[1].height / 2 : null
    const cellBottom = sc.cellPanel ? sc.cellPanel.y + sc.cellPanel.list[1].height / 2 : null
    return {
      H: sc.H,
      mode: sc.cellMode,
      cell: cellTop == null ? null : { top: Math.round(cellTop), bottom: Math.round(cellBottom) },
      log: sc.logArea ? { top: Math.round(sc.logArea.y), bottom: Math.round(sc.logArea.y + sc.logArea.h) } : null,
      // 手牌已搬进左栏玩家卡：右栏不再有手牌面板，日志应一直铺到面板底部
      logBottom: sc.logArea ? Math.round(sc.logArea.y + sc.logArea.h) : null,
      panelBottom: Math.round(sc.panel.y + sc.panel.h),
      // 左栏卡右侧手牌区：mini 卡必须落在卡片边框内
      cardsHandFit: (sc.playerCards || []).every((c) => {
        const b = c.bg
        const kids = c.handC ? c.handC.list : []
        return kids.every((k) => k.x - k.displayWidth / 2 >= b.x - b.width / 2 - 1 &&
          k.x + k.displayWidth / 2 <= b.x + b.width / 2 + 1 &&
          k.y - k.displayHeight / 2 >= b.y - b.height / 2 - 1 &&
          k.y + k.displayHeight / 2 <= b.y + b.height / 2 + 1)
      }),
      centerAvatarHit: !!sc.centerAvatar && sc.input.enabled,
      // 右栏不再重复现金 / 倒计时：现金只在左栏玩家卡，倒计时只在中央头像外圈
      rightCash: !!sc.cashTxt,
      rightPlayer: !!sc.playerTxt,
      rightRoll: !!sc.rollTxt,
      console: !!sc.centerConsole,
      // 中央指挥台：6 个主按钮与行动横幅必须整体落在羊皮纸安全矩形内
      consoleFit: (() => {
        if (!sc.centerConsole || !sc.centerRect) return true
        const r = sc.centerRect
        const keys = ['btnRoll', 'btnEnd', 'btnBuy', 'btnDecline', 'btnSkill', 'btnVoyage']
        return keys.every((k) => {
          const b = sc[k]
          if (!b) return false
          return b.root.x - b.w / 2 >= r.x - 1 && b.root.x + b.w / 2 <= r.x + r.w + 1 &&
            b.root.y - b.h / 2 >= r.y - 1 && b.root.y + b.h / 2 <= r.y + r.h + 1
        })
      })(),
      // 中央不再有正文牌位 / 交易按钮（牌位与左栏重复；交易走点头像）
      noPips: !sc.centerPips,
      noTradeBtn: !sc.btnTrade,
      // 工具条在右栏顶部（岛屿/托管/规则/⚙/离船），须存在且落在右栏面板内
      toolbarFit: (() => {
        const p = sc.panel
        return ['btnIslands', 'btnAuto', 'btnRules', 'btnSettings', 'btnExit'].every((k) => {
          const b = sc[k]
          if (!b) return false
          return b.root.x >= p.x && b.root.x <= p.x + p.w && b.root.y >= p.y && b.root.y <= p.y + p.h
        })
      })(),
      // 左栏玩家卡整卡可点（玩家信息 / 发起交易入口）
      cardsClickable: !!(sc.playerCards && sc.playerCards.length && sc.playerCards.every((c) => !!c.hit)),
      oldTimerUI: !!(sc.timerTxt || sc.timerBar),
      ring: sc.centerTimerArc
        ? { drawn: !!sc.centerTimerArcDrawn, cmds: sc.centerTimerArc.commandBuffer.length }
        : null,
      // 阶段可见性：awaitRoll 下第二行应显示「技能|出航」对，购买对隐藏
      pairVisibility: {
        buyHiddenInRoll: sc.btnBuy && !sc.btnBuy.root.visible && sc.btnDecline && !sc.btnDecline.root.visible,
        skillShownInRoll: sc.btnSkill && sc.btnSkill.root.visible && sc.btnVoyage && sc.btnVoyage.root.visible
      }
    }
  })

  const issues = []
  if (geo.cell && geo.log && geo.cell.bottom > geo.log.top + 1) issues.push(`当前格压住日志 ${geo.cell.bottom}>${geo.log.top}`)
  if (geo.logBottom && geo.logBottom > geo.panelBottom + 1) issues.push(`日志越出面板 ${geo.logBottom}>${geo.panelBottom}`)
  if (geo.cell && !geo.logBottom && geo.cell.bottom > geo.panelBottom) issues.push('当前格越出面板')
  if (!geo.cardsHandFit) issues.push('左栏卡右侧手牌越过卡片边框')
  if (!geo.centerAvatarHit) issues.push('中央头像不可点击（应打开当前行动者档案）')
  if (geo.rightCash) issues.push('右栏仍在重复显示现金（应与左栏玩家卡去重）')
  if (geo.oldTimerUI) issues.push('右栏仍残留旧的数字/横条倒计时')
  if (geo.rightPlayer || geo.rightRoll) issues.push('右栏仍重复显示玩家行 / 骰点文字')
  if (!geo.consoleFit) issues.push('中央操作区有按钮越出羊皮纸安全区')
  if (!geo.noPips) issues.push('中央正文牌位未移除（与左栏玩家卡重复）')
  if (!geo.noTradeBtn) issues.push('中央仍残留独立交易按钮（应走点头像）')
  if (!geo.toolbarFit) issues.push('右栏工具条缺失或越出面板')
  if (!geo.cardsClickable) issues.push('左栏玩家卡不可点击（缺玩家信息/交易入口）')
  if (!geo.pairVisibility.buyHiddenInRoll || !geo.pairVisibility.skillShownInRoll) issues.push(`2×2 上下文切换异常 ${JSON.stringify(geo.pairVisibility)}`)
  if (!geo.ring || !geo.ring.drawn || geo.ring.cmds < 6) issues.push(`中央头像环形倒计时未绘制 ${JSON.stringify(geo.ring)}`)

  // 弹层开关
  const panels = await page.evaluate(async () => {
    const sc = window.__game.scene.getScene('BoardScene')
    const out = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    sc.state.players[sc.state.current].islandIds = [1]
    sc.state.players[sc.state.current].hand = [
      { uid: 'h1', kind: 'history', historyId: 1 },
      { uid: 'h2', kind: 'history', historyId: 2 }
    ]
    // 给另一位玩家一张果实卡：验证「有手牌才在卡右侧显示」是按人渲染的
    // 5 张满手牌：验证 2 列网格在最小卡片高度下也不越框
    sc.state.players[1].hand = [
      { uid: 'o1', kind: 'fruit', defId: 'dark' },
      { uid: 'o2', kind: 'fruit', defId: 'quake' },
      { uid: 'o3', kind: 'haki', defId: 'armament' },
      { uid: 'o4', kind: 'history', historyId: 2 },
      { uid: 'o5', kind: 'history', historyId: 3 }
    ]
    sc.state.phase = 'awaitAction'
    sc.current = sc.state.current
    sc.refresh(); await wait(120)
    out.cardMinis = sc.playerCards.map((c) => c.handC.list.length)
    out.selfMinis = sc.playerCards[sc.state.current].handC.list.length
    out.handFit5 = (() => {
      const c = sc.playerCards[1]
      const b = c.bg
      return c.handC.list.every((k) => (Math.abs(k.x - b.x) + k.displayWidth / 2 <= b.width / 2 + 1) &&
        (Math.abs(k.y - b.y) + k.displayHeight / 2 <= b.height / 2 + 1))
    })()
    // 正文牌位已移除：进度只在左栏玩家卡（📜x/4）
    out.pipsRemoved = !sc.centerPips
    sc.openIslandPanel(); await wait(120); out.islands = !!sc.customPanel
    sc.closeCustomPanel(); await wait(80)
    sc.openTradePanel(); await wait(120); out.trade = !!sc.customPanel
    sc.closeCustomPanel(); await wait(80)
    // 玩家信息弹窗：点头像入口（自己 → 档案；他人 → 含发起交易按钮）
    sc.openPlayerInfo(0); await wait(120); out.playerInfo = !!sc.customPanel
    sc.closeCustomPanel(); await wait(80)
    if (sc.state.players.length > 1) {
      sc.openPlayerInfo(1); await wait(120)
      out.playerInfoOther = !!sc.customPanel
      out.tradeEntryInInfo = out.playerInfoOther && sc.customPanel.root.list.some((it) =>
        it.type === 'Container' && it.list && it.list.some((t) => t.type === 'Text' && /发起交易/.test(t.text)))
      sc.closeCustomPanel(); await wait(80)
    }
    sc.openRules(); await wait(120); out.rules = !!sc.customPanel
    sc.closeCustomPanel(); await wait(80)
    // 买岛阶段
    const s = sc.state
    s.phase = 'awaitBuy'
    s.pendingIslandId = 1
    sc.refresh(); await wait(120)
    out.buyEnabled = !!sc.btnBuy.enabled
    out.buyVisibleInBuy = sc.btnBuy.root.visible && sc.btnDecline.root.visible && !sc.btnSkill.root.visible
    out.banner = sc.actionBannerTxt.text
    s.phase = 'awaitRoll'; s.pendingIslandId = null
    sc.refresh(); await wait(60)
    // 窗口缩放重建
    sc.scale.resize(window.innerWidth - 60, window.innerHeight - 40)
    await wait(500)
    out.afterResize = { cellMode: sc.cellMode, logBottom: sc.logArea ? Math.round(sc.logArea.y + sc.logArea.h) : 0, panelBottom: Math.round(sc.panel.y + sc.panel.h) }
    return out
  })
  if (!panels.islands || !panels.trade || !panels.rules) issues.push(`弹层打开失败 ${JSON.stringify(panels)}`)
  if (!panels.pipsRemoved) issues.push('中央正文牌位未移除')
  if (!panels.playerInfo) issues.push('点自己头像的玩家档案打不开')
  // 自己 2 张正文 = 4 个元素（底图+图标）×2；1 号玩家 1 张果实 = 2 个元素；其余 0
  if (!panels.selfMinis) issues.push(`自己的手牌未渲染到角色卡右侧 ${JSON.stringify(panels.cardMinis)}`)
  if (panels.cardMinis && panels.cardMinis[1] !== 10) issues.push(`5 张手牌渲染异常 ${JSON.stringify(panels.cardMinis)}`)
  if (!panels.handFit5) issues.push('满手牌（5 张）越出角色卡边框')
  if (panels.playerInfoOther && !panels.tradeEntryInInfo) issues.push('他人档案里没有「发起交易」入口')
  if (!panels.buyEnabled) issues.push('awaitBuy 阶段「购买」按钮不可用')
  if (panels.buyVisibleInBuy === false) issues.push('awaitBuy 阶段第二行未切换为「购买|放弃」')
  if (!panels.afterResize || panels.afterResize.logBottom > panels.afterResize.panelBottom) issues.push('缩放后布局异常')

  await page.close()
  return { size: `${W}x${H}`, geo, panels, issues, errors }
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let bad = 0
  for (const size of SIZES) {
    const r = await run(size, browser)
    const ok = r.issues.length === 0 && r.errors.length === 0
    if (!ok) bad++
    console.log(`\n=== ${r.size} === ${ok ? 'PASS' : 'FAIL'}`)
    console.log('  geo:', JSON.stringify(r.geo))
    console.log('  panels:', JSON.stringify(r.panels))
    if (r.issues.length) console.log('  issues:', r.issues.join(' | '))
    if (r.errors.length) console.log('  errors:', r.errors.slice(0, 4).join(' | '))
  }
  await browser.close()
  console.log(`\n结果：${SIZES.length - bad}/${SIZES.length} 通过`)
  process.exit(bad ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
