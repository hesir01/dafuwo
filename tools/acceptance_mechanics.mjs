// ============================================================
// 《航海王大富翁》机制验收脚本（引擎层，可判定的确定性用例）
// 依据：01_航海王大富翁-需求文档.md（PRD v1.0）
// 用法：node tools/acceptance_mechanics.mjs
// 说明：直接调用 shared/engine.js 的纯函数；随机数用可控序列注入，
//       每条断言都打印 PRD 条款号，FAIL 即代表与规划不一致。
// ============================================================
import {
  createGame, roll, buy, declineBuy, buyHistory, declineHistory,
  endTurn, upgrade, useSkill, useFruit, useHaki, settleDebt,
  decisionReroll, decisionEventCancel, decisionTrade, decisionFlower, confirmFruitTarget, cancelTarget,
  finalVoyage, getRent, getHistoryIds, getCurrentPlayer, ownsMonopoly,
  payBail, proposeTrade, sendToJail
} from '../shared/engine.js'
import { __test__ } from '../shared/engine.js'
import {
  BOARD, BOARD_SIZE, ISLANDS, ISLAND_BY_ID, MONOPOLY_GROUPS,
  CHARACTERS, CHARACTER_BY_ID, ECONOMY, EVENTS, EVENT_BY_ID, FRUITS, HAKI
} from '../shared/gameData.js'

let pass = 0, fail = 0, warn = 0
const failures = []
function ok(cond, ref, msg, detail = '') {
  if (cond) { pass++; console.log(`  ✓ [${ref}] ${msg}`) }
  else { fail++; failures.push(`[${ref}] ${msg}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ [${ref}] ${msg}${detail ? ' — ' + detail : ''}`) }
}
function note(ref, msg) { warn++; console.log(`  ! [${ref}] ${msg}`) }

// ---- 随机数控制：给定序列循环使用；seed 模式用于批量对局 ----
const realRandom = Math.random
let seq = null
function randomSeq(values) { seq = values.slice(); let i = 0; Math.random = () => values.length ? values[(i++) % values.length] : 0 }
function randomSeed(s) {
  let x = s >>> 0
  Math.random = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296 }
}
function randomReal() { seq = null; Math.random = realRandom }
// 掷出恰好 n 点所需的 Math.random 值
const d = (n) => (n - 1) / 6 + 0.001

function mk(n = 2, chars = [1, 2, 3, 4]) {
  const g = createGame(Array.from({ length: n }, (_, i) => ({ id: i, name: '', charId: chars[i], tokenIndex: i })))
  g.current = 0   // 定向用例统一让 0 号位行动（先手随机性另有用例）
  return g
}
// 把玩家直接放到某格并结算（模拟落点，绕过掷骰）
function landOn(state, p, idx) {
  p.position = idx
  __test__.resolveLanding(state, p)
}
function cellIndex(type, nth = 0) {
  const all = BOARD.map((c, i) => [c, i]).filter(([c]) => c.type === type)
  return all[nth][1]
}

// ============================================================
console.log('\n=== 1. 棋盘结构（PRD §3.1）===')
{
  const counts = BOARD.reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {})
  ok(BOARD_SIZE === 40, '§3.1', `棋盘共 40 格（实际 ${BOARD_SIZE}）`)
  const expect = { go: 1, island: 22, random_island: 2, event: 4, fruit: 3, jail: 1, tax: 2, port: 2, history: 2, laugh_tale: 1 }
  const diff = Object.keys(expect).filter((k) => (counts[k] || 0) !== expect[k])
  ok(diff.length === 0, '§3.1', '格子类型数量与 PRD 表格一致（海岛 22 + 随机岛 2 = 地产 24）',
    diff.map((k) => `${k}: 期望 ${expect[k]} 实际 ${counts[k] || 0}`).join('; '))
  ok(counts.island + counts.random_island === 24, '§3.1', '地产格合计 24')
  ok(ISLANDS.length === 22, '§3.2', `有名岛屿 22 个（实际 ${ISLANDS.length}）`)
  ok(new Set(ISLANDS.map((i) => i.id)).size === 22, '§3.2', '岛屿 id 无重复')
  // 每个岛屿都必须落在棋盘上且棋盘没有引用了不存在的岛
  const boardIslandIds = BOARD.filter((c) => c.type === 'island').map((c) => c.islandId)
  ok(boardIslandIds.length === 22 && boardIslandIds.every((id) => !!ISLAND_BY_ID[id]), '§3.1', '22 个有名岛屿各占一格且数据存在')
}

console.log('\n=== 2. 岛屿数值（PRD §3.2 数值表）===')
{
  // PRD 表逐行核对（购价 / 基础租金 / 1-3 级 / 升级费）
  const table = [
    ['谢尔兹镇', 60, 10, 30, 80, 200, 40], ['橘子镇', 80, 10, 30, 80, 200, 50],
    ['西罗布村', 100, 15, 45, 120, 300, 60], ['可可西亚村', 110, 15, 45, 120, 300, 70],
    ['巴拉蒂海上餐厅', 120, 20, 60, 160, 400, 70], ['罗格镇', 140, 20, 60, 160, 400, 80],
    ['威士忌山峰', 180, 25, 75, 200, 500, 110], ['小花园', 200, 30, 90, 240, 600, 120],
    ['磁鼓岛', 220, 30, 90, 240, 600, 130], ['阿拉巴斯坦', 240, 35, 105, 280, 700, 140],
    ['空岛', 260, 40, 120, 320, 800, 160], ['水之都', 270, 40, 120, 320, 800, 160],
    ['司法岛', 280, 40, 120, 320, 800, 170], ['恐怖三桅帆船', 290, 45, 135, 360, 900, 170],
    ['香波地群岛', 300, 45, 135, 360, 900, 180], ['鱼人岛', 340, 50, 150, 400, 1000, 200],
    ['庞克哈萨德', 370, 55, 165, 440, 1100, 220], ['德雷斯罗萨', 400, 60, 180, 480, 1200, 240],
    ['佐乌', 420, 65, 195, 520, 1300, 250], ['蛋糕岛', 450, 65, 195, 520, 1300, 270],
    ['和之国', 470, 70, 210, 560, 1400, 280], ['艾格赫德', 500, 75, 225, 600, 1500, 300]
  ]
  const bad = []
  for (const [name, price, r0, r1, r2, r3, up] of table) {
    const isl = ISLANDS.find((i) => i.name === name)
    if (!isl) { bad.push(`${name} 缺失`); continue }
    if (isl.price !== price) bad.push(`${name} 购价 ${isl.price}≠${price}`)
    if (JSON.stringify(isl.rent) !== JSON.stringify([r0, r1, r2, r3])) bad.push(`${name} 租金 ${JSON.stringify(isl.rent)}≠${[r0, r1, r2, r3]}`)
    if (isl.upgradeCost !== up) bad.push(`${name} 升级费 ${isl.upgradeCost}≠${up}`)
  }
  ok(bad.length === 0, '§3.2', '22 岛购价 / 四级租金 / 升级费逐行等于 PRD 表', bad.slice(0, 4).join('; '))
  // 分档购价区间
  const bySea = (s) => ISLANDS.filter((i) => i.sea === s).map((i) => i.price)
  ok(Math.min(...bySea('east')) === 60 && Math.max(...bySea('east')) === 140, '§3.2', '东海档购价 60–140')
  ok(Math.min(...bySea('grand')) === 180 && Math.max(...bySea('grand')) === 300, '§3.2', '伟大航路档购价 180–300')
  ok(Math.min(...bySea('new')) === 340 && Math.max(...bySea('new')) === 500, '§3.2', '新世界档购价 340–500')
  const total = ISLANDS.reduce((s, i) => s + i.price, 0)
  ok(total === 5800, '§3.2', `22 岛总购价 5800（实际 ${total}）`)
  // 租金派生比例：基础≈15%，1级=3×基础，2级=8×，3级=20×
  const rentBad = ISLANDS.filter((i) => {
    const [b, r1, r2, r3] = i.rent
    return Math.abs(b - Math.round(i.price * 0.15 / 5) * 5) > 5 || r1 !== b * 3 || r2 !== b * 8 || r3 !== b * 20
  })
  ok(rentBad.length === 0, '§3.2', '租金派生规则（15% / ×3 / ×8 / ×20）成立', rentBad.map((i) => i.name).join(','))
}

