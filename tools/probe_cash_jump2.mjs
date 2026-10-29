// 诊断：排除「破产 / 岛屿归属或等级变化」后的单步现金跳变
import { createGame } from '../shared/engine.js'
import { aiStep } from '../shared/aiPlayer.js'

function mkGame(n = 4) {
  const chars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  return createGame(Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, charId: chars[i], tokenIndex: i })))
}
const sig = (g) => JSON.stringify(g.islandState)
let maxSeen = 0, maxInfo = null
let counted = 0
for (let t = 0; t < 300; t++) {
  const g = mkGame(4)
  let safety = 0
  while (!g.winner && safety < 800) {
    safety++
    const before = g.players.reduce((a, p) => a + p.cash, 0)
    const logLen = g.log.length
    const bankBefore = g.players.filter((p) => p.bankrupt).length
    const sigBefore = sig(g)
    aiStep(g)
    const after = g.players.reduce((a, p) => a + p.cash, 0)
    const bankAfter = g.players.filter((p) => p.bankrupt).length
    if (bankAfter !== bankBefore || sig(g) !== sigBefore) continue
    counted++
    const d = after - before
    if (Math.abs(d) > maxSeen) { maxSeen = Math.abs(d); maxInfo = { d, logs: g.log.slice(logLen).map((l) => l.text) } }
  }
}
console.log('排除资产转换后最大跳变:', maxSeen, JSON.stringify(maxInfo))
console.log('样本步数:', counted)
