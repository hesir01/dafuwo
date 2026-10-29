// 引擎冒烟测试：node tests/engine.test.js
import { createGame, roll, buy, declineBuy, endTurn } from '../shared/engine.js'
import { aiStep } from '../shared/aiPlayer.js'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg) }
  else { failed++; console.log('  ✗', msg) }
}

console.log('=== 测试1：创建游戏 ===')
const g = createGame([
  { id: 0, name: 'A', charId: 1, tokenIndex: 0 },
  { id: 1, name: 'B', charId: 2, tokenIndex: 1 },
  { id: 2, name: 'C', charId: 3, tokenIndex: 2 },
  { id: 3, name: 'D', charId: 4, tokenIndex: 3 }
])
assert(g.players.length === 4, '4个玩家')
assert(g.players[0].cash === 2000, '初始2000贝利')
assert(g.phase === 'awaitRoll', '初始阶段awaitRoll')

console.log('\n=== 测试2：掷骰移动 ===')
// 先后手已改为服务器随机（PRD §8.4），冒烟测试不能假设 0 号位先手
const cur = g.players[g.current]
const pos0 = cur.position
const r = roll(g)
assert(!r.error, '掷骰无错误')
assert(cur.position !== pos0 || r.status === 'jailed' || cur.inJail, '棋子移动或入狱')
assert(g.phase !== 'awaitRoll' || cur.inJail, '阶段已变化')

console.log('\n=== 测试3：200局AI模拟 ===')
// 之前这里把「异常」「超长局」「有没有拉夫德鲁胜利」混成一个失败标志：
// ① safety>=1000 只说明这局节奏长（随机波动），不该算崩溃；② winByLaugh 从未累加，
// 永远是 0，等于没测。现在拆成三类指标，并用 state.winKind 区分胜利路径。
let errors = 0, slow = 0, noWinner = 0, maxSteps = 0
const kinds = { bankruptcy: 0, laftel: 0, other: 0 }
const stepList = []
for (let trial = 0; trial < 200; trial++) {
  try {
    const gg = createGame([
      { id: 0, name: 'P1', charId: 1, tokenIndex: 0 },
      { id: 1, name: 'P2', charId: 2, tokenIndex: 1 },
      { id: 2, name: 'P3', charId: 3, tokenIndex: 2 },
      { id: 3, name: 'P4', charId: 4, tokenIndex: 3 }
    ])
    let safety = 0
    while (!gg.winner && safety < 2000) {
      safety++
      aiStep(gg)
    }
    stepList.push(safety)
    maxSteps = Math.max(maxSteps, safety)
    if (safety >= 1000) slow++
    if (!gg.winner) noWinner++
    else if (gg.winKind === 'bankruptcy') kinds.bankruptcy++
    else if (gg.winKind === 'laftel') kinds.laftel++
    else kinds.other++
  } catch (e) {
    errors++
    if (errors < 3) console.log('  异常:', e.message)
  }
}
stepList.sort((a, b) => a - b)
const median = stepList[Math.floor(stepList.length / 2)]
assert(errors === 0, `200局无异常（异常 ${errors} 局）`)
assert(noWinner === 0, `200局都能分出胜负（未结束 ${noWinner} 局）`)
assert(kinds.other === 0, '胜利路径均带 winKind 标记（无未知路径）')
assert(kinds.bankruptcy >= 120, `破产结算为主（破产 ${kinds.bankruptcy} / 拉夫德鲁 ${kinds.laftel}）`)
console.log(`  步数：中位 ${median}，最长 ${maxSteps}，≥1000 步的长局 ${slow} 局（仅统计，不算失败）`)

console.log(`\n=== 结果：${passed} 通过, ${failed} 失败 ===`)
process.exit(failed > 0 ? 1 : 0)