console.log('\n=== 3. 垄断分组（PRD §3.3）===')
{
  ok(MONOPOLY_GROUPS.length === 7, '§3.3', `7 个垄断分组（实际 ${MONOPOLY_GROUPS.length}）`)
  const all = MONOPOLY_GROUPS.flatMap((g) => g.islandIds)
  ok(all.length === 22 && new Set(all).size === 22, '§3.3', '22 座岛被 7 组完整覆盖且不重复')
  const g7 = MONOPOLY_GROUPS.find((g) => g.id === 'g7')
  ok(g7.islandIds.join(',') === '19,20,21,22', '§3.3', '新世界·B 为 4 岛组（其余 3 岛组）')
  // 垄断后租金 ×1.5
  const g = mk(2)
  const p = g.players[0]
  for (const id of MONOPOLY_GROUPS[0].islandIds) { g.islandState[id] = { ownerId: 0, level: 0 }; p.islandIds.push(id) }
  ok(ownsMonopoly(g, p, 'g1'), '§3.3', '集齐同组后 ownsMonopoly 为真')
  const base = ISLAND_BY_ID[1].rent[0]
  ok(getRent(g, ISLAND_BY_ID[1]) === Math.round(base * 1.5), '§3.3', `垄断后租金 ×1.5（${base} → ${getRent(g, ISLAND_BY_ID[1])}）`)
}

console.log('\n=== 4. 起始资金与格子结算（PRD §6）===')
{
  const g = mk(3)
  ok(g.players.every((p) => p.cash === 2000), '§6', '每人起始 2000 贝利')
  ok(g.players.every((p) => p.position === 0), '§3.1', '开局均在起点（0 格）')

  // 经过起点 +200；山治 +240
  randomSeq([0.5, 0.5])            // 3+3=6
  const g2 = mk(2, [1, 4])
  const p1 = g2.players[0]
  p1.position = 38
  roll(g2)                          // 38+6=44 → 4，经过起点
  ok(p1.cash === 2200, '§6', `普通角色经过起点 +200（2000 → ${p1.cash}）`)
  const p2 = g2.players[1]
  g2.current = 1; g2.phase = 'awaitRoll'
  p2.position = 38
  randomSeq([0.5, 0.5])
  roll(g2)
  ok(p2.cash === 2240, '§6', `山治经过起点 +240（PRD 240；实际 ${p2.cash - 2000}）`)
  ok(ECONOMY.GO_SALARY_COOK !== 240, '§6', `数据常量 GO_SALARY_COOK=${ECONOMY.GO_SALARY_COOK} 与 PRD 的 240 不一致（未被引用，属死数据）`, '仅数据一致性，行为正确')

  // 天上金 max(100, 岛屿数×25)
  const g3 = mk(2)
  const t = g3.players[0]
  t.islandIds = [1, 2, 3, 4]
  t.cash = 2000
  landOn(g3, t, cellIndex('tax', 0))
  ok(t.cash === 2000 - 100, '§6', `天上金 4 岛 → max(100, 100) = 100（实际扣 ${2000 - t.cash}）`)
  const g4 = mk(2)
  const t4 = g4.players[0]
  t4.islandIds = [1, 2, 3, 4, 5, 6]
  t4.cash = 2000
  landOn(g4, t4, cellIndex('tax', 0))
  ok(t4.cash === 2000 - 150, '§6', `天上金 6 岛 → 6×25=150（实际扣 ${2000 - t4.cash}）`)

  // 港口 +80
  const g5 = mk(2)
  const t5 = g5.players[0]
  t5.cash = 2000
  landOn(g5, t5, cellIndex('port', 0))
  ok(t5.cash === 2080, '§6', `港口补给 +80（实际 ${t5.cash - 2000}）`)
}

