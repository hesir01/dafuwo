// 服务端调度验证：交易决策权属于被交易方，AI 不会替人类拍板
// 用法：node tools/verify_trade_consent.cjs
import { createGame, proposeTrade } from '../shared/engine.js'
import { scheduleNext } from '../server/sockets/gameSocket.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NOOP_IO = { to: () => ({ emit: () => {} }) }

let passed = 0
let failed = 0
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ✓', msg) } else { failed++; console.log('  ✗', msg, extra === undefined ? '' : JSON.stringify(extra)) }
}

// P0 = 发起方（AI 卖家），P1 = 被交易方
function build({ p0AI, p1AI }) {
  const g = createGame(Array.from({ length: 4 }, (_, i) => ({ id: i, name: `P${i}`, charId: i + 1, tokenIndex: i })))
  g.current = 0
  g.phase = 'awaitAction'
  g.players[0].cash = 400
  g.players[1].cash = 600
  g.players[0].hand.push({ uid: 'h-1', kind: 'history', historyId: 1 })
  g.historyPieces[1].ownerId = 0
  proposeTrade(g, 1, 1, 250, 'sell')
  const room = {
    started: true,
    players: [
      { socketId: 's0', isAI: p0AI },
      { socketId: 's1', isAI: p1AI },
      { socketId: 's2', isAI: true },
      { socketId: 's3', isAI: true }
    ],
    state: g
  }
  return { g, room }
}

function stop(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null }
  room.aiPending = false
}

console.log('=== 1. AI 叫卖、人类不点：不得自动成交 ===')
{
  const { g, room } = build({ p0AI: true, p1AI: false })
  const cash0 = g.players[1].cash
  scheduleNext(NOOP_IO, room, { aiDelay: 20, tradeTimeout: 150, turnTimeout: 60000 })
  await sleep(90)
  check(g.phase === 'awaitTrade', '90ms 后仍停在 awaitTrade（人类还没回应）', g.phase)
  check(g.players[1].cash === cash0, '人类现金未被扣', { before: cash0, now: g.players[1].cash })
  check(g.players[0].hand.some((c) => c.uid === 'h-1'), '历史正文仍属于 AI 卖家')
  check(!!g.modal && g.modal.targetId === 1, 'modal 仍指向人类被交易方')
  await sleep(120) // 越过 tradeTimeout → 自动拒绝
  check(g.phase === 'awaitAction', '超时后回到行动阶段（未卡死）', g.phase)
  check(g.players[1].cash === cash0, '超时也只是拒绝，绝不自动成交', g.players[1].cash)
  check(g.log.some((l) => l.text && l.text.includes('交易被拒绝')), '日志记录了「交易被拒绝」')
  stop(room)
}

console.log('\n=== 2. 双方都是 AI：自动决策不卡住 ===')
{
  const { g, room } = build({ p0AI: true, p1AI: true })
  const cash0 = g.players[1].cash
  scheduleNext(NOOP_IO, room, { aiDelay: 20, tradeTimeout: 5000, turnTimeout: 60000 })
  await sleep(90)
  check(g.phase !== 'awaitTrade', '交易已被 AI 处理', g.phase)
  check(g.players[1].cash !== cash0, 'AI 买家现金发生变化', { before: cash0, now: g.players[1].cash })
  check(g.players[1].hand.some((c) => c.historyId === 1), '历史正文转到 AI 买家手上')
  stop(room)
}

console.log('\n=== 3. 发起方是人类、被交易方是 AI：AI 立即应答 ===')
{
  const { g, room } = build({ p0AI: false, p1AI: true })
  g.current = 0 // 人类发起
  const cash0 = g.players[1].cash
  scheduleNext(NOOP_IO, room, { aiDelay: 20, tradeTimeout: 150, turnTimeout: 60000 })
  await sleep(90)
  check(g.phase !== 'awaitTrade', 'AI 被交易方已应答', g.phase)
  check(g.players[1].cash !== cash0, 'AI 付钱/收钱生效', { before: cash0, now: g.players[1].cash })
  stop(room)
}

console.log(`\n通过 ${passed} / ${passed + failed}`)
process.exit(failed ? 1 : 0)
