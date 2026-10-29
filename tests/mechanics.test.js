// 游戏机制深度测试：经济平衡 / 租金结算 / 垄断加成 / 胜利判定 / 升级与破产清算
// 用法：node tests/mechanics.test.js
import {
  createGame, roll, buy, declineBuy, endTurn, upgrade,
  getCurrentPlayer, useSkill, useFruit, useHaki,
  confirmFruitTarget, cancelTarget, decisionReroll, decisionEventCancel,
  decisionTrade, finalVoyage, getHistoryIds, settleDebt, maskedStateFor, __test__
} from '../shared/engine.js'
import { aiStep } from '../shared/aiPlayer.js'
import { ISLAND_BY_ID, ECONOMY, MONOPOLY_GROUPS, EVENTS, EVENT_BY_ID, CHARACTER_BY_ID, BOARD } from '../shared/gameData.js'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg) }
  else { failed++; console.log('  ✗', msg) }
}
function mkGame(n = 4) {
  const chars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  return createGame(Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, charId: chars[i], tokenIndex: i })))
}
// 强制把玩家传送到指定格（模拟走到某格）
function teleport(g, pid, pos) { g.players[pid].position = pos }
// 直接置为某人回合
function setTurn(g, pid) {
  g.current = pid
  g.phase = 'awaitRoll'
}

// ========== 1. 数值一致性 ==========
console.log('=== 1. 配置数值一致性 ===')
{
  let ok = true
  for (const isl of Object.values(ISLAND_BY_ID)) {
    if (isl.rent.length !== 4) ok = false
    if (isl.rent[3] / isl.price < 2 || isl.rent[3] / isl.price > 3.5) ok = false
    if (isl.upgradeCost >= isl.price) ok = false
  }
  assert(ok, '22 座岛：租金 4 级 / Lv3 租金为价格 2~3.5 倍 / 升级费低于购置价')
  // 垄断组引用完整性
  let gok = true
  for (const grp of MONOPOLY_GROUPS) {
    for (const id of grp.islandIds) {
      if (!ISLAND_BY_ID[id] || ISLAND_BY_ID[id].group !== grp.id) gok = false
    }
  }
  const grouped = new Set(MONOPOLY_GROUPS.flatMap((g) => g.islandIds))
  for (const id of Object.keys(ISLAND_BY_ID)) {
    if (!grouped.has(Number(id))) gok = false
  }
  assert(gok, '7 个垄断组覆盖全部 22 座岛且引用一致')
}

// ========== 2. 租金结算 ==========
console.log('\n=== 2. 租金结算 ===')
{
  const g = mkGame(2)
  // 玩家1 拥有岛1（谢尔兹镇，基础租金10）
  g.islandState[1] = { ownerId: 1, level: 0 }
  // 玩家0 走到第1格
  teleport(g, 0, 39)
  setTurn(g, 0)
  // 控制骰子：直接把玩家放到岛前并掷出恰好步数不可控 → 改为直接触发结算路径
  // 走 roll 前先记录现金
  const before = g.players[0].cash
  // 玩家0 从 39 出发掷骰，经过起点领经费，若停在岛1则净变化 = +200(经费) - 10(租金)
  let hitTested = false
  for (let t = 0; t < 200 && !hitTested; t++) {
    const g2 = mkGame(2)
    g2.islandState[1] = { ownerId: 1, level: 0 }
    teleport(g2, 0, 39)
    setTurn(g2, 0)
    const r = roll(g2)
    if (g2.players[0].position === 1 && r.status !== 'jailed') {
      const p0cash = g2.players[0].cash
      const salary = ECONOMY.GO_SALARY
      assert(p0cash === 2000 + salary - 10, `过起点+200、缴租-10，净 +${salary - 10}（实际 ${p0cash - 2000}）`)
      assert(g2.players[1].cash === 2000 + 10, `岛主收租 10`)
      hitTested = true
    }
  }
  assert(hitTested, '200 次内复现停在他人岛屿')

  // Lv.3 租金 + 垄断加成
  const g3 = mkGame(2)
  g3.islandState[1] = { ownerId: 1, level: 3 }
  g3.islandState[2] = { ownerId: 1, level: 0 }
  g3.islandState[3] = { ownerId: 1, level: 0 }
  // g1 = 岛1,2,3 全归玩家1 → 垄断达成
  teleport(g3, 0, 39)
  setTurn(g3, 0)
  for (let t = 0; t < 300; t++) {
    const r = roll(g3)
    if (g3.players[0].position === 1) {
      // 垄断 ×1.5：200 * 1.5 = 300
      assert(g3.players[0].cash === 2000 + ECONOMY.GO_SALARY - 300, `垄断 Lv.3 租金 300（过起点+200：实际 ${g3.players[0].cash - 2000}）`)
      break
    }
    if (g3.phase === 'awaitRoll') { setTurn(g3, 0) }
    else if (g3.phase === 'awaitAction') endTurn(g3)
  }
}