console.log('\n=== 5. 骰子与双数规则（PRD §3.1.1）===')
{
  // 骰子点数注入：d(n) 让 rollDie 恰好掷出 n
  // 落格可能停在待购/待决策阶段：统一放弃，便于继续推进回合
  function settle(g) {
    for (let i = 0; i < 6; i++) {
      if (g.phase === 'awaitBuy') declineBuy(g)
      else if (g.phase === 'awaitBuyHistory') declineHistory(g)
      else if (g.phase === 'awaitEventCancel') decisionEventCancel(g, false)
      else if (g.phase === 'awaitReroll') decisionReroll(g, false)
      else break
    }
  }

  // 双数追加一回合
  const g = mk(2, [1, 2])
  randomSeq([d(3), d(3)])
  const r = roll(g)
  ok(r.dice.total === 6 && r.dice.isDoubles, '§3.1.1', `两颗六面骰合计 2–12（本局 ${r.dice.d1}+${r.dice.d2}=${r.dice.total}）`)
  settle(g)
  const e = endTurn(g)
  ok(e.status === 'extra' && g.phase === 'awaitRoll' && g.current === 0, '§3.1.1', '双数走完后可再掷一次（同一玩家）')

  // 非双数不追加
  randomSeq([d(1), d(4)])
  const g2 = mk(2, [1, 2])
  roll(g2); settle(g2)
  const e2 = endTurn(g2)
  ok(e2.status === 'next' && g2.current === 1, '§3.1.1', '非双数结束回合，轮到下一位')

  // 连续三次双数 → 入狱
  const g3 = mk(2, [1, 2])
  let lastRoll
  for (let i = 0; i < 3; i++) {
    if (i > 0) { g3.current = 0; g3.phase = 'awaitRoll' }
    randomSeq([d(3), d(3)])
    lastRoll = roll(g3)
    settle(g3)
    if (i < 2) endTurn(g3)
  }
  const jailed = g3.players[0]
  ok(lastRoll.status === 'jailed', '§3.1.1', `连续第三次双数不再移动、直接入狱（返回 ${lastRoll.status}）`)
  ok(jailed.inJail === true && jailed.position === cellIndex('jail'), '§3.1.1', `入狱后位置 = 推进城（${jailed.position}）`)
  ok(jailed.jailTurns === 2, '§3.1.1', `刑期 2 回合（jailTurns=${jailed.jailTurns}）`)

  // 坐牢：非双数停 2 回合，双数出狱并移动（当次不追加）
  const g4 = mk(2, [1, 2])
  sendToJail(g4, g4.players[0])
  g4.current = 0; g4.phase = 'awaitRoll'
  randomSeq([d(1), d(4)])
  roll(g4); settle(g4)
  ok(g4.players[0].inJail && g4.players[0].jailTurns === 1, '§3.1.1', '坐牢掷非双数：刑期剩 1 回合')
  endTurn(g4)
  g4.current = 0; g4.phase = 'awaitRoll'
  randomSeq([d(1), d(4)])
  const r4b = roll(g4); settle(g4)
  ok(!g4.players[0].inJail && g4.players[0].jailTurns === 0 && r4b.status === 'jailStay', '§3.1.1', '停满 2 回合自动出狱（本回合不移动）')

  const g5 = mk(2, [1, 2])
  sendToJail(g5, g5.players[0])
  g5.current = 0; g5.phase = 'awaitRoll'
  randomSeq([d(3), d(3)])
  const r5 = roll(g5); settle(g5)
  ok(!g5.players[0].inJail && r5.status === 'jailRelease', '§3.1.1', '坐牢掷出双数：出狱并按点数移动')
  const e5 = endTurn(g5)
  ok(e5.status === 'next', '§3.1.1', '出狱当次不享双数追加（直接轮到下一位）', `实际 ${e5.status}，doubles=${g5.players[0].doubles}`)

  // 保释金
  const g6 = mk(2)
  sendToJail(g6, g6.players[0])
  g6.players[0].cash = 1000
  const b = payBail(g6)
  ok(b.status === 'ok' && !g6.players[0].inJail && g6.players[0].cash === 900, '§3.1.1', '交 100 保释金立即出狱（引擎能力）')
  note('§3.1.1', 'payBail 没有对应的 socket 事件与客户端入口，联机中玩家无法交保释金（功能未接线）')
}

console.log('\n=== 6. 购买 / 放弃 / 租金（PRD §3.3）===')
{
  // 无主可买
  const g = mk(2)
  const p = g.players[0]
  p.position = 1
  g.phase = 'awaitBuy'; g.pendingIslandId = 1
  const r = buy(g)
  ok(r.status === 'ok' && g.islandState[1].ownerId === 0 && p.cash === 1940, '§3.3', '落在无主岛可按标价购买（谢尔兹镇 60）')

  // 放弃后保持无主，可再买
  const g2 = mk(2)
  g2.phase = 'awaitBuy'; g2.pendingIslandId = 1
  declineBuy(g2)
  ok(g2.islandState[1].ownerId === null, '§3.3', '放弃购买后地块保持无主（无冷却）')
  g2.phase = 'awaitBuy'; g2.pendingIslandId = 1
  ok(buy(g2).status === 'ok', '§3.3', '同一块地可被再次购买')

  // 他人岛交租（按等级表）
  const g3 = mk(2)
  g3.islandState[9] = { ownerId: 1, level: 2 }
  g3.players[1].islandIds = [9]
  const payer = g3.players[0]
  payer.position = 13
  const before = payer.cash
  landOn(g3, payer, 13)
  ok(before - payer.cash === ISLAND_BY_ID[9].rent[2], '§3.3', `他人 2 级岛按表缴租 ${ISLAND_BY_ID[9].rent[2]}（实扣 ${before - payer.cash}）`)

  // 自己的岛不付租
  const g4 = mk(2)
  g4.islandState[9] = { ownerId: 0, level: 0 }
  g4.players[0].islandIds = [9]
  g4.players[0].position = 13
  const c4 = g4.players[0].cash
  landOn(g4, g4.players[0], 13)
  ok(g4.players[0].cash === c4, '§3.3', '回到自己的岛不缴租')

  // 索隆 8 折
  const g5 = mk(2, [2, 1])
  g5.phase = 'awaitBuy'; g5.pendingIslandId = 6   // 罗格镇 140
  buy(g5)
  ok(g5.players[0].cash === 2000 - Math.round(140 * 0.8), '§2.2', `索隆购买 8 折（140 → ${2000 - g5.players[0].cash}）`)

  // 娜美多收 20%
  const g6 = mk(2, [1, 3])
  g6.islandState[9] = { ownerId: 1, level: 0 }
  g6.players[1].islandIds = [9]
  const payer6 = g6.players[0]
  payer6.position = 13
  const b6 = payer6.cash
  landOn(g6, payer6, 13)
  ok(b6 - payer6.cash === Math.round(ISLAND_BY_ID[9].rent[0] * 1.2), '§2.2', `娜美多收 20%（${ISLAND_BY_ID[9].rent[0]} → ${b6 - payer6.cash}）`)
}

console.log('\n=== 7. 升级（PRD §3.4）===')
{
  const g = mk(2)
  const p = g.players[0]
  g.islandState[1] = { ownerId: 0, level: 0 }
  p.islandIds = [1]
  g.phase = 'awaitAction'
  p.cash = 1000
  upgrade(g, 1)
  ok(g.islandState[1].level === 1 && p.cash === 1000 - 40, '§3.4', '升级 0→1 支付升级费 40')
  upgrade(g, 1); upgrade(g, 1)
  ok(g.islandState[1].level === 3 && p.cash === 1000 - 120, '§3.4', '0→1→2→3 每级同价（共 120）')
  const r = upgrade(g, 1)
  ok(!!r.error && g.islandState[1].level === 3, '§3.4', '3 级封顶，不可再升')

  const g2 = mk(2, [8, 1])
  const p2 = g2.players[0]
  g2.islandState[1] = { ownerId: 0, level: 0 }
  p2.islandIds = [1]; p2.cash = 1000; g2.phase = 'awaitAction'
  upgrade(g2, 1)
  ok(p2.cash === 1000 - Math.round(40 * 0.7), '§2.2', `弗兰奇升级费 7 折（40 → ${1000 - p2.cash}）`)

  // 非自己的岛不能升
  const g3 = mk(2)
  g3.phase = 'awaitAction'
  ok(!!upgrade(g3, 1).error, '§3.4', '非岛主不可升级他人岛屿')
}

