// 客户端交易弹窗验证：被交易方必须能自己「接受 / 拒绝」，不能自动成交
// 用法：node tools/verify_trade_modal_consent.cjs（需先起 vite:5173）
const { chromium } = require('playwright-core')
const fs = require('fs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL || 'http://localhost:5173/index.html'
const OUT = '/tmp/trade_shots'

let pass = 0
let fail = 0
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg, extra === undefined ? '' : JSON.stringify(extra)) }
}

// 在页面里布置一局「P0 向 P1 出价」的交易态（单机视角 = 玩家就是决策者）
async function placeOffer(page, { direction = 'sell', price = 250, p1Cash = 600, cardOwner = 0, historyId = 1, current = 0 } = {}) {
  return page.evaluate(({ direction, price, p1Cash, cardOwner, historyId, current }) => {
    const sc = window.__game.scene.getScene('BoardScene')
    const s = sc.state
    s.phase = 'awaitAction'
    s.current = current
    s.modal = null
    s.players[0].cash = 400
    s.players[1].cash = p1Cash
    for (const i of [0, 1]) s.players[i].hand = s.players[i].hand.filter((c) => c.kind !== 'history')
    s.players[cardOwner].hand.push({ uid: `h-ui-${historyId}`, kind: 'history', historyId })
    s.historyPieces[historyId].ownerId = cardOwner
    // 发起方 = 当前玩家，被交易方 = 另一人（卡始终在持有者 P0 手上）
    const target = 1 - current
    sc.doProposeTrade(target, historyId, price, direction)
    sc.refresh()
    return { phase: s.phase, cash: [s.players[0].cash, s.players[1].cash], from: s.modal && s.modal.fromId, target: s.modal && s.modal.targetId }
  }, { direction, price, p1Cash, cardOwner, historyId, current })
}

async function modalInfo(page) {
  return page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    if (!sc.modal) return { has: false, texts: [], btns: [] }
    const root = sc.modal.root
    const texts = []
    const btns = []
    const walk = (o) => {
      if (!o) return
      if (o.type === 'Text' && o.text) texts.push(o.text)
      if (o.list) o.list.forEach(walk)
    }
    walk(root)
    for (const child of root.list) {
      if (child.type === 'Container') {
        const label = (child.list || []).find((c) => c.type === 'Text')
        if (label) btns.push({ label: label.text, x: root.x + child.x, y: root.y + child.y })
      }
    }
    return { has: true, texts, btns, isTrade: !!sc.modal.isTrade }
  })
}