// ========== 3. 升级 ==========
console.log('\n=== 3. 升级 ===')
{
  const g = mkGame(2)
  g.islandState[1] = { ownerId: 0, level: 0 }
  teleport(g, 0, 1) // 站在自己的岛上
  setTurn(g, 0)
  roll(g) // 走完掷骰进 awaitAction（位置可能变了）
  // 强制站回岛1：直接改 position 再 endTurn 后再来一轮太绕 → 用 engine 语义：升级只需 phase=awaitAction 且当前玩家站在岛上
  const g2 = mkGame(2)
  g2.islandState[1] = { ownerId: 0, level: 0 }
  teleport(g2, 0, 1)
  setTurn(g2, 0)
  // 掷骰可能走开 → 不调用 roll，直接进入 awaitAction 状态模拟已掷完
  g2.phase = 'awaitAction'
  const cashBefore = g2.players[0].cash
  const upCost = ISLAND_BY_ID[1].upgradeCost // 40
  const r = upgrade(g2, 1)
  assert(!r.error, '升级成功')
  assert(g2.islandState[1].level === 1, '等级 0→1')
  assert(g2.players[0].cash === cashBefore - upCost, `扣升级费 ${upCost}`)
  // 再升到 Lv3 后租金 200
  g2.players[0].cash = 5000
  upgrade(g2, 1); upgrade(g2, 1)
  assert(g2.islandState[1].level === 3, '升到 Lv.3 上限')
  const r4 = upgrade(g2, 1)
  assert(r4.error, 'Lv.3 不能继续升级')
  // 别人的岛不能升
  const r5 = upgrade(g2, 2)
  assert(r5.error, '不能升级别人的岛')
}

// ========== 4. 破产清算 ==========
console.log('\n=== 4. 破产清算 ===')
{
  const g = mkGame(2)
  // 玩家1 拥有岛1 Lv.2，玩家0 现金只有 5，停在岛1 → 租金 80 承担不起 → 变卖
  g.players[0].cash = 5
  g.islandState[1] = { ownerId: 1, level: 2 }
  teleport(g, 0, 0)
  setTurn(g, 0)
  for (let t = 0; t < 300; t++) {
    const r = roll(g)
    if (g.players[0].position === 1) {
      assert(g.players[0].bankrupt === true, '付不起租金 → 破产')
      assert(g.islandState[1].ownerId === null, '破产变卖：岛屿回到无主')
      assert(g.players[1].cash > 2000, '岛主收到变卖+租金所得')
      break
    }
    if (g.phase === 'awaitRoll') setTurn(g, 0)
    else if (g.phase === 'awaitAction') endTurn(g)
  }
}

// ========== 5. 胜利判定 ==========
console.log('\n=== 5. 胜利判定 ===')
{
  // 破产胜利：3人局淘汰2人
  const g = mkGame(3)
  g.players[1].bankrupt = true
  g.players[2].bankrupt = true
  // 触发 endTurn 走 checkWinner
  g.phase = 'awaitAction'
  endTurn(g)
  assert(g.phase === 'ended' && g.winner && g.winner.id === 0, '只剩1人 → 破产胜利判定')

  // 拉夫德鲁胜利：4 块历史正文
  const g2 = mkGame(2)
  const p = g2.players[0]
  // 塞 4 块历史正文进手牌
  for (let h = 1; h <= 4; h++) p.hand.push({ uid: `h${h}`, kind: 'history', historyId: h })
  p.position = 20 // 拉夫德鲁格
  setTurn(g2, 0)
  const r = roll(g2)
  // 掷骰会走开……拉夫德鲁判定在「停在 20 格」时触发：用循环
  let laughOk = false
  for (let t = 0; t < 400 && !laughOk; t++) {
    const g3 = mkGame(2)
    const pp = g3.players[0]
    for (let h = 1; h <= 4; h++) pp.hand.push({ uid: `h${h}`, kind: 'history', historyId: h })
    teleport(g3, 0, 18)
    setTurn(g3, 0)
    const rr = roll(g3)
    if (g3.players[0].position === 20 && rr.status !== 'jailed') {
      laughOk = g3.phase === 'ended' && g3.winner && g3.winner.id === 0
    }
  }
  assert(laughOk, '带 4 块正文停拉夫德鲁 → 胜利')
  // 不足 4 块不胜利
  let notWin = true
  for (let t = 0; t < 200 && notWin; t++) {
    const g4 = mkGame(2)
    const pp = g4.players[0]
    pp.hand.push({ uid: 'h1', kind: 'history', historyId: 1 })
    teleport(g4, 0, 18)
    setTurn(g4, 0)
    const rr = roll(g4)
    if (g4.players[0].position === 20 && rr.status !== 'jailed') {
      notWin = g4.phase !== 'ended'
    }
  }
  assert(notWin, '不足 4 块 → 不触发胜利')
}