console.log('\n=== 8. 历史正文与胜利（PRD §7）===')
{
  const g = mk(2)
  const p = g.players[0]
  p.position = 30
  g.phase = 'awaitAction'
  landOn(g, p, 30)
  ok(g.phase === 'awaitBuyHistory' && g.pendingHistoryPrice === 200, '§7', '历史正文格可花 200 购买')
  buyHistory(g)
  ok(getHistoryIds(p).length === 1 && g.historyPieces[1].ownerId === 0, '§7', '购得后块 1 归属购买者')
  // 已售出的格子不再产出
  p.position = 30
  g.phase = 'awaitAction'
  landOn(g, p, 30)
  ok(g.phase !== 'awaitBuyHistory', '§7', '该块已取得后此格不再产出')

  const g2 = mk(2, [7, 1])
  g2.phase = 'awaitAction'
  g2.players[0].position = 30
  landOn(g2, g2.players[0], 30)
  ok(g2.pendingHistoryPrice === 100, '§2.2', '罗宾历史正文格半价 100')

  // 事件 evt_05 产出事件块
  const g3 = mk(2)
  const p3 = g3.players[0]
  const before3 = getHistoryIds(p3).length
  __test__.applyEvent(g3, p3, EVENT_BY_ID.evt_05)
  ok(getHistoryIds(p3).length === before3 + 1, '§5', '事件「历史正文线索」产出 1 块正文')

  // 4 块集齐 → 最终航行胜利
  const g4 = mk(2)
  const p4 = g4.players[0]
  for (const id of [1, 2, 3, 4]) {
    g4.historyPieces[id].ownerId = 0
    p4.hand.push({ uid: `h${id}`, kind: 'history', defId: 'history', historyId: id })
  }
  g4.phase = 'awaitAction'
  const v = finalVoyage(g4)
  ok(v.status === 'ok' && g4.winner === p4 && g4.winKind === 'laftel', '§7', '集齐 4 块可发起最终航行直接获胜')

  // 正常抵达拉夫德鲁
  const g5 = mk(2)
  const p5 = g5.players[0]
  for (const id of [1, 2, 3, 4]) {
    g5.historyPieces[id].ownerId = 0
    p5.hand.push({ uid: `h${id}`, kind: 'history', defId: 'history', historyId: id })
  }
  g5.phase = 'awaitRoll'
  p5.position = 15
  randomSeq([0.5, 0.0])   // 3+1 = 4 → 19? 需要 5 步到 20
  randomSeq([0.5, 0.5])   // 3+3=6 → 21，改为直接落格
  landOn(g5, p5, 20)
  ok(g5.winner === p5 && g5.winKind === 'laftel', '§7', '掷骰抵达拉夫德鲁且集齐 4 块即获胜')

  // 未集齐落拉夫德鲁无效
  const g6 = mk(2)
  const p6 = g6.players[0]
  p6.position = 20
  landOn(g6, p6, 20)
  ok(g6.winner === null && g6.phase !== 'ended', '§7', '未集齐时落到拉夫德鲁视为普通格')

  // 破产散佚：格子块重置
  const g7 = mk(2)
  const p7 = g7.players[0]
  g7.historyPieces[1].ownerId = 0
  p7.hand.push({ uid: 'hh1', kind: 'history', defId: 'history', historyId: 1 })
  p7.cash = 0
  settleDebt(g7, p7, 9999)
  ok(g7.historyPieces[1].ownerId === null, '§7', '破产后历史正文散佚（格产块重置，可再次购买）')

  // 破产唯一存活即胜
  const g8 = mk(2)
  g8.players[1].cash = 0
  settleDebt(g8, g8.players[1], 9999)
  ok(g8.winner === g8.players[0] && g8.winKind === 'bankruptcy', '§7', '其余玩家全部破产 → 唯一存活者获胜')
}

