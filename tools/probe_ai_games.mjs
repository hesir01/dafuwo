// 临时诊断：AI 对局长度分布
import { createGame } from '../shared/engine.js'
import { aiStep } from '../shared/aiPlayer.js'

const buckets = { '<300': 0, '300-599': 0, '600-999': 0, '1000-1999': 0, 'timeout': 0 }
const winKind = {}
let maxSteps = 0
for (let t = 0; t < 200; t++) {
  const g = createGame([
    { id: 0, name: 'P1', charId: 1, tokenIndex: 0 },
    { id: 1, name: 'P2', charId: 2, tokenIndex: 1 },
    { id: 2, name: 'P3', charId: 3, tokenIndex: 2 },
    { id: 3, name: 'P4', charId: 4, tokenIndex: 3 }
  ])
  let n = 0
  while (!g.winner && n < 2000) { n++; aiStep(g) }
  maxSteps = Math.max(maxSteps, n)
  if (!g.winner) buckets.timeout++
  else if (n < 300) buckets['<300']++
  else if (n < 600) buckets['300-599']++
  else if (n < 1000) buckets['600-999']++
  else buckets['1000-1999']++
  const k = g.winReason || (g.winner ? 'unknown' : 'none')
  winKind[k] = (winKind[k] || 0) + 1
}
console.log(buckets, 'maxSteps', maxSteps, winKind)