// ========== 6. 经济平衡：500 局自动对战统计 ==========
console.log('\n=== 6. 经济平衡统计（500 局） ===')
{
  let crash = 0, winBankrupt = 0, winLaugh = 0
  const turnCounts = []
  let totalRentPaid = 0
  for (let trial = 0; trial < 500; trial++) {
    try {
      const g = mkGame(4)
      let safety = 0
      let rentSum = 0
      while (!g.winner && safety < 3000) {
        safety++
        const before = g.players.map((p) => p.cash)
        aiStep(g)
        // 粗略累计净转移（现金守恒检查）
        const after = g.players.map((p) => p.cash)
        // 现金守恒：总和变化只应来自起点经费/税收/港口等系统收支
        if (g.winner) break
      }
      if (safety >= 3000) crash++
      turnCounts.push(g.turn)
      if (g.winner) {
        if (g.winner.id != null && g.players.filter((p) => p.bankrupt).length >= 3) winBankrupt++
        else winLaugh++
      }
    } catch (e) { crash++; if (crash <= 2) console.log('  崩溃:', e.message) }
  }
  assert(crash === 0, '500 局无崩溃/无卡死')
  const avgTurn = Math.round(turnCounts.reduce((a, b) => a + b, 0) / turnCounts.length)
  const maxTurn = Math.max(...turnCounts)
  const minTurn = Math.min(...turnCounts)
  console.log(`  平均回合数: ${avgTurn}（最短 ${minTurn} / 最长 ${maxTurn}）`)
  assert(avgTurn < 200, '平均对局 < 200 回合（不至于拖沓）')
  assert(winBankrupt > winLaugh, `破产结算为主（破产 ${winBankrupt} / 拉夫德鲁 ${winLaugh}）→ 租金曲线有杀伤力`)
  // 现金守恒抽查：最后一局已结束无法检查，改为中途快照
}

// ========== 7. 现金守恒（系统外零增发） ==========
console.log('\n=== 7. 现金守恒 ===')
{
  // (a) 玩家间租金：只在玩家之间转手，总额必须守恒
  {
    const g = mkGame(2)
    const [a, b] = g.players
    a.cash = 1000
    b.cash = 500
    const sumBefore = a.cash + b.cash
    settleDebt(g, a, 300, b, 'rent')
    assert(a.cash + b.cash === sumBefore, '(a) 玩家间租金转账：现金总额守恒')
  }
  // (b) 买岛：现金 → 岛屿资产，总资产守恒
  {
    const g = mkGame(2)
    const p = g.players[0]
    const isl = Object.values(ISLAND_BY_ID)[0]
    p.cash = 5000
    const total = (x) => x.cash + x.islandIds.reduce((s, id) => {
      const d = ISLAND_BY_ID[id]
      const st = g.islandState[id] || { level: 0 }
      return s + d.price + (st.level ?? 0) * d.upgradeCost
    }, 0)
    const before = total(p)
    p.cash -= isl.price
    p.islandIds.push(isl.id)
    g.islandState[isl.id] = { ownerId: p.id, level: 0 }
    assert(total(p) === before, '(b) 买岛：现金减少 = 岛屿账面值增加（总资产守恒）')
  }
  // (c) 随机对局抽检：排除「破产清零」与「岛屿买卖/升级（资产↔现金）」两类合法变动后，
  //     单步现金总和的波动只应来自起点 +200 / 港口 +80 / 税收 / 事件卡（±500 以内）
  {
    const islandSig = (x) => JSON.stringify(x.islandState)
    let violations = 0, steps = 0, maxDelta = 0
    for (let t = 0; t < 20; t++) {
      const g = mkGame(4)
      let safety = 0
      while (!g.winner && safety < 400) {
        safety++
        const sumBefore = g.players.reduce((a, p) => a + p.cash, 0)
        const bankBefore = g.players.filter((p) => p.bankrupt).length
        const sigBefore = islandSig(g)
        aiStep(g)
        const bankAfter = g.players.filter((p) => p.bankrupt).length
        if (bankAfter !== bankBefore || islandSig(g) !== sigBefore) continue
        steps++
        const delta = Math.abs(g.players.reduce((a, p) => a + p.cash, 0) - sumBefore)
        maxDelta = Math.max(maxDelta, delta)
        if (delta > 600) violations++
      }
    }
    assert(steps > 500 && violations === 0, `(c) ${steps} 步随机对局单步跳变 ≤600（实测最大 ${maxDelta}）`)
  }
}