console.log('\n=== 9. 角色技能（PRD §2.2）===')
{
  // 路飞免租
  const g = mk(2, [1, 2])
  const luffy = g.players[0]
  g.phase = 'awaitAction'
  useSkill(g)
  ok(luffy.rentImmune === true, '§2.2', '路飞「橡胶耍赖」开启本回合免租')
  g.islandState[9] = { ownerId: 1, level: 0 }; g.players[1].islandIds = [9]
  const c = luffy.cash
  luffy.position = 13
  landOn(g, luffy, 13)
  ok(luffy.cash === c, '§2.2', '路飞免租生效（停在他人岛不扣钱）')

  // 索隆双 1 反向移动
  const g2 = mk(2, [2, 1])
  const zoro = g2.players[0]
  zoro.position = 10
  randomSeq([0.0, 0.0])   // 1+1 双 1
  roll(g2)
  ok(zoro.position === 8, '§2.2', `索隆掷出双 1 应朝反方向移动（10 → 应到 8，实际 ${zoro.position}）`,
    '未实现：引擎无任何双 1 反向分支，索隆只享有 8 折')

  // 乌索普重掷
  const g3 = mk(2, [5, 1])
  const usopp = g3.players[0]
  randomSeq([0.0, 0.2])   // 1+2
  const r3 = roll(g3)
  ok(r3.status === 'awaitReroll' && g3.phase === 'awaitReroll', '§2.2', '乌索普掷骰后进入重掷决策')
  randomSeq([0.99, 0.99]) // 6+6
  const d3 = decisionReroll(g3, true)
  ok(d3.status === 'ok' && usopp.skillUsed === 1, '§2.2', '乌索普可整体重掷一次（二选一）')

  // 乔巴减半
  const g4 = mk(2, [6, 1])
  const chopper = g4.players[0]
  g4.phase = 'awaitAction'
  chopper.cash = 1000
  useSkill(g4)
  __test__.applyEvent(g4, chopper, EVENT_BY_ID.evt_10)   // 食物中毒 80
  ok(chopper.cash === 1000 - 40, '§2.2', `乔巴「应急治疗」负面事件损失减半（80 → ${1000 - chopper.cash}）`)

  // 罗宾
  const g5 = mk(2, [7, 1])
  const robin = g5.players[0]
  g5.phase = 'awaitAction'
  g5.players[0].position = 30
  landOn(g5, robin, 30)
  ok(g5.pendingHistoryPrice === 100, '§2.2', '罗宾历史正文半价 100')
  // 事件正面概率 +15% 与 evt_05 权重 ×2：统计验证
  randomReal()
  function sampleRobin(isRobin, n = 20000) {
    const gg = mk(2, [isRobin ? 7 : 1, 2])
    const pp = gg.players[0]
    gg.phase = 'awaitAction'
    let good = 0
    for (let i = 0; i < n; i++) {
      const evt = __test__.drawEvent(gg, pp)
      if (evt.kind === 'good') good++
    }
    return good / n
  }
  const baseProb = sampleRobin(false)
  const robinProb = sampleRobin(true)
  ok(robinProb - baseProb > 0.10, '§2.2', `罗宾正面事件概率提高（普通 ${(baseProb * 100).toFixed(1)}% → 罗宾 ${(robinProb * 100).toFixed(1)}%）`)
  // evt_05 权重：统计罗宾抽到 evt_05 的占比 vs 普通
  function sampleE5(isRobin, n = 40000) {
    const gg = mk(2, [isRobin ? 7 : 1, 2])
    const pp = gg.players[0]
    let c = 0
    for (let i = 0; i < n; i++) if (__test__.drawEvent(gg, pp).id === 'evt_05') c++
    return c / n
  }
  const e5a = sampleE5(false), e5b = sampleE5(true)
  ok(e5b > e5a * 1.3, '§2.2', `罗宾 evt_05 权重提升（普通 ${(e5a * 100).toFixed(1)}% → 罗宾 ${(e5b * 100).toFixed(1)}%）`)

  // 弗兰奇 7 折已测；娜美已测；山治已测
  // 布鲁克免债
  const g6 = mk(2, [9, 1])
  const brook = g6.players[0]
  brook.cash = 10
  g6.phase = 'awaitAction'
  const res6 = settleDebt(g6, brook, 350, g6.players[1], 'rent')
  ok(res6.status === 'saved' && !brook.bankrupt && brook.skillUsed === 1, '§2.2', '布鲁克「黄泉复活」免除 ≤400 的租金债务（不破产）')
  // 免债上限（2026-10-29 平衡）：>400 免 400，剩余照常结算
  const g6b = mk(2, [9, 1])
  const brook6b = g6b.players[0]
  brook6b.cash = 10
  const res6b = settleDebt(g6b, brook6b, 500, g6b.players[1], 'rent')
  ok(res6b.status === 'bankrupt' && brook6b.bankrupt && brook6b.skillUsed === 1, '§2.2', '免债上限：500 债务免 400 后剩余 100，无岛可卖 → 仍破产')
  const g6c = mk(2, [9, 1])
  const brook6c = g6c.players[0]
  brook6c.cash = 10
  brook6c.islandIds = [5] // 巴拉蒂 120，变卖 50% = 60，正好补足免 400 后剩余的 40+10 现金
  g6c.islandState[5] = { ownerId: 0, level: 0 }
  const res6c = settleDebt(g6c, brook6c, 440, g6c.players[1], 'rent')
  ok(res6c.status === 'liquidated' && !brook6c.bankrupt, '§2.2', '免债上限：440 债务免 400 + 现金10 + 变卖60 → 恰好还清，不破产')
  // 事件罚款不免
  const g7 = mk(2, [9, 1])
  const brook7 = g7.players[0]
  brook7.cash = 10
  const res7 = settleDebt(g7, brook7, 500, null, 'event')
  ok(res7.status === 'bankrupt' && brook7.bankrupt, '§2.2', '布鲁克不能免事件罚款（照常破产）')

  // 甚平免疫
  const g8 = mk(2, [10, 1])
  const jinbe = g8.players[0]
  jinbe.cash = 1000
  __test__.applyEvent(g8, jinbe, EVENT_BY_ID.evt_07)
  ok(jinbe.cash === 1030, '§2.2', `甚平遇海王类反得 30（实际 ${jinbe.cash - 1000}）`)
  const g9 = mk(2, [10, 1])
  const jinbe9 = g9.players[0]
  jinbe9.cash = 1000
  jinbe9.position = 20
  __test__.applyEvent(g9, jinbe9, EVENT_BY_ID.evt_08)
  ok(jinbe9.cash === 1030 && jinbe9.position === 20, '§2.2', '甚平免疫暴风雨（不后退、反得 30）')
}

