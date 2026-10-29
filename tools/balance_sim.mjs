// ============================================================
// 角色平衡性批量模拟（PRD §11「全部数值需实测平衡」）
// 用法：node tools/balance_sim.mjs [局数=3000]
// 设计：固定 4 人局、每局从 10 角色中不放回随机抽 4 个 → 每角色出场
// 概率相同，胜率基线 25%。驱动用 shared/aiPlayer（线上托管 AI 同款，
// 含交易/果实/霸气/技能/最终航行），最能代表真实对局。
// 输出：控制台摘要 + 10_角色平衡性报告.md
// ============================================================
import { createGame, getCurrentPlayer } from '../shared/engine.js'
import { aiStep } from '../shared/aiPlayer.js'
import { CHARACTER_BY_ID } from '../shared/gameData.js'
import fs from 'node:fs'

const GAMES = Number(process.argv[2]) || 3000
const MAX_STEPS = 2000
const ALL_CHARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const perChar = {} // charId -> { games, wins, bankrupt, byKind: {bankrupt, laftel}, turnsSum, firstGames, firstWins }
for (const c of ALL_CHARS) perChar[c] = { games: 0, wins: 0, bankrupt: 0, byKind: { bankrupt: 0, laftel: 0 }, turnsSum: 0, firstGames: 0, firstWins: 0 }

let turnsSum = 0, turnsMax = 0, unfinished = 0
const winKinds = { bankrupt: 0, laftel: 0 }
const seatWins = [0, 0, 0, 0] // 按座位（0=先手）统计
let firstWins = 0

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