// ========== 回归：见闻色取消负面事件（决策状态契约） ==========
// 曾经的 bug：引擎 modal 只下发 { type:'observationCancel', eventId }，
// 客户端却读 modal.event → undefined.name 抛错 → refresh() 中断，按钮全灰且无弹窗，整局软锁死。
console.log('\n=== 见闻色取消负面事件（决策状态契约） ===')
{
  const bad = EVENTS.filter((e) => e.kind === 'bad')
  const resolvable = bad.every((e) => {
    const ev = EVENT_BY_ID[e.id]
    return !!(ev && ev.name && ev.desc)
  })
  assert(resolvable, `${bad.length} 条负面事件均可由 modal.eventId 反查出 name/desc（客户端渲染契约）`)

  const g = mkGame(2)
  const p = getCurrentPlayer(g)
  p.hand.push({ uid: 'hk1', kind: 'haki', defId: 'observation' })
  g.phase = 'awaitEventCancel'
  g.modal = { type: 'observationCancel', eventId: 'evt_06' }
  const cashBefore = p.cash
  decisionEventCancel(g, true)
  assert(!p.hand.some((c) => c.defId === 'observation'), '取消：消耗见闻色霸气卡')
  assert(p.cash === cashBefore, '取消：不消耗贝利（代价是卡而非钱，与横幅文案一致）')
  assert(g.modal === null && g.phase === 'awaitAction', '取消：清空 modal 并回到 awaitAction')

  p.hand.push({ uid: 'hk2', kind: 'haki', defId: 'observation' })
  g.phase = 'awaitEventCancel'
  g.modal = { type: 'observationCancel', eventId: 'evt_10' }
  decisionEventCancel(g, false)
  assert(p.hand.some((c) => c.defId === 'observation'), '承受：保留见闻色霸气卡')
  assert(g.modal === null && g.phase === 'awaitAction', '承受：清空 modal 并回到 awaitAction')
}

// ========== 回归：玩家显示名＝角色名（唯一名字来源） ==========
// 曾经的体验问题：联机时卡片同时显示「自定义昵称（你）· 角色名」，
// 窄卡里挤成 12px、语义重复。现在引擎按 charId 取名，外部昵称一律忽略。
console.log('\n=== 玩家显示名＝角色名（唯一名字来源） ===')
{
  const g = createGame([
    { id: 0, name: '甚平51', charId: 6, tokenIndex: 5 },
    { id: 1, name: '罗宾71', charId: 7, tokenIndex: 6 },
    { id: 2, name: '自定义昵称', charId: 10, tokenIndex: 9 }
  ])
  const expected = ['乔巴', '罗宾', '甚平']
  assert(g.players.every((p, i) => p.name === expected[i]),
    '传入昵称被忽略，玩家名取自 charId 对应角色')
  assert(g.players.every((p) => p.name === CHARACTER_BY_ID[p.charId].name),
    '每位玩家 name 与 CHARACTER_BY_ID[charId].name 完全一致')
  assert(g.players.every((p) => !p.name.includes('51') && !p.name.includes('自定义')),
    '对局内不存在任何自定义昵称残留')
  // 非法 charId：不允许出现 undefined / 空名，回落传入值
  const g2 = createGame([{ id: 0, name: '兜底名', charId: 99 }])
  assert(g2.players[0].name === '兜底名', 'charId 非法时回落传入名，UI 不会出现空名')
}