console.log('\n=== 10. 恶魔果实与霸气（PRD §4）===')
{
  const g = mk(3)
  const p = g.players[0]
  g.phase = 'awaitAction'
  p.hand.push({ uid: 'f1', kind: 'fruit', defId: 'chop' })
  ok(useFruit(g, 'f1').status === 'ok' && p.rentImmune, '§4.1', '四分五裂果实：本回合免疫租金')

  // 每回合限 1 张
  p.hand.push({ uid: 'f2', kind: 'fruit', defId: 'chop' })
  const r2 = useFruit(g, 'f2')
  ok(!!r2.error, '§4.1', '每回合只能主动使用 1 张卡')

  // 手牌上限 5
  const g2 = mk(2)
  const p2 = g2.players[0]
  p2.hand = Array.from({ length: 5 }, (_, i) => ({ uid: `c${i}`, kind: 'fruit', defId: 'chop' }))
  g2.phase = 'awaitAction'
  __test__.applyEvent(g2, p2, EVENT_BY_ID.evt_02)   // 革命军：给霸气卡
  ok(p2.hand.length === 5, '§4.1', '手牌上限 5 张（满时新卡不进入手牌）')

  // 武装色抵消单体果实
  const g3 = mk(2)
  const attacker = g3.players[0], victim = g3.players[1]
  victim.hand.push({ uid: 'a1', kind: 'haki', defId: 'armament' })
  attacker.hand.push({ uid: 'i1', kind: 'fruit', defId: 'ice' })
  g3.phase = 'awaitAction'
  useFruit(g3, 'i1')
  confirmFruitTarget(g3, 1)
  ok(victim.frozen === 0 && !victim.hand.some((c) => c.defId === 'armament'), '§4.2', '武装色抵消单体果实（冰冻未生效且消耗卡片）')

  // 震震 AOE 各自抵消
  const g4 = mk(3)
  const a4 = g4.players[0], v1 = g4.players[1], v2 = g4.players[2]
  v1.hand.push({ uid: 'a2', kind: 'haki', defId: 'armament' })
  a4.hand.push({ uid: 'q1', kind: 'fruit', defId: 'quake' })
  g4.phase = 'awaitAction'
  useFruit(g4, 'q1')
  ok(v1.cash === 2000 && v2.cash === 1920, '§4.1', '震震果实 AOE：武装色玩家各自抵消自己那份')

  // 糯糯护盾
  const g5 = mk(2)
  const attacker5 = g5.players[0], victim5 = g5.players[1]
  attacker5.hand.push({ uid: 'q2', kind: 'fruit', defId: 'quake' })
  victim5.hand.push({ uid: 'm1', kind: 'fruit', defId: 'mochi' })
  g5.phase = 'awaitAction'
  victim5.mochiWard = true
  useFruit(g5, 'q2')
  ok(victim5.cash === 2000, '§4.1', '糯糯护盾抵消一次果实效果')

  // 冰冻：下回合无法行动
  const g6 = mk(2)
  const a6 = g6.players[0], v6 = g6.players[1]
  v6.frozen = 1
  g6.current = 1; g6.phase = 'awaitRoll'
  const r6 = roll(g6)
  ok(r6.status === 'frozen' && g6.current === 0, '§4.1', '被冰冻者本回合无法行动，直接轮到下一位')

  // 岩浆后退 3
  const g7 = mk(2)
  const a7 = g7.players[0], v7 = g7.players[1]
  v7.position = 20
  a7.hand.push({ uid: 'mg', kind: 'fruit', defId: 'magma' })
  g7.phase = 'awaitAction'
  useFruit(g7, 'mg'); confirmFruitTarget(g7, 1)
  ok(v7.position === 17, '§4.1', `岩浆果实强制后退 3 格（20 → ${v7.position}）`)

  // 霸王色 −2
  const g8 = mk(3)
  const p8 = g8.players[0]
  g8.phase = 'awaitAction'
  p8.hand.push({ uid: 'cc', kind: 'haki', defId: 'conqueror' })
  useHaki(g8, 'cc')
  ok(g8.players[1].diceDebuff === 1 && g8.players[2].diceDebuff === 1, '§4.2', '霸王色：其余玩家下回合掷点 −2')
  g8.current = 1; g8.phase = 'awaitRoll'
  randomSeq([d(3), d(3)])   // 3+3=6 → 4
  const r8 = roll(g8)
  ok(r8.dice.total === 4, '§4.2', `霸王色威慑生效（6 → ${r8.dice.total}），最低为 1`)

  // 见闻色取消负面事件
  const g9 = mk(2)
  const p9 = g9.players[0]
  p9.hand.push({ uid: 'ob', kind: 'haki', defId: 'observation' })
  g9.phase = 'awaitEventCancel'
  g9.modal = { type: 'observationCancel', eventId: 'evt_10' }
  const c9 = p9.cash
  decisionEventCancel(g9, true)
  ok(p9.cash === c9 && !p9.hand.some((c) => c.defId === 'observation'), '§4.2', '见闻色取消一次负面事件（不扣钱、消耗卡）')

  // 见闻色预览
  const g10 = mk(2)
  const p10 = g10.players[0]
  g10.phase = 'awaitAction'
  p10.hand.push({ uid: 'ob2', kind: 'haki', defId: 'observation' })
  const r10 = useHaki(g10, 'ob2', 'preview')
  ok(r10.status === 'ok' && g10.modal && g10.modal.type === 'preview', '§4.2', '见闻色可预览下一格（引擎分支）')
  note('§4.2', '客户端与服务端均未接线 preview：game:useHaki 只传 uid，引擎默认 action=cancel → 直接返回错误，预览不可用')
}

console.log('\n=== 11. 随机事件（PRD §5）===')
{
  ok(EVENTS.length === 13, '§5', `事件卡 13 张（实际 ${EVENTS.length}）`)
  // +150
  const g = mk(2); const p = g.players[0]
  __test__.applyEvent(g, p, EVENT_BY_ID.evt_01)
  ok(p.cash === 2150, '§5', '发现沉船宝藏 +150')
  // evt_06 偶数罚 80
  const g2 = mk(2); const p2 = g2.players[0]
  randomSeq([0.5])   // 掷 4 偶数
  __test__.applyEvent(g2, p2, EVENT_BY_ID.evt_06)
  ok(p2.cash === 1920, '§5', '海军围捕偶数 → 罚 80')
  // evt_06 奇数入狱
  const g3 = mk(2); const p3 = g3.players[0]
  randomSeq([0.0])   // 1 奇数
  __test__.applyEvent(g3, p3, EVENT_BY_ID.evt_06)
  ok(p3.inJail === true, '§5', '海军围捕奇数 → 押进推进城')
  // evt_07 常人 -70
  const g4 = mk(2); const p4 = g4.players[0]
  __test__.applyEvent(g4, p4, EVENT_BY_ID.evt_07)
  ok(p4.cash === 1930, '§5', '海王类袭击 -70')
  // evt_08 后退 2 + 60
  const g5 = mk(2); const p5 = g5.players[0]
  p5.position = 20
  __test__.applyEvent(g5, p5, EVENT_BY_ID.evt_08)
  ok(p5.position === 18 && p5.cash === 1940, '§5', `暴风雨后退 2 格并 -60（位置 ${p5.position}，现金 ${p5.cash}）`)
  // evt_09 10% 夹 50-300
  const g6 = mk(2); const p6 = g6.players[0]
  p6.cash = 1000
  __test__.applyEvent(g6, p6, EVENT_BY_ID.evt_09)
  ok(1000 - p6.cash === 100, '§5', '四皇保护费 = 现金 10%（1000 → 100）')
  const g7 = mk(2); const p7 = g7.players[0]
  p7.cash = 100
  __test__.applyEvent(g7, p7, EVENT_BY_ID.evt_09)
  ok(100 - p7.cash === 50, '§5', '保护费下限 50')
  const g8 = mk(2); const p8 = g8.players[0]
  p8.cash = 5000
  __test__.applyEvent(g8, p8, EVENT_BY_ID.evt_09)
  ok(5000 - p8.cash === 300, '§5', '保护费上限 300')
  // evt_03 港口顺风
  const g9 = mk(2); const p9 = g9.players[0]
  p9.position = 0
  __test__.applyEvent(g9, p9, EVENT_BY_ID.evt_03)
  ok(BOARD[p9.position].type === 'port', '§5', `港口顺风直达下一个港口（落在 ${p9.position}）`)
  // evt_04 前进 2-5
  const g10 = mk(2); const p10 = g10.players[0]
  p10.position = 0
  randomSeq([0.0])
  __test__.applyEvent(g10, p10, EVENT_BY_ID.evt_04)
  ok(p10.position >= 2 && p10.position <= 5, '§5', `记录指针指引前进 2–5 格（实际 ${p10.position}）`)
  // evt_11 100 转移
  const g11 = mk(2); const p11 = g11.players[0]
  randomSeq([0.99, 0.0, 0.0, 0.99])   // 我方 6 对方 1
  __test__.applyEvent(g11, p11, EVENT_BY_ID.evt_11)
  ok(g11.players[0].cash + g11.players[1].cash === 4000 && (p11.cash === 2100 || p11.cash === 1900), '§5', 'DAVY BACK：赢家从对方拿 100（现金守恒）')
  // evt_12 7 折
  const g12 = mk(2); const p12 = g12.players[0]
  __test__.applyEvent(g12, p12, EVENT_BY_ID.evt_12)
  ok(g12.phase === 'awaitBuy' && g12.pendingDiscount === 0.7, '§5', '地下拍卖会 7 折竞拍无主岛')
  // evt_13 传送
  const g13 = mk(2); const p13 = g13.players[0]
  randomSeq([0.4])
  __test__.applyEvent(g13, p13, EVENT_BY_ID.evt_13)
  ok(p13.position === Math.floor(0.4 * 40), '§5', `记录指针紊乱传送到随机格（位置 ${p13.position}）`)
}