async function clickBtn(page, label) {
  // 弹窗刚创建的那一帧里 Phaser 还没处理 pointerdown，稍等一拍再点（纯测试时序，不影响玩法）
  await sleep(150)
  const info = await modalInfo(page)
  const b = info.btns.find((x) => x.label === label)
  if (!b) return { ok: false, labels: info.btns.map((x) => x.label) }
  await page.mouse.click(b.x, b.y)
  await sleep(350)
  return { ok: true }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: EXE })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(1800)

  console.log('=== 1. 对方卖给我：弹窗必须出现并等我决定 ===')
  const offer = await placeOffer(page)
  check(offer.phase === 'awaitTrade', '进入 awaitTrade 等待应答', offer.phase)
  check(offer.cash[1] === 600, '尚未扣钱（没有被自动成交）', offer.cash)
  const info = await modalInfo(page)
  check(info.has, '弹窗已出现')
  check(info.isTrade === true, '交易弹窗带最高优先级标记')
  check(info.texts.some((t) => t.includes('卖给你')), '文案说明「对方想把正文卖给你」', info.texts.slice(0, 2))
  check(info.texts.some((t) => t.includes('250')), '显示成交价 250')
  check(info.texts.some((t) => t.includes('/4')), '显示正文持有进度 x/4')
  check(info.texts.some((t) => t.includes('视为拒绝')), '提示 30 秒不回应视为拒绝')
  const labels = info.btns.map((b) => b.label)
  check(labels.includes('接受') && labels.includes('拒绝'), '按钮含「接受 / 拒绝」', labels)
  await page.screenshot({ path: `${OUT}/trade_offer.png`, clip: { x: 300, y: 150, width: 680, height: 430 } })

  console.log('\n=== 2. 点「拒绝」→ 取消，现金不动 ===')
  const rj = await clickBtn(page, '拒绝')
  check(rj.ok, '找到并点击「拒绝」', rj)
  const afterReject = await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene').state
    return {
      phase: s.phase, cash: s.players[1].cash,
      mine: s.players[1].hand.filter((c) => c.kind === 'history').length,
      log: s.log.map((l) => l.text || l)
    }
  })
  check(afterReject.phase === 'awaitAction', '回到行动阶段', afterReject.phase)
  check(afterReject.cash === 600, '现金未变', afterReject.cash)
  check(afterReject.mine === 0, '没有拿到正文', afterReject.mine)
  check(afterReject.log.some((t) => String(t).includes('交易被拒绝')), '日志记录「交易被拒绝」')

  console.log('\n=== 3. 点「接受」→ 才真正成交 ===')
  const offer2 = await placeOffer(page, { historyId: 2 })
  check(offer2.phase === 'awaitTrade', '第二次交易同样等待应答', offer2.phase)
  const ac = await clickBtn(page, '接受')
  check(ac.ok, '找到并点击「接受」', ac)
  const afterAccept = await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene').state
    return {
      phase: s.phase, cash: s.players[1].cash,
      mine: s.players[1].hand.filter((c) => c.kind === 'history').length,
      log: s.log.map((l) => l.text || l)
    }
  })
  check(afterAccept.phase === 'awaitAction', '成交后回到行动阶段', afterAccept.phase)
  check(afterAccept.cash === 350, '扣了 250 贝利', afterAccept.cash)
  check(afterAccept.mine === 1, '拿到一块正文', afterAccept.mine)
  check(afterAccept.log.some((t) => String(t).includes('购得一块路标历史正文')), '日志记录成交')

  console.log('\n=== 4. 现金不足：接受按钮置灰且点不动 ===')
  const poor = await placeOffer(page, { historyId: 3, p1Cash: 100 })
  check(poor.phase === 'awaitTrade', '不足额场景进入等待', poor.phase)
  const poorInfo = await modalInfo(page)
  const acceptBtn = poorInfo.btns.find((b) => b.label.includes('接受'))
  check(!!acceptBtn, '接受按钮存在（占位不移位）', poorInfo.btns.map((b) => b.label))
  check(acceptBtn && acceptBtn.label.includes('现金不足'), '按钮标注「现金不足」', acceptBtn && acceptBtn.label)
  await clickBtn(page, acceptBtn ? acceptBtn.label : '接受')
  await sleep(300)
  const stillWaiting = await page.evaluate(() => {
    const s = window.__game.scene.getScene('BoardScene').state
    return { phase: s.phase, cash: s.players[1].cash }
  })
  check(stillWaiting.phase === 'awaitTrade', '点击无效，交易仍在等待', stillWaiting.phase)
  check(stillWaiting.cash === 100, '现金未变', stillWaiting.cash)
  await page.screenshot({ path: `${OUT}/trade_poor.png`, clip: { x: 300, y: 150, width: 680, height: 430 } })

  console.log('\n=== 5. 对方买我的正文：方向文案正确 ===')
  // current=1（P1 是买家/发起方），target=P0（我，卖家）→ 我现金 400，卖 300 后变 700
  const buy = await placeOffer(page, { direction: 'buy', price: 300, cardOwner: 0, historyId: 4, current: 1 })
  check(buy.phase === 'awaitTrade', '收购方向同样进入等待', buy.phase)
  check(buy.target === 0, '被交易方是 P0（我）', buy)
  const buyInfo = await modalInfo(page)
  check(buyInfo.texts.some((t) => t.includes('想收购')), '文案为「想收购你的正文」', buyInfo.texts.slice(0, 2))
  check(buyInfo.texts.some((t) => t.includes('400 → 700')), '显示成交后现金 400→700', buyInfo.texts)
  await page.screenshot({ path: `${OUT}/trade_buyback.png`, clip: { x: 300, y: 150, width: 680, height: 430 } })

  check(errs.length === 0, '无运行时报错', errs)
  console.log(`\n通过 ${pass} / ${pass + fail}`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})()