// ========== 缺口B：见闻色「预览下一格」 ==========
console.log('\n=== 见闻色预览下一格（PRD §4.2） ===')
{
  const g = mkGame(2)
  setTurn(g, 0)
  g.phase = 'awaitAction'
  g.players[0].position = 0
  g.players[0].hand.push({ uid: 'obs1', kind: 'haki', defId: 'observation' })
  const r = useHaki(g, 'obs1', 'preview')
  assert(r.status === 'ok' && r.preview, 'action=preview 使用成功并返回 preview')
  assert(r.preview.position === 1, '预览位置 = 当前位置 + 1（40 格环形起点）')
  assert(r.preview.cell != null, 'preview 携带下一格数据（类型/岛 id）')
  assert(g.players[0].hand.length === 0, '见闻色卡被消耗')
  assert(g.players[0].cardsUsedThisTurn === 1, '占用本回合主动用卡次数')
  assert(g.modal && g.modal.type === 'preview', 'state.modal 记录 preview（供广播）')
  // 缺省 action 仍是「留给负面事件取消」，不消耗卡
  const g2 = mkGame(2)
  setTurn(g2, 0)
  g2.phase = 'awaitAction'
  g2.players[0].hand.push({ uid: 'obs2', kind: 'haki', defId: 'observation' })
  const r2 = useHaki(g2, 'obs2')
  assert(!!r2.error && g2.players[0].hand.length === 1, '缺省 action 不消耗卡（保留给取消负面事件）')
}

// ========== 缺口D：事件统计 ==========
console.log('\n=== 事件统计（PRD §9 结算界面） ===')
{
  const g = mkGame(2)
  setTurn(g, 0)
  const p0 = g.players[0]
  // 直接落事件格：找棋盘上第一个 event 格（resolveLanding 走 __test__ 导出）
  const idx = BOARD.findIndex((c) => c.type === 'event')
  g.players[0].position = idx
  g.phase = 'awaitAction'
  __test__.resolveLanding(g, p0)
  assert(p0.stats && p0.stats.eventsDrawn >= 1, '抽事件后 stats.eventsDrawn 累加')
  // 用果实 → cardsUsed 累加
  const g2 = mkGame(2)
  setTurn(g2, 0)
  g2.phase = 'awaitAction'
  g2.players[0].hand.push({ uid: 'q1', kind: 'fruit', defId: 'quake' })
  useFruit(g2, 'q1')
  assert(g2.players[0].stats && g2.players[0].stats.cardsUsed === 1, '用果实后 stats.cardsUsed 累加')
}

// ========== 缺口F：广播脱敏 ==========
console.log('\n=== 广播脱敏：对手果实/霸气不可见 ===')
{
  const g = mkGame(2)
  g.players[0].hand.push({ uid: 'a1', kind: 'fruit', defId: 'dark' }, { uid: 'a2', kind: 'haki', defId: 'armament' })
  g.players[1].hand.push(
    { uid: 'b1', kind: 'history', defId: 'history', historyId: 1 },
    { uid: 'b2', kind: 'fruit', defId: 'ice' }
  )
  const m = maskedStateFor(g, 0) // 座位0 视角
  const other = m.players[1]
  assert(other.hand.length === 2, '对手手牌数量不变（历史正文 + 1 张暗牌）')
  assert(other.hand.some((c) => c.kind === 'history' && c.historyId === 1), '历史正文保持公开（交易需要 historyId）')
  assert(other.hand.every((c) => c.kind !== 'fruit' && c.kind !== 'haki'), '对手的果实/霸气被隐藏（不泄露 kind）')
  assert(other.hand.filter((c) => c.kind === 'hidden').every((c) => c.defId === 'hidden'), '对手暗牌不泄露真实 defId')
  assert(m.players[0] === g.players[0], '自己的手牌保持全量')
  // 原始 state 不被污染（服务端 AI 与结算依赖真实手牌）
  assert(g.players[1].hand.some((c) => c.defId === 'ice'), '原始 state 未被修改')
  // 没有可隐藏内容时原样返回（避免无谓拷贝）
  const g3 = mkGame(2)
  g3.players[1].hand = []
  assert(maskedStateFor(g3, 0) === g3, '无暗牌时返回原 state')
}