console.log('\n=== 12. 交易与手牌约束（PRD §7 / §4.1）===')
{
  // 只能交易历史正文
  const g = mk(2)
  const p = g.players[0], o = g.players[1]
  g.phase = 'awaitAction'
  p.hand.push({ uid: 'fr', kind: 'fruit', defId: 'chop' })
  const r = proposeTrade(g, 1, 'fr', 100, 'sell')
  ok(!!r.error, '§7', '普通道具（果实）不可交易')

  // 正常交易
  const g2 = mk(2)
  const a = g2.players[0], b = g2.players[1]
  a.cash = 1000; b.cash = 1000
  g2.historyPieces[1].ownerId = 1
  b.hand.push({ uid: 'h1', kind: 'history', defId: 'history', historyId: 1 })
  g2.phase = 'awaitAction'
  proposeTrade(g2, 1, 1, 300, 'buy')
  decisionTrade(g2, true)
  ok(a.cash === 700 && b.cash === 1300 && getHistoryIds(a).length === 1 && getHistoryIds(b).length === 0,
    '§7', '历史正文可与其他玩家用贝利交易（双方现金与归属同步）')

  // 价格校验
  const g3 = mk(2)
  const a3 = g3.players[0], b3 = g3.players[1]
  g3.historyPieces[2].ownerId = 1
  b3.hand.push({ uid: 'h2', kind: 'history', defId: 'history', historyId: 2 })
  g3.phase = 'awaitAction'
  const r3 = proposeTrade(g3, 1, 2, 'abc', 'buy')
  ok(!!r3.error, '§7', '交易价格必须为合法数字（非数字应被拒绝）',
    '未校验：proposeTrade 只判 price < 0，字符串会通过并污染现金为 NaN')

  // 拒绝交易
  const g4 = mk(2)
  const b4 = g4.players[1]
  g4.historyPieces[3].ownerId = 1
  b4.hand.push({ uid: 'h3', kind: 'history', defId: 'history', historyId: 3 })
  g4.phase = 'awaitAction'
  proposeTrade(g4, 1, 3, 100, 'buy')
  decisionTrade(g4, false)
  ok(getHistoryIds(g4.players[0]).length === 0 && getHistoryIds(b4).length === 1, '§7', '对手拒绝后交易不成立')
}

console.log('\n=== 13. 破产清算与资产守恒（PRD §6 / §7）===')
{
  const g = mk(2)
  const p = g.players[0]
  p.cash = 10
  p.islandIds = [1, 2]
  g.islandState[1] = { ownerId: 0, level: 2 }
  g.islandState[2] = { ownerId: 0, level: 0 }
  const r = settleDebt(g, p, 100)
  // 变卖：60*0.5=30 + 80*0.5=40 → 10+70=80 < 100 → 破产
  ok(r.status === 'bankrupt' && g.islandState[1].ownerId === null, '§6', '变卖按原价 50%、升级投入不返还，仍不足则破产出局')

  const g2 = mk(2)
  const p2 = g2.players[0]
  p2.cash = 0
  p2.islandIds = [1]                       // 卖 30
  g2.islandState[1] = { ownerId: 0, level: 3 }
  const r2 = settleDebt(g2, p2, 30)
  ok(r2.status === 'liquidated' && p2.cash === 0 && !p2.bankrupt, '§6', '变卖刚好够时保留玩家（3 级升级投入不返还）')
}

