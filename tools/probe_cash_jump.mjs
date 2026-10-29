// 诊断：单步现金总和跳变的最大值与触发原因
import { createGame } from '../shared/engine.js'
import { aiStep } from '../shared/aiPlayer.js'

function mkGame(n = 4) {
  const chars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  return createGame(Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, charId: chars[i], tokenIndex: i })))
}
let maxSeen = 0
let maxInfo = null
const hist = {}
for (let t = 0; t < 300; t++) {
  const g = mkGame(4)
  let safety = 0
  while (!g.winner && safety < 800) {
    safety++
    const before = g.players.reduce((a, p) => a + p.cash, 0)
    const logLen = g.log.length
    const bankruptBefore = g.players.filter((p) => p.bankrupt).length
    aiStep(g)
    const after = g.players.reduce((a, p) => a + p.cash, 0)
    const bankruptAfter = g.players.filter((p) => p.bankrupt).length
    if (bankruptAfter !== bankruptBefore) continue // 破产会清零现金，属于合法销毁
    const d = after - before
    if (Math.abs(d) > 300) {
      const newLogs = g.log.slice(logLen).map((l) => l.text).join(' / ')
      const bucket = Math.floor(Math.abs(d) / 100) * 100
      hist[bucket] = (hist[bucket] || 0) + 1
      if (Math.abs(d) > maxSeen) { maxSeen = Math.abs(d); maxInfo = { d, newLogs, phase: g.phase, turn: g.turn } }
    }
  }
}
console.log('最大单步跳变:', maxSeen, JSON.stringify(maxInfo, null, 2))
console.log('分布(100起):', hist)