// ========== 平衡性调整（2026-10-29，依据 tools/balance_sim.mjs 3000 局模拟） ==========
console.log('\n=== 平衡性调整：布鲁克免债上限 / 乌索普重掷 2 次 ===')
{
  const mkBrook = () => createGame([
    { id: 0, name: '', charId: 9, tokenIndex: 0 },
    { id: 1, name: '', charId: 1, tokenIndex: 1 }
  ])
  assert(ECONOMY.REVIVE_WAIVE_MAX === 400, '免债上限 400 来自 ECONOMY 单一数据源')
  const g = mkBrook()
  g.players[0].cash = 10
  assert(settleDebt(g, g.players[0], 400, null, 'rent').status === 'saved', '布鲁克：≤400 债务全额免除')
  g.players[0].cash = 0
  assert(settleDebt(g, g.players[0], 100, null, 'rent').status === 'bankrupt', '布鲁克：技能次数用完后照常破产')
  const g2 = mkBrook()
  g2.players[0].cash = 10
  const r2 = settleDebt(g2, g2.players[0], 600, null, 'rent')
  assert(r2.status === 'bankrupt' && g2.players[0].skillUsed === 1, '布鲁克：600 债务免 400 后剩余照常结算（上限生效）')
  // 乌索普：skillUses 1→2，第二次重掷后不再触发
  assert(CHARACTER_BY_ID[5].skillUses === 2, '乌索普狙击预判 skillUses = 2')
  const g3 = createGame([
    { id: 0, name: '', charId: 5, tokenIndex: 0 },
    { id: 1, name: '', charId: 1, tokenIndex: 1 }
  ])
  setTurn(g3, 0)
  assert(roll(g3).status === 'awaitReroll' && getCurrentPlayer(g3).skillUsed === 0, '乌索普：第 1 次掷骰可重掷')
  decisionReroll(g3, false)
  assert(getCurrentPlayer(g3).skillUsed === 1, '乌索普：第 1 次重掷消耗后 skillUsed=1')
  setTurn(g3, 0)
  assert(roll(g3).status === 'awaitReroll', '乌索普：第 2 次掷骰仍可重掷')
  decisionReroll(g3, false)
  assert(getCurrentPlayer(g3).skillUsed === 2, '乌索普：第 2 次重掷后 skillUsed=2')
  setTurn(g3, 0)
  const r3 = roll(g3)
  // 次数用尽后不再进入重掷决策（status 可能是 ok/jailed 等，但绝不可能是 awaitReroll）
  assert(r3.status !== 'awaitReroll' && getCurrentPlayer(g3).skillUsed === 2, '乌索普：次数用尽后掷骰直接生效（不再询问重掷）')
  // 手术果实双落格终局守卫：先结算者破产致终局后，后结算者不再落格（phase 不被覆盖回决策态）
  // 换位后「使用者」先落到目标原位置结算：目标站在自己的高租岛上，使用者现金不足 → 破产终局
  const g4 = createGame([
    { id: 0, name: '', charId: 10, tokenIndex: 0 },
    { id: 1, name: '', charId: 4, tokenIndex: 1 }
  ])
  const p0 = g4.players[0]
  p0.cash = 10
  g4.islandState[3] = { ownerId: 1, level: 2 } // 西罗布村 lv2 租 120，岛主 = 目标
  const posVillage = BOARD.findIndex((c) => c.type === 'island' && c.islandId === 3)
  const posFree = BOARD.findIndex((c) => c.type === 'island' && c.islandId != null && g4.islandState[c.islandId].ownerId === null)
  p0.position = posFree       // 换位后目标落到这里（无主岛）——修复前这步会把 phase 覆盖回 awaitBuy
  g4.players[1].position = posVillage
  p0.hand.push({ uid: 'op1', kind: 'fruit', defId: 'op' })
  setTurn(g4, 0)              // 先手随机：固定使用者行动，否则 getCurrentPlayer 不是 p0
  g4.phase = 'awaitAction'
  useFruit(g4, 'op1')
  confirmFruitTarget(g4, 1)
  assert(g4.phase === 'ended' && g4.winner && g4.winner.id === 1, '手术果实：先结算者破产 → 终局，后结算者不落格')
  assert(g4.phase === 'ended', 'phase 保持 ended（不被覆盖为 awaitBuy，对局不卡死）')
}

console.log(`\n=== 结果：${passed} 通过, ${failed} 失败 ===`)
process.exit(failed > 0 ? 1 : 0)
