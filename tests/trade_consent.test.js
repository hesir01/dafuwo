// 交易同意权测试：AI 绝不能替人类被交易方拍板
// 背景 bug：索隆（AI 托管）回合叫卖历史正文 → 服务端 800ms 后 aiStep 按「当前行动玩家是 AI」
// 自动调用 decisionTrade，娜美（人类）没点接受就被扣钱买下正文。
// 用法：node tests/trade_consent.test.js
import {
  createGame, proposeTrade, decisionTrade, getCurrentPlayer
} from '../shared/engine.js'
import { aiStep } from '../shared/aiPlayer.js'

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg) } else { failed++; console.log('  ✗', msg) }
}

// P0 = AI 卖家（当前行动玩家），P1 = 人类买家（被交易方）
function mkTrade() {
  const chars = [1, 2, 3, 4]
  const g = createGame(Array.from({ length: 4 }, (_, i) => ({ id: i, name: `P${i}`, charId: chars[i], tokenIndex: i })))
  g.current = 0
  g.phase = 'awaitAction'
  g.players[0].cash = 400
  g.players[1].cash = 600
  const card = { uid: 'h-test-1', kind: 'history', historyId: 1 }
  g.players[0].hand.push(card)
  g.historyPieces[1].ownerId = 0
  const r = proposeTrade(g, 1, 1, 250, 'sell') // 卖家 P0 → 买家 P1
  if (r.error) throw new Error('场景构造失败：' + r.error)
  return g
}

console.log('=== 1. 被交易方是人类：AI 不得代答 ===')
{
  const g = mkTrade()
  const cashBefore = g.players[1].cash
  const action = aiStep(g, { canControl: (id) => id === 0 }) // 只有 P0 是 AI
  assert(action === 'tradeWait', `aiStep 返回 tradeWait（实际 ${action}）`)
  assert(g.phase === 'awaitTrade', '交易仍在等待人类应答（phase 未变）')
  assert(g.players[1].cash === cashBefore, '人类现金未被扣（没被强行买入）')
  assert(g.players[0].hand.some((c) => c.uid === 'h-test-1'), '历史正文仍在 AI 手上')
  assert(g.modal && g.modal.targetId === 1, 'modal 仍指向被交易方 P1')
}

console.log('\n=== 2. 被交易方也是 AI：自动应答 ===')
{
  const g = mkTrade()
  const cashBefore = g.players[1].cash
  const action = aiStep(g, { canControl: () => true })
  assert(action === 'trade', `aiStep 返回 trade（实际 ${action}）`)
  assert(g.phase === 'awaitAction', '交易结束回到行动阶段')
  assert(g.players[1].cash !== cashBefore, 'AI 买家现金发生变化')
  assert(g.players[1].hand.some((c) => c.historyId === 1), '历史正文转到 AI 买家手上')
}

console.log('\n=== 3. 引擎层兜底：非被交易方无法成交 ===')
{
  const g = mkTrade()
  const r = decisionTrade(g, true, 2) // 第三方 P2 试图拍板
  assert(!!r.error, '第三方决策被拒绝：' + (r.error || ''))
  assert(g.phase === 'awaitTrade', '仍停在等待状态')
  const r2 = decisionTrade(g, true, 0) // 发起方（卖家）自己也不能拍板
  assert(!!r2.error, '发起方决策被拒绝：' + (r2.error || ''))
  const r3 = decisionTrade(g, false, 1) // 被交易方拒绝
  assert(!r3.error && g.phase === 'awaitAction', '被交易方本人可以拒绝并结束交易')
}

console.log('\n=== 4. 不传 canControl（本地单机托管）保持旧行为 ===')
{
  const g = mkTrade()
  const action = aiStep(g)
  assert(action === 'trade', '未注入 canControl 时仍可代答（单机全托管不卡住）')
}

console.log(`\n通过 ${passed} / ${passed + failed}`)
process.exit(failed ? 1 : 0)