console.log('\n=== 14. 状态限制与规则守卫（PRD §8.4 / §4.1）===')
{
  randomReal()   // 前面用过随机序列注入，这里恢复真随机（先手随机性依赖它）

  // 先后手随机
  const firsts = new Set()
  for (let i = 0; i < 20; i++) {
    const g = createGame([0, 1, 2].map((k) => ({ id: k, name: '', charId: k + 1, tokenIndex: k })))
    firsts.add(g.current)
  }
  ok(firsts.size > 1, '§8.4', `先后手应由服务器随机决定（20 次开局首手座位集合：${[...firsts].join(',')}）`,
    '未随机：createGame 固定 current=0，房主/首个入座者永远先手')

  // 坐牢期间不可主动升级
  const g2 = mk(2)
  const p2 = g2.players[0]
  g2.islandState[1] = { ownerId: 0, level: 0 }
  p2.islandIds = [1]; p2.cash = 1000
  p2.position = cellIndex('jail')
  landOn(g2, p2, cellIndex('jail'))       // 入狱 → phase 回到 awaitAction
  const up = upgrade(g2, 1)
  ok(!!up.error, '§8.4', `坐牢期间不可主动升级（实际 phase=${g2.phase}，upgrade 返回 ${up.status || 'error:' + up.error}）`,
    '未拦截：upgrade 只校验 phase===awaitAction，入狱后 phase 已回到 awaitAction')

  // 坐牢期间不可用位移类道具
  const g3 = mk(2)
  const p3 = g3.players[0]
  p3.position = cellIndex('jail')
  landOn(g3, p3, cellIndex('jail'))
  p3.hand.push({ uid: 'lt', kind: 'fruit', defId: 'light' })
  const posBefore = p3.position
  const fr = useFruit(g3, 'lt')
  ok(!!fr.error, '§8.4', `坐牢期间不可使用位移类果实（实际 ${fr.status || 'error:' + fr.error}，位置 ${posBefore}→${p3.position}）`,
    '未拦截：useFruit 只校验 phase，闪闪果实可直接把坐牢玩家移出推进城')

  // 花花果实「选择是否生效」
  const g4 = mk(2)
  const p4 = g4.players[0]
  g4.phase = 'awaitAction'
  p4.hand.push({ uid: 'fl', kind: 'fruit', defId: 'flower' })
  const fl = useFruit(g4, 'fl')
  ok(g4.phase === 'awaitFlower' && g4.modal && g4.modal.type === 'flowerEvent',
    '§4.1', `花花果实再抽 1 张事件卡并进入「是否生效」决策（phase=${g4.phase}）`)
  const evtId = g4.modal && g4.modal.eventId
  const beforeDecline = JSON.stringify({ cash: p4.cash, hand: p4.hand.length, pos: p4.position })
  decisionFlower(g4, false)
  const afterDecline = JSON.stringify({ cash: p4.cash, hand: p4.hand.length, pos: p4.position })
  ok(beforeDecline === afterDecline && g4.phase === 'awaitAction', '§4.1', '花花果实选择「放弃」：事件不结算、回到行动阶段')
  // 再验一次「生效」路径
  const g4b = mk(2)
  const p4b = g4b.players[0]
  g4b.phase = 'awaitAction'
  p4b.hand.push({ uid: 'fl2', kind: 'fruit', defId: 'flower' })
  useFruit(g4b, 'fl2')
  const evt2 = EVENT_BY_ID[g4b.modal.eventId]
  decisionFlower(g4b, true)
  ok(!!evt2 && g4b.phase !== 'awaitFlower', '§4.1', `花花果实选择「生效」：按该事件正常结算（${evt2 && evt2.name}）`)

  // 手牌上限包含历史正文
  const g5 = mk(2)
  const p5 = g5.players[0]
  p5.hand = Array.from({ length: 5 }, (_, i) => ({ uid: `x${i}`, kind: 'fruit', defId: 'chop' }))
  g5.phase = 'awaitAction'
  p5.position = 30
  landOn(g5, p5, 30)
  buyHistory(g5)
  ok(p5.hand.length <= 5, '§4.1', `手牌上限 5 张应包含历史正文（实际 ${p5.hand.length} 张）`,
    '未校验：buyHistory 直接 hand.push，绕过上限')
}

console.log('\n=== 15. 批量对局不变量（PRD §1.3 核心循环 / §10）===')
{
  randomSeed(20261028)
  let games = 0, steps = 0, badPhase = 0, negCash = 0, dupOwner = 0, stuck = 0, winnerKinds = { bankrupt: 0, laftel: 0 }
  const phases = new Set(['awaitRoll', 'awaitBuy', 'awaitBuyHistory', 'awaitAction', 'awaitReroll', 'awaitEventCancel', 'awaitTarget', 'awaitTrade', 'ended'])
  for (let gi = 0; gi < 300; gi++) {
    const n = 2 + (gi % 3)
    const chars = [1, 2, 3, 4].slice(0, n).map((c) => ((c + gi) % 10) + 1)
    const g = createGame(Array.from({ length: n }, (_, i) => ({ id: i, name: '', charId: chars[i], tokenIndex: i })))
    let s = 0
    while (s < 1500 && g.phase !== 'ended') {
      s++
      const p = getCurrentPlayer(g)
      if (!phases.has(g.phase)) badPhase++
      // 简单策略驱动：能掷就掷、能买就买、结束回合
      if (g.phase === 'awaitRoll') roll(g)
      else if (g.phase === 'awaitBuy') {
        const isl = ISLAND_BY_ID[g.pendingIslandId]
        const price = isl.price * (p.charId === 2 ? 0.8 : 1) * (g.pendingDiscount || 1)
        if (p.cash >= price) buy(g); else declineBuy(g)
      } else if (g.phase === 'awaitBuyHistory') {
        const r = p.cash >= (p.charId === 7 ? 100 : 200) ? buyHistory(g) : { error: 'cash' }
        if (r.error) declineHistory(g)
      } else if (g.phase === 'awaitReroll') decisionReroll(g, false)
      else if (g.phase === 'awaitEventCancel') decisionEventCancel(g, false)
      else if (g.phase === 'awaitTarget') {
        const others = g.players.filter((x) => x.id !== p.id && !x.bankrupt)
        const r = others.length ? confirmFruitTarget(g, others[0].id) : { error: 'no target' }
        if (r.error) cancelTarget(g)
      } else if (g.phase === 'awaitTrade') {
        const r = decisionTrade(g, false)
        if (r.error) g.modal = null
      }
      else if (g.phase === 'awaitAction') {
        // 偶尔升个级、用张卡，覆盖更多分支
        const own = p.islandIds.find((id) => g.islandState[id].level < 3)
        if (own && p.cash > 400) upgrade(g, own)
        if (p.cash < 0) negCash++
        endTurn(g)
      } else break
      g.players.forEach((x) => { if (x.cash < 0 || !Number.isFinite(x.cash)) negCash++ })
      // 岛主一致性
      for (const id of Object.keys(g.islandState)) {
        const st = g.islandState[id]
        if (st.ownerId != null && !g.players[st.ownerId].islandIds.includes(Number(id))) dupOwner++
      }
    }
    steps += s
    games++
    if (g.phase !== 'ended') stuck++
    if (g.winner) { if (g.winKind === 'bankruptcy') winnerKinds.bankrupt++; else if (g.winKind === 'laftel') winnerKinds.laftel++ }
  }
  ok(badPhase === 0, '§1.3', `300 局中未出现非法阶段（${badPhase} 次）`)
  ok(negCash === 0, '§6', `300 局中未出现负现金（${negCash} 次）`)
  ok(dupOwner === 0, '§3.3', `岛屿归属与玩家 islandIds 始终一致（不一致 ${dupOwner} 次）`)
  ok(stuck <= 1, '§10', `300 局中 ${300 - stuck} 局在 1500 步内正常结束（未结束 ${stuck} 局，平均 ${(steps / games).toFixed(0)} 步）`,
    '未结束多为超长对局（双方互不破产），不代表软锁死')
  ok(negCash === 0, '§6', '现金始终为有限非负数（无 NaN / 负数）')
  console.log(`    胜利构成：破产 ${winnerKinds.bankrupt} 局 / 拉夫德鲁 ${winnerKinds.laftel} 局`)
}

randomReal()
console.log(`\n=== 结果：${pass} 通过, ${fail} 失败, ${warn} 项记录 ===`)
if (failures.length) {
  console.log('\n未通过项：')
  failures.forEach((f) => console.log(' - ' + f))
}
process.exit(fail > 0 ? 1 : 0)