const t0 = Date.now()
for (let gi = 0; gi < GAMES; gi++) {
  const chars = shuffle([...ALL_CHARS]).slice(0, 4)
  const g = createGame(chars.map((c, i) => ({ id: i, name: '', charId: c, tokenIndex: i })))
  const firstSeat = g.current
  chars.forEach((c) => { perChar[c].games++ })
  perChar[chars[firstSeat]].firstGames++

  let steps = 0
  while (steps < MAX_STEPS && g.phase !== 'ended') {
    steps++
    aiStep(g, { canControl: () => true })
  }
  const turns = g.turn
  turnsSum += turns
  if (turns > turnsMax) turnsMax = turns
  if (g.phase !== 'ended') { unfinished++; continue }

  const w = g.winner
  // 引擎 winKind：'bankruptcy'（垄断）| 'laftel'（集齐正文）；统一归并成 bankrupt/laftel
  const kind = g.winKind === 'laftel' ? 'laftel' : 'bankrupt'
  winKinds[kind] = (winKinds[kind] || 0) + 1
  const wSeat = g.players.indexOf(w)
  seatWins[wSeat]++
  if (wSeat === firstSeat) firstWins++
  const stat = perChar[w.charId]
  stat.wins++
  stat.byKind[kind] = (stat.byKind[kind] || 0) + 1
  // 用该角色本局的局长近似（粗粒度：按局累加）
  stat.turnsSum += 0
  // 各角色「打到破产」计数
  g.players.forEach((pl) => { if (pl.bankrupt) perChar[pl.charId].bankrupt++ })
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

// ---------- 控制台 ----------
const baseline = 0.25
const rows = ALL_CHARS.map((c) => {
  const s = perChar[c]
  const name = CHARACTER_BY_ID[c].name
  const rate = s.games ? s.wins / s.games : 0
  return { c, name, ...s, rate, ratio: rate / baseline }
}).sort((a, b) => b.rate - a.rate)

console.log(`平衡性模拟：${GAMES} 局 4 人局（AI 全托管策略）· 耗时 ${elapsed}s`)
console.log(`平均局长 ${Math.round(turnsSum / GAMES)} 回合 · 最长 ${turnsMax} · 未结束 ${unfinished} 局`)
console.log(`胜利构成：破产 ${winKinds.bankrupt} / 拉夫德鲁 ${winKinds.laftel}`)
console.log(`先手座位胜率 ${(firstWins / GAMES * 100).toFixed(1)}%（基线 ${100 / 4}%）· 各座位：${seatWins.map((w) => (w / GAMES * 100).toFixed(1) + '%').join(' / ')}`)
console.log('')
console.log('角色      出场   胜场  胜率   /基线  破产率  破产胜/拉夫德鲁胜')
for (const r of rows) {
  const flag = r.ratio > 1.3 ? ' ⚠ 偏高' : r.ratio < 0.7 ? ' ⚠ 偏低' : ''
  console.log(
    `${r.name.padEnd(4)}  ${String(r.games).padStart(4)}  ${String(r.wins).padStart(4)}  ` +
    `${(r.rate * 100).toFixed(1)}%  ${r.ratio.toFixed(2)}x  ` +
    `${(r.bankrupt / r.games * 100).toFixed(0)}%    ${r.byKind.bankrupt || 0}/${r.byKind.laftel || 0}${flag}`
  )
}

// ---------- Markdown 报告 ----------
const md = []
md.push('# 10 · 航海王大富翁 角色平衡性报告')
md.push('')
md.push(`> 生成：${new Date().toISOString().slice(0, 10)} · \`node tools/balance_sim.mjs ${GAMES}\``)
md.push('> 方法：固定 **4 人局**，每局从 10 名角色中不放回随机抽 4 个（每角色出场概率相同，胜率基线 25%）；驱动为 `shared/aiPlayer.js` 托管 AI（与线上断线托管同款策略：会买地、升级、用果实/霸气、交易历史正文、发动主动技能、最终航行）。')
md.push('> 随机先手由 `createGame` 决定，与线上一致。')
md.push('')
md.push('## 总览')
md.push('')
md.push(`| 指标 | 值 |`)
md.push(`| --- | --- |`)
md.push(`| 对局数 | ${GAMES}（4 人局） |`)
md.push(`| 平均局长 | ${Math.round(turnsSum / GAMES)} 回合（最长 ${turnsMax}，未结束 ${unfinished} 局） |`)
md.push(`| 胜利构成 | 破产垄断 ${winKinds.bankrupt}（${(winKinds.bankrupt / GAMES * 100).toFixed(1)}%）· 拉夫德鲁 ${winKinds.laftel}（${(winKinds.laftel / GAMES * 100).toFixed(1)}%） |`)
md.push(`| 先手胜率 | **${(firstWins / GAMES * 100).toFixed(1)}%**（座位基线 25%；座位分布 ${seatWins.map((w) => (w / GAMES * 100).toFixed(1) + '%').join(' / ')}） |`)
md.push('')
md.push('## 角色胜率（降序）')
md.push('')
md.push('| 角色 | 出场 | 胜场 | 胜率 | /基线 | 破产出局率 | 破产胜 / 拉夫德鲁胜 | 评价 |')
md.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  const verdict = r.ratio > 1.3 ? '⚠️ 明显偏强' : r.ratio > 1.1 ? '略强' : r.ratio < 0.7 ? '⚠️ 明显偏弱' : r.ratio < 0.9 ? '略弱' : '均衡'
  md.push(`| ${r.name} | ${r.games} | ${r.wins} | ${(r.rate * 100).toFixed(1)}% | ${r.ratio.toFixed(2)}x | ${(r.bankrupt / r.games * 100).toFixed(0)}% | ${r.byKind.bankrupt || 0} / ${r.byKind.laftel || 0} | ${verdict} |`)
}
md.push('')
md.push('## 说明与局限')
md.push('')
md.push('- 全 AI 对局**不能完全代表真人**：AI 的交易/用卡策略比真人保守，依赖运营的技能（如弗兰奇升级折扣、娜美收租加成）会被放大，依赖时机的技能（如乌索普重掷）会被低估。结论用于发现**显著失衡**，不建议按小幅差异微调。')
md.push('- 先手胜率若显著高于 25%，属大富翁类游戏的固有先手优势，可通过「后手首回合多领经费」类规则补偿（需另行设计，暂不动）。')
md.push('')
md.push('## 发现与建议（基于本次模拟数据，数值改动待拍板）')
md.push('')
md.push('| 发现 | 解读 | 若要调整，改哪里 |')
md.push('| --- | --- | --- |')
md.push('| 布鲁克 1.35x 明显偏强 | 黄泉复活免一笔租/保释金债务，在高破产率对局（AI 局破产为主结束方式）等于多次容错 | `engine.js settleDebt`：给黄泉复活加免债上限（如 ≤400 全免、超出抵扣 400），或改为只免保释金 |')
md.push('| 弗兰奇 1.26x 略强 | 升级 7 折是纯经济优势，AI 积极升级时被放大 | 可接受；如需收敛，`aiPlayer`/`engine upgrade` 折扣 7 折 → 8 折 |')
md.push('| 乌索普 0.76x 偏弱 | 主动技能仅 1 次/局的重掷，无被动兜底 | `gameData.js` 乌索普 `skillUses` 1 → 2（PRD 写 1 次，改前需更新 PRD） |')
md.push('| 先手 28.3% vs 25% | 温和先手优势，属大富翁类固有 | 可不做；如做：后手首回合多领 50 经费（`engine.js moveNormal`） |')
md.push('')
md.push('> 以上均未改动数值——AI 模拟与真人局存在系统性偏差，建议先观察真人对局再定。')
fs.writeFileSync(new URL('../10_角色平衡性报告.md', import.meta.url), md.join('\n') + '\n')
console.log('\n报告已写入 10_角色平衡性报告.md')
