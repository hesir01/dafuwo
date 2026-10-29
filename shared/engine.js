// ============================================================
// 纯函数游戏引擎：掷骰、移动、买地、租金、升级、结算、回合流转。
// 规则前后端共用，以后端结算为准。
// 数值全部来自 gameData，本文件不写死。
// ============================================================

import {
  BOARD, BOARD_SIZE, ISLAND_BY_ID, MONOPOLY_GROUPS,
  ECONOMY, DICE,
  CHARACTER_BY_ID, FRUITS, FRUIT_BY_ID, HAKI, HAKI_BY_ID,
  EVENTS, EVENT_BY_ID
} from './gameData.js'

let UID_SEQ = 1
function newUid(prefix) {
  UID_SEQ += 1
  return `${prefix}_${UID_SEQ}`
}

// 玩家手牌（不含历史正文时的判定）相关
export function handCount(player) {
  return player.hand.length
}
export function hasCard(player, kind, defId) {
  return player.hand.some((c) => c.kind === kind && (defId == null || c.defId === defId))
}
// 手牌中可被偷的卡（果实/霸气，历史正文不可偷）
function stealableCards(player) {
  return player.hand.filter((c) => c.kind !== 'history')
}

// ---------- 骰子 ----------
export function rollDie(sides = DICE.SIDES) {
  return 1 + Math.floor(Math.random() * sides)
}

export function rollTwoDice(sides = DICE.SIDES) {
  const d1 = rollDie(sides)
  const d2 = rollDie(sides)
  return { d1, d2, total: d1 + d2, isDoubles: d1 === d2 }
}

// ---------- 日志 ----------
function addLog(state, text) {
  state.log.push({ turn: state.turn, text })
  if (state.log.length > 200) state.log.shift()
}

// ---------- 初始化 ----------
// playerConfigs: [{ id, name, charId, tokenIndex }]
export function createGame(playerConfigs) {
  const players = playerConfigs.map((c, i) => ({
    id: c.id ?? i,
    // 名字唯一来源＝所选角色：不再接受外部昵称（联机曾因此出现「昵称（你）· 角色名」双名）。
    // 只有 charId 非法时才回落传入值/座位号，保证 UI 永远有字可显示。
    name: CHARACTER_BY_ID[c.charId ?? (i + 1)]?.name || c.name || `玩家${i + 1}`,
    charId: c.charId ?? (i + 1),
    tokenIndex: c.tokenIndex ?? i,
    cash: ECONOMY.START_CASH,
    position: 0,
    bankrupt: false,
    islandIds: [],
    inJail: false,
    jailTurns: 0,
    doubles: 0,
    hand: [],              // 卡片实例 { uid, kind, defId, historyId? }
    skillUsed: 0,          // 主动技能已用次数
    frozen: 0,             // 被冰冻：>0 时下回合无法行动
    diceDebuff: 0,         // 霸王色：下回合掷点结果 −2
    cardsUsedThisTurn: 0,  // 本回合已主动使用卡片数
    rentImmune: false,     // 本回合免租（四分五裂/路飞技能）
    mochiWard: false,      // 糯糯果实护盾
    stats: { eventsDrawn: 0, cardsUsed: 0 } // 结算界面的事件统计（PRD §9）
  }))

  const islandState = {}
  for (const id of Object.keys(ISLAND_BY_ID)) {
    islandState[id] = { ownerId: null, level: 0 }
  }

  // 4 块路标历史正文：块1/2 来自格子（30/38），块3/4 来自事件
  const historyPieces = {
    1: { id: 1, ownerId: null, source: 'cell', cellIndex: 30 },
    2: { id: 2, ownerId: null, source: 'cell', cellIndex: 38 },
    3: { id: 3, ownerId: null, source: 'event' },
    4: { id: 4, ownerId: null, source: 'event' }
  }

  const state = {
    players,
    islandState,
    historyPieces,
    // PRD §8.4：先后手由服务器随机决定（不是固定房主先手）
    current: Math.floor(Math.random() * players.length),
    turn: 1,
    phase: 'awaitRoll', // awaitRoll | awaitBuy | awaitAction | ended
    lastDice: null,
    pendingIslandId: null,
    pendingHistoryId: null, // 历史正文格待购买的块
    lastEvent: null,
    modal: null,            // 需前端弹窗展示的事件/交互
    winner: null,
    winKind: null,          // 'bankruptcy' | 'laftel'：胜利路径，供测试与结算区分
    log: []
  }
  addLog(state, `对局开始，共 ${players.length} 名玩家，每人 ${ECONOMY.START_CASH} 贝利。`)
  return state
}

// 取角色定义
export function getChar(player) {
  return CHARACTER_BY_ID[player.charId]
}

// 玩家持有的历史正文块 id 列表
export function getHistoryIds(player) {
  return player.hand.filter((c) => c.kind === 'history').map((c) => c.historyId)
}

export function getCurrentPlayer(state) {
  return state.players[state.current]
}

export function getPlayerIslands(state, player) {
  return player.islandIds.map((id) => ISLAND_BY_ID[id])
}

// ---------- 垄断 ----------
// 玩家是否集齐某组
export function ownsMonopoly(state, player, groupId) {
  const group = MONOPOLY_GROUPS.find((g) => g.id === groupId)
  if (!group) return false
  return group.islandIds.every((id) => state.islandState[id].ownerId === player.id)
}

// ---------- 租金 ----------
// 返回某岛屿当前应缴租金（含等级、垄断加成、娜美被动）
export function getRent(state, island) {
  const st = state.islandState[island.id]
  let rent = island.rent[st.level]
  if (ownsMonopoly(state, { id: st.ownerId }, island.group)) {
    rent = Math.round(rent * 1.5)
  }
  // 娜美·贪财天候：多收 20%
  const owner = state.players.find((p) => p.id === st.ownerId)
  if (owner && owner.charId === 3) rent = Math.round(rent * 1.2)
  return rent
}

// ---------- 债务 / 破产 ----------
// debtor 向 creditor 支付 amount；钱不够则变卖岛屿，仍不足则破产。
// kind: 'rent' | 'bail' | 'tax' | 'event' | 'fruit' | 'other'（用于布鲁克/技能判定）
// 返回 { status: 'paid' | 'liquidated' | 'saved' | 'bankrupt' }
export function settleDebt(state, debtor, amount, creditor = null, kind = 'other') {
  if (debtor.cash >= amount) {
    debtor.cash -= amount
    if (creditor) creditor.cash += amount
    return { status: 'paid' }
  }

  // 计算全部变卖后能凑到的总额（不实际变卖）
  const islands = getPlayerIslands(state, debtor)
  const liquidValue = islands.reduce(
    (s, isl) => s + Math.round(isl.price * ECONOMY.SELL_RATE), 0
  )

  // 布鲁克·黄泉复活：变卖后仍会因租金/保释金破产，且技能可用 → 免除该笔债务
  const canRevive = debtor.charId === 9 &&
    debtor.skillUsed < getChar(debtor).skillUses &&
    (kind === 'rent' || kind === 'bail')
  if (canRevive && debtor.cash + liquidValue < amount) {
    debtor.skillUsed += 1
    addLog(state, `${debtor.name} 发动「黄泉复活」，免除了这笔 ${amount} 贝利的债务！`)
    return { status: 'saved' }
  }

  // 钱不够：变卖名下岛屿（按原始买价 50%，等级作废）
  for (const isl of islands) {
    debtor.cash += Math.round(isl.price * ECONOMY.SELL_RATE)
    state.islandState[isl.id] = { ownerId: null, level: 0 }
    debtor.islandIds = debtor.islandIds.filter((x) => x !== isl.id)
  }

  if (debtor.cash >= amount) {
    debtor.cash -= amount
    if (creditor) creditor.cash += amount
    addLog(state, `${debtor.name} 变卖岛屿凑齐了 ${amount} 贝利。`)
    return { status: 'liquidated' }
  }

  // 仍不足：破产出局（散佚历史正文）
  onBankruptcy(state, debtor)
  debtor.bankrupt = true
  debtor.cash = 0
  addLog(state, `${debtor.name} 资不抵债，宣告破产出局！`)
  checkWinner(state)
  return { status: 'bankrupt' }
}

// 破产散佚：历史正文归位（cell 来源重置格子，event 来源回池）
function onBankruptcy(state, debtor) {
  const histCards = debtor.hand.filter((c) => c.kind === 'history')
  for (const c of histCards) {
    const piece = state.historyPieces[c.historyId]
    piece.ownerId = null
    addLog(state, `一块路标历史正文散佚（${piece.source === 'cell' ? '重置对应格子' : '回到事件池'}）。`)
  }
}

// ---------- 入狱 / 出狱 ----------
export function sendToJail(state, player) {
  player.position = BOARD.findIndex((c) => c.type === 'jail')
  player.inJail = true
  player.jailTurns = 2
  player.doubles = 0
  addLog(state, `${player.name} 被关进推进城！`)
}

// 交保释金出狱
export function payBail(state) {
  const p = getCurrentPlayer(state)
  if (!p.inJail) return { error: '不在监狱中' }
  const r = settleDebt(state, p, ECONOMY.BAIL)
  if (r.status === 'bankrupt') return r
  p.inJail = false
  p.jailTurns = 0
  addLog(state, `${p.name} 交了 ${ECONOMY.BAIL} 保释金出狱。`)
  state.phase = 'awaitRoll'
  return { status: 'ok' }
}

// ---------- 移动 ----------
// 正常移动（掷骰），处理经过起点发钱
function moveNormal(state, player, steps) {
  const before = player.position
  const wrapped = before + steps >= BOARD_SIZE
  player.position = (before + steps) % BOARD_SIZE
  if (wrapped) {
    // 山治·厨房补给：多领 20%（240）
    const salary = player.charId === 4
      ? Math.round(ECONOMY.GO_SALARY * 1.2)
      : ECONOMY.GO_SALARY
    player.cash += salary
    addLog(state, `${player.name} 经过颠倒山，领取 ${salary} 经费。`)
  }
  return player.position
}

// 强制移动：直接落到目标格（不触发中途格、不领起点经费），只结算终点
function forceLand(state, player, targetIndex) {
  player.position = ((targetIndex % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE
  resolveLanding(state, player)
}

// 强制前进/后退 N 格（不领起点经费），只结算终点
function forceMoveSteps(state, player, steps, backward = false) {
  const delta = backward ? -steps : steps
  const target = player.position + delta
  player.position = ((target % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE
  resolveLanding(state, player)
}

// ---------- 落格结算 ----------
function resolveLanding(state, player) {
  const cell = BOARD[player.position]
  state.lastEvent = { type: 'land', cellType: cell.type, position: player.position }

  switch (cell.type) {
    case 'island':
      resolveIsland(state, player, ISLAND_BY_ID[cell.islandId])
      break
    case 'random_island':
      resolveRandomIsland(state, player)
      break
    case 'tax': {
      const owned = player.islandIds.length
      const amount = Math.max(ECONOMY.TAX_FLAT, owned * ECONOMY.TAX_PER_ISLAND)
      addLog(state, `${player.name} 缴纳天上金 ${amount} 贝利。`)
      settleDebt(state, player, amount)
      backToAction(state)
      break
    }
    case 'port':
      player.cash += ECONOMY.PORT_SUPPLY
      addLog(state, `${player.name} 港口补给，领取 ${ECONOMY.PORT_SUPPLY} 贝利。`)
      backToAction(state)
      break
    case 'jail':
      sendToJail(state, player)
      // 入狱后本回合结束，等下一回合才坐牢掷骰出狱
      backToAction(state)
      break
    case 'fruit':
      resolveFruitCell(state, player)
      break
    case 'event':
      resolveEventCell(state, player)
      break
    case 'history':
      resolveHistoryCell(state, player)
      break
    case 'laugh_tale':
      resolveLaughTale(state, player)
      break
    case 'go':
      addLog(state, `${player.name} 落在颠倒山。`)
      backToAction(state)
      break
  }
}

// 有名岛屿：购买或交租
function resolveIsland(state, player, island) {
  const st = state.islandState[island.id]
  if (st.ownerId === null) {
    // 无主：等待买 / 放弃
    state.phase = 'awaitBuy'
    state.pendingIslandId = island.id
    addLog(state, `${player.name} 抵达无主岛屿「${island.name}」，可花 ${island.price} 购买。`)
  } else if (st.ownerId === player.id) {
    addLog(state, `${player.name} 回到自己的「${island.name}」。`)
    backToAction(state)
  } else {
    if (player.rentImmune) {
      addLog(state, `${player.name} 免疫了「${island.name}」的租金，无需缴租！`)
      backToAction(state)
      return
    }
    const owner = state.players.find((x) => x.id === st.ownerId)
    const rent = getRent(state, island)
    addLog(state, `${player.name} 停在 ${owner.name} 的「${island.name}」，缴租 ${rent} 贝利。`)
    settleDebt(state, player, rent, owner, 'rent')
    backToAction(state)
  }
}

// 随机岛屿格：从无主岛随机一个触发购买；全有主则随机结算租金
function resolveRandomIsland(state, player) {
  const unowned = Object.values(ISLAND_BY_ID).filter((i) => state.islandState[i.id].ownerId === null)
  if (unowned.length > 0) {
    const pick = unowned[Math.floor(Math.random() * unowned.length)]
    addLog(state, `随机岛屿格抽到无主岛「${pick.name}」。`)
    state.phase = 'awaitBuy'
    state.pendingIslandId = pick.id
  } else {
    const all = Object.values(ISLAND_BY_ID)
    const pick = all[Math.floor(Math.random() * all.length)]
    const owner = state.players.find((x) => x.id === state.islandState[pick.id].ownerId)
    if (player.rentImmune) {
      addLog(state, `随机岛屿格抽到「${pick.name}」，但 ${player.name} 免疫租金。`)
      backToAction(state)
      return
    }
    const rent = getRent(state, pick)
    addLog(state, `随机岛屿格抽到「${pick.name}」，向 ${owner.name} 缴租 ${rent}。`)
    settleDebt(state, player, rent, owner, 'rent')
    backToAction(state)
  }
}

// ---------- 手牌辅助 ----------
function addCardToHand(state, player, card) {
  if (player.hand.length >= ECONOMY.HAND_LIMIT) return { error: '手牌已满（上限5）' }
  player.hand.push(card)
  return { status: 'ok' }
}
function removeCard(player, uid) {
  const i = player.hand.findIndex((c) => c.uid === uid)
  if (i >= 0) return player.hand.splice(i, 1)[0]
  return null
}
function grantCard(state, player, card, label) {
  const r = addCardToHand(state, player, card)
  if (r.error) {
    addLog(state, `${player.name} 手牌已满，${label}未能获得。`)
    return false
  }
  return true
}

// ---------- 恶魔果实格 ----------
function resolveFruitCell(state, player) {
  const r = Math.random()
  if (r < 0.6) {
    const fruit = FRUITS[Math.floor(Math.random() * FRUITS.length)]
    const ok = grantCard(state, player, { uid: newUid('c'), kind: 'fruit', defId: fruit.id }, '恶魔果实')
    if (ok) addLog(state, `${player.name} 获得恶魔果实「${fruit.name}」。`)
  } else if ( r < 0.95) {
    const hk = HAKI[Math.floor(Math.random() * 2)]
    const ok = grantCard(state, player, { uid: newUid('c'), kind: 'haki', defId: hk.id }, '霸气卡')
    if (ok) addLog(state, `${player.name} 获得霸气卡「${hk.name}」。`)
  } else {
    const ok = grantCard(state, player, { uid: newUid('c'), kind: 'haki', defId: 'conqueror' }, '霸王色')
    if (ok) addLog(state, `${player.name} 获得稀有「霸王色霸气」！`)
  }
  backToAction(state)
}

// ---------- 事件抽牌（含罗宾加成）----------
function drawEvent(state, player) {
  const isRobin = player.charId === 7
  if (player.stats) player.stats.eventsDrawn += 1
  const weightOf = (e) => (isRobin && e.id === 'evt_05' ? e.weight * 2 : e.weight)
  const totalW = EVENTS.reduce((s, e) => s + weightOf(e), 0)
  const goodW = EVENTS.filter((e) => e.kind === 'good').reduce((s, e) => s + weightOf(e), 0)
  let goodProb = goodW / totalW
  if (isRobin) goodProb = Math.min(1, goodProb + 0.15)
  const pool = Math.random() < goodProb
    ? EVENTS.filter((e) => e.kind === 'good')
    : EVENTS.filter((e) => e.kind !== 'good')
  const poolW = pool.reduce((s, e) => s + weightOf(e), 0)
  let r = Math.random() * poolW
  for (const e of pool) {
    r -= weightOf(e)
    if (r <= 0) return e
  }
  return pool[pool.length - 1]
}

// ---------- 事件格 ----------
function resolveEventCell(state, player) {
  const evt = drawEvent(state, player)
  addLog(state, `${player.name} 抽到事件「${evt.name}」。`)
  // 负面事件且持有见闻色：询问是否取消
  if (evt.kind === 'bad' && hasCard(player, 'haki', 'observation')) {
    state.modal = { type: 'observationCancel', eventId: evt.id }
    state.phase = 'awaitEventCancel'
    return
  }
  applyEvent(state, player, evt)
}

// 见闻色取消负面事件：cancel=true 取消 / false 硬吃
export function decisionEventCancel(state, cancel) {
  const p = getCurrentPlayer(state)
  if (!state.modal || state.modal.type !== 'observationCancel') return { error: '当前没有待取消的事件' }
  const evt = EVENT_BY_ID[state.modal.eventId]
  if (cancel) {
    const card = p.hand.find((c) => c.kind === 'haki' && c.defId === 'observation')
    if (!card) {
      // 见闻色卡已不在，只能承受
      state.modal = null
      applyEvent(state, p, evt)
      return { status: 'ok' }
    }
    removeCard(p, card.uid)
    addLog(state, `${p.name} 用见闻色取消了「${evt.name}」。`)
    state.modal = null
    backToAction(state)
    return { status: 'ok' }
  }
  state.modal = null
  applyEvent(state, p, evt)
  return { status: 'ok' }
}

// 花花果实：确认刚抽到的事件是否生效
export function decisionFlower(state, accept) {
  const m = state.modal
  if (!m || m.type !== 'flowerEvent') return { error: '当前没有待确认的事件' }
  const p = getCurrentPlayer(state)
  const evt = EVENT_BY_ID[m.eventId]
  state.modal = null
  if (!accept) {
    addLog(state, `${p.name} 放弃了这次事件。`)
    backToAction(state)
    return { status: 'ok' }
  }
  applyEvent(state, p, evt)
  return { status: 'ok' }
}

// ---------- 历史正文格 ----------
function resolveHistoryCell(state, player) {
  const piece = Object.values(state.historyPieces)
    .find((p) => p.source === 'cell' && p.cellIndex === player.position)
  if (!piece || piece.ownerId !== null) {
    addLog(state, `${player.name} 抵达历史正文格，但此块已被取得。`)
    backToAction(state)
    return
  }
  const price = player.charId === 7 ? ECONOMY.HISTORY_BUY_ROBIN : ECONOMY.HISTORY_BUY
  state.pendingHistoryId = piece.id
  state.pendingHistoryPrice = price
  state.phase = 'awaitBuyHistory'
  addLog(state, `${player.name} 可花 ${price} 贝利购买一块路标历史正文。`)
}

// ---------- 拉夫德鲁格 ----------
function resolveLaughTale(state, player) {
  const owned = getHistoryIds(player).length
  if (owned >= 4) {
    state.winner = player
    state.winKind = 'laftel'
    state.phase = 'ended'
    addLog(state, `🏆 ${player.name} 抵达拉夫德鲁，成为海贼王！`)
  } else {
    addLog(state, `${player.name} 抵达拉夫德鲁，但尚未集齐4块历史正文（${owned}/4）。`)
    backToAction(state)
  }
}

// ---------- 玩家动作：掷骰 ----------
export function roll(state) {
  const p = getCurrentPlayer(state)
  if (state.phase !== 'awaitRoll' || p.bankrupt) return { error: '当前不能掷骰' }

  // 被冰冻：本回合无法行动
  if (p.frozen > 0) {
    p.frozen -= 1
    addLog(state, `${p.name} 被冰冻，本回合无法行动。`)
    advanceToNext(state)
    return { status: 'frozen' }
  }

  // 坐牢中：掷骰看能否出狱
  if (p.inJail) {
    const dice = rollTwoDice()
    state.lastDice = dice
    if (dice.isDoubles) {
      p.inJail = false
      p.jailTurns = 0
      addLog(state, `${p.name} 坐牢掷出双数（${dice.d1}+${dice.d2}），出狱并移动！`)
      moveNormal(state, p, dice.total)
      resolveLanding(state, p)
      return { status: 'jailRelease', dice }
    }
    p.jailTurns -= 1
    if (p.jailTurns <= 0) {
      p.inJail = false
      addLog(state, `${p.name} 停满刑期出狱（本回合不移动）。`)
    } else {
      addLog(state, `${p.name} 坐牢掷出 ${dice.total}，未能出狱（还剩 ${p.jailTurns} 回合）。`)
    }
    backToAction(state)
    return { status: 'jailStay', dice }
  }

  // 正常掷骰
  const dice = rollTwoDice()
  state.lastDice = dice

  // 霸王色威慑：掷点结果 −2（最低 1）
  if (p.diceDebuff > 0) {
    p.diceDebuff = 0
    const nt = Math.max(1, dice.total - 2)
    addLog(state, `${p.name} 受霸王色威慑，掷点降为 ${nt}。`)
    dice.total = nt
  }

  // 乌索普·狙击预判：可重掷（二选一）；但已两次双数且本次又双数时直接入狱
  const wouldBeThirdDoubles = dice.isDoubles && p.doubles + 1 >= DICE.MAX_DOUBLES_BEFORE_JAIL
  const canReroll = p.charId === 5 && p.skillUsed < getChar(p).skillUses && !wouldBeThirdDoubles
  if (canReroll) {
    addLog(state, `${p.name} 掷出 ${dice.d1}+${dice.d2}=${dice.total}，可重掷。`)
    state.pendingReroll = { first: dice }
    state.phase = 'awaitReroll'
    return { status: 'awaitReroll', dice }
  }

  if (dice.isDoubles) p.doubles += 1
  else p.doubles = 0

  // 连续三次双数：立即入狱
  if (p.doubles >= DICE.MAX_DOUBLES_BEFORE_JAIL) {
    addLog(state, `${p.name} 连续三次双数！`)
    sendToJail(state, p)
    // 入狱后本回合结束，等下一回合才坐牢掷骰出狱
    backToAction(state)
    return { status: 'jailed', dice }
  }

  addLog(state, `${p.name} 掷出 ${dice.d1}+${dice.d2}=${dice.total}${dice.isDoubles ? '（双数）' : ''}。`)
  commitMove(state, p, dice)
  return { status: 'ok', dice }
}

// 执行移动 + 落格
function commitMove(state, p, dice) {
  // 索隆·迷路斩：掷出双 1（蛇眼）朝反方向移动（后退总点数 2 格），不领起点经费
  if (p.charId === 2 && dice.d1 === 1 && dice.d2 === 1) {
    addLog(state, `${p.name} 掷出蛇眼，迷路斩反向航行 2 格。`)
    forceMoveSteps(state, p, 2, true)
    return
  }
  moveNormal(state, p, dice.total)
  resolveLanding(state, p)
}

// 乌索普重掷决策：reroll=true 重掷 / false 保留
export function decisionReroll(state, reroll) {
  const p = getCurrentPlayer(state)
  if (!state.pendingReroll || !state.pendingReroll.first) return { error: '当前没有待重掷的骰子' }
  const first = state.pendingReroll.first
  p.skillUsed += 1
  let chosen = first
  if (reroll) {
    chosen = rollTwoDice()
    state.lastDice = chosen
    addLog(state, `${p.name} 重掷为 ${chosen.d1}+${chosen.d2}=${chosen.total}（原 ${first.total}）。`)
  } else {
    addLog(state, `${p.name} 保留原点数 ${first.total}。`)
  }
  if (chosen.isDoubles) p.doubles += 1
  else p.doubles = 0
  state.pendingReroll = null
  if (p.doubles >= DICE.MAX_DOUBLES_BEFORE_JAIL) {
    sendToJail(state, p)
    backToAction(state)
    return { status: 'jailed', dice: chosen }
  }
  commitMove(state, p, chosen)
  return { status: 'ok', dice: chosen }
}

// ---------- 玩家动作：购买 ----------
export function buy(state) {
  const p = getCurrentPlayer(state)
  if (state.phase !== 'awaitBuy' || state.pendingIslandId == null) return { error: '当前不能购买' }
  const id = state.pendingIslandId
  const island = ISLAND_BY_ID[id]
  // 折扣：索隆 8 折；拍卖（state.pendingDiscount）7 折
  let price = island.price
  if (p.charId === 2) price = Math.round(price * 0.8)
  if (state.pendingDiscount) price = Math.round(price * state.pendingDiscount)
  // 钱不够：直接拒绝购买，玩家可选择放弃（不强制变卖）
  if (p.cash < price) {
    return { error: '钱不够，无法购买' }
  }
  p.cash -= price
  state.islandState[id] = { ownerId: p.id, level: 0 }
  p.islandIds.push(id)
  addLog(state, `${p.name} 买下「${island.name}」，花费 ${price}。`)
  state.pendingIslandId = null
  state.pendingDiscount = null
  backToAction(state)
  return { status: 'ok' }
}

// ---------- 玩家动作：放弃购买 ----------
export function declineBuy(state) {
  if (state.phase !== 'awaitBuy') return { error: '当前无待购岛屿' }
  const island = ISLAND_BY_ID[state.pendingIslandId]
  addLog(state, `${getCurrentPlayer(state).name} 放弃购买「${island.name}」。`)
  state.pendingIslandId = null
  state.pendingDiscount = null
  backToAction(state)
  return { status: 'ok' }
}

// ---------- 历史正文格：购买 / 放弃 ----------
export function buyHistory(state) {
  const p = getCurrentPlayer(state)
  if (state.phase !== 'awaitBuyHistory' || state.pendingHistoryId == null) {
    return { error: '当前不能购买历史正文' }
  }
  const price = state.pendingHistoryPrice
  if (p.cash < price) return { error: '钱不够，无法购买' }
  // PRD §4.1：手牌上限 5 张（果实 + 霸气 + 历史正文合计）
  if (p.hand.length >= ECONOMY.HAND_LIMIT) return { error: '手牌已满（上限5），无法再收下历史正文' }
  p.cash -= price
  const piece = state.historyPieces[state.pendingHistoryId]
  piece.ownerId = p.id
  p.hand.push({ uid: newUid('c'), kind: 'history', defId: 'history', historyId: piece.id })
  addLog(state, `${p.name} 购得一块路标历史正文（共 ${getHistoryIds(p).length}/4）。`)
  state.pendingHistoryId = null
  state.pendingHistoryPrice = null
  backToAction(state)
  return { status: 'ok' }
}

export function declineHistory(state) {
  if (state.phase !== 'awaitBuyHistory') return { error: '当前无待购历史正文' }
  addLog(state, `${getCurrentPlayer(state).name} 放弃购买历史正文。`)
  state.pendingHistoryId = null
  state.pendingHistoryPrice = null
  backToAction(state)
  return { status: 'ok' }
}

// ---------- 玩家动作：升级 ----------
export function upgrade(state, islandId) {
  const p = getCurrentPlayer(state)
  if (state.phase !== 'awaitAction') return { error: '当前不能升级' }
  // PRD §8.4：坐牢 / 冰冻期间不可主动升级
  if (p.inJail) return { error: '坐牢期间无法升级岛屿' }
  if (p.frozen > 0) return { error: '冰冻期间无法升级岛屿' }
  const st = state.islandState[islandId]
  const island = ISLAND_BY_ID[islandId]
  if (!st || st.ownerId !== p.id) return { error: '不是你的岛屿' }
  if (st.level >= 3) return { error: '已满级' }
  // 弗兰奇·改造建造：升级费 7 折
  const cost = p.charId === 8 ? Math.round(island.upgradeCost * 0.7) : island.upgradeCost
  const r = settleDebt(state, p, cost)
  if (r.status === 'bankrupt') return r
  st.level += 1
  addLog(state, `${p.name} 将「${island.name}」升到 ${st.level} 级，花费 ${cost}。`)
  return { status: 'ok' }
}

// 推进到下一个未破产玩家
function advanceToNext(state) {
  const prev = state.current
  const prevP = state.players[prev]
  // 离开该玩家回合：清除本回合免租（mochiWard 跨回合保留）
  prevP.rentImmune = false
  let next = prev
  do {
    next = (next + 1) % state.players.length
  } while (state.players[next].bankrupt)
  state.current = next
  if (next <= prev) state.turn += 1 // 绕回一圈，回合数 +1
  state.players[next].cardsUsedThisTurn = 0
  state.tradeAttempted = false
  state.phase = 'awaitRoll'
  // 兜底：若跳过破产玩家后只剩 1 人存活，直接结束
  checkWinner(state)
}

// ---------- 玩家动作：结束回合 ----------
export function endTurn(state) {
  if (state.phase === 'ended') return { status: 'ended' }
  const p = getCurrentPlayer(state)

  // 当前玩家已破产：直接跳过他
  if (p.bankrupt) {
    advanceToNext(state)
    addLog(state, `轮到 ${getCurrentPlayer(state).name}。`)
    return { status: 'next' }
  }

  if (state.phase !== 'awaitAction') return { error: '当前不能结束回合' }

  // 双数追加（非坐牢）：同一玩家再掷一次
  if (p.doubles > 0 && !p.inJail) {
    addLog(state, `${p.name} 因双数再掷一次！`)
    state.phase = 'awaitRoll'
    return { status: 'extra' }
  }

  advanceToNext(state)
  addLog(state, `轮到 ${getCurrentPlayer(state).name}。`)
  return { status: 'next' }
}

// ---------- 胜利判定 ----------
export function checkWinner(state) {
  const alive = state.players.filter((p) => !p.bankrupt)
  if (alive.length === 1 && state.players.length > 1) {
    state.winner = alive[0]
    state.winKind = 'bankruptcy'
    state.phase = 'ended'
    addLog(state, `🏆 ${alive[0].name} 成为海贼王！`)
  }
  return state.winner
}

// ============================================================
// 13 张事件卡效果
// ============================================================
function applyEvent(state, p, evt) {
  // 乔巴·应急治疗：本次损失减半（treatHalf 由主动技能设置）
  const half = p.treatHalf ? 0.5 : 1
  p.treatHalf = false

  switch (evt.id) {
    case 'evt_01': // 沉船宝藏
      p.cash += 150
      addLog(state, `${p.name} 发现沉船宝藏，+150 贝利。`)
      backToAction(state)
      break

    case 'evt_02': { // 革命军相助
      const hk = HAKI[Math.floor(Math.random() * 2)]
      const ok = grantCard(state, p, { uid: newUid('c'), kind: 'haki', defId: hk.id }, '霸气卡')
      if (ok) addLog(state, `${p.name} 获革命军相助，得到「${hk.name}」。`)
      backToAction(state)
      break
    }

    case 'evt_03': { // 港口顺风：前进到下一个港口
      for (let k = 1; k <= BOARD_SIZE; k++) {
        const idx = (p.position + k) % BOARD_SIZE
        if (BOARD[idx].type === 'port') {
          addLog(state, `${p.name} 顺风直达港口。`)
          forceLand(state, p, idx)
          return
        }
      }
      backToAction(state)
      break
    }

    case 'evt_04': { // 记录指针指引：前进 2–5
      const steps = 2 + Math.floor(Math.random() * 4)
      addLog(state, `${p.name} 记录指针指引前进 ${steps} 格。`)
      forceMoveSteps(state, p, steps)
      return
    }

    case 'evt_05': { // 历史正文线索
      // 优先事件块；事件块取完后可发现未被取的格产块
      let avail = Object.values(state.historyPieces)
        .filter((x) => x.source === 'event' && x.ownerId === null)
      if (avail.length === 0) {
        avail = Object.values(state.historyPieces).filter((x) => x.ownerId === null)
      }
      if (avail.length > 0) {
        const piece = avail[Math.floor(Math.random() * avail.length)]
        piece.ownerId = p.id
        p.hand.push({ uid: newUid('c'), kind: 'history', defId: 'history', historyId: piece.id })
        addLog(state, `${p.name} 经由线索获得一块路标历史正文（${getHistoryIds(p).length}/4）。`)
      } else {
        p.cash += 100
        addLog(state, `4块历史正文均已被取得，${p.name} 改得 100 贝利。`)
      }
      backToAction(state)
      break
    }

    case 'evt_06': { // 海军围捕
      const d = rollDie()
      if (d % 2 === 0) {
        const fine = Math.round(80 * half)
        addLog(state, `${p.name} 掷出 ${d}（偶数），罚款 ${fine}。`)
        settleDebt(state, p, fine, null, 'event')
      } else {
        addLog(state, `${p.name} 掷出 ${d}（奇数），押进推进城！`)
        sendToJail(state, p)
      }
      backToAction(state)
      break
    }

    case 'evt_07': // 海王类
      if (p.charId === 10) {
        p.cash += 30
        addLog(state, `${p.name}（甚平）精通海流，遇海王类反得 30。`)
      } else {
        const loss = Math.round(70 * half)
        addLog(state, `${p.name} 遭海王类袭击，损失 ${loss}。`)
        settleDebt(state, p, loss, null, 'event')
      }
      backToAction(state)
      break

    case 'evt_08': // 暴风雨
      if (p.charId === 10) {
        p.cash += 30
        addLog(state, `${p.name}（甚平）躲过暴风雨，反得 30。`)
        backToAction(state)
      } else {
        addLog(state, `${p.name} 暴风雨中后退 2 格。`)
        forceMoveSteps(state, p, 2, true)
        const loss = Math.round(60 * half)
        if (!p.bankrupt) {
          addLog(state, `${p.name} 暴风雨损失 ${loss}。`)
          settleDebt(state, p, loss, null, 'event')
        }
        backToAction(state)
      }
      break

    case 'evt_09': { // 四皇
      const raw = Math.max(50, Math.min(300, Math.round(p.cash * 0.1)))
      const fee = Math.round(raw * half)
      addLog(state, `${p.name} 被四皇盯上，缴纳保护费 ${fee}。`)
      settleDebt(state, p, fee, null, 'event')
      backToAction(state)
      break
    }

    case 'evt_10': { // 食物中毒
      const loss = Math.round(80 * half)
      addLog(state, `${p.name} 食物中毒，损失 ${loss}。`)
      settleDebt(state, p, loss, null, 'event')
      backToAction(state)
      break
    }

    case 'evt_11': { // DAVY BACK
      const others = state.players.filter((x) => x !== p && !x.bankrupt)
      if (others.length === 0) { backToAction(state); break }
      const opp = others[Math.floor(Math.random() * others.length)]
      const a = rollDie()
      const b = rollDie()
      if (a >= b) {
        settleDebt(state, opp, 100, p, 'event')
        addLog(state, `DAVY BACK：${p.name}(${a}) 胜 ${opp.name}(${b})，赢得 100。`)
      } else {
        settleDebt(state, p, 100, opp, 'event')
        addLog(state, `DAVY BACK：${opp.name}(${b}) 胜 ${p.name}(${a})，${p.name} 失去 100。`)
      }
      backToAction(state)
      break
    }

    case 'evt_12': { // 地下拍卖会
      const unowned = Object.values(ISLAND_BY_ID).filter((i) => state.islandState[i.id].ownerId === null)
      if (unowned.length === 0) {
        addLog(state, '拍卖会无岛可拍。')
        backToAction(state)
      } else {
        const pick = unowned[Math.floor(Math.random() * unowned.length)]
        state.phase = 'awaitBuy'
        state.pendingIslandId = pick.id
        state.pendingDiscount = 0.7
        addLog(state, `拍卖会：「${pick.name}」可 7 折竞拍（${Math.round(pick.price * 0.7)}）。`)
      }
      break
    }

    case 'evt_13': { // 记录指针紊乱
      const target = Math.floor(Math.random() * BOARD_SIZE)
      addLog(state, `${p.name} 记录指针紊乱，随机传送。`)
      forceLand(state, p, target)
      return
    }

    default:
      backToAction(state)
  }
}

// ============================================================
// 角色主动技能
// ============================================================
export function useSkill(state) {
  const p = getCurrentPlayer(state)
  if (p.inJail) return { error: '坐牢期间无法使用主动技能' }
  if (p.frozen > 0) return { error: '冰冻期间无法使用主动技能' }
  const ch = getChar(p)
  if (ch.skillType !== 'active') return { error: '该角色技能为被动，自动触发' }
  if (p.skillUsed >= ch.skillUses) return { error: '技能已用尽' }
  switch (p.charId) {
    case 1: // 路飞·橡胶耍赖
      p.rentImmune = true
      p.skillUsed += 1
      addLog(state, `${p.name} 发动「橡胶耍赖」，本回合免租！`)
      return { status: 'ok' }
    case 6: // 乔巴·应急治疗
      p.treatHalf = true
      p.skillUsed += 1
      addLog(state, `${p.name} 发动「应急治疗」，下次负面损失减半。`)
      return { status: 'ok' }
    case 5:
      return { error: '狙击预判：请在掷骰后选择是否重掷' }
    case 9:
      return { error: '黄泉复活在即将破产时自动触发' }
    default:
      return { error: '技能不可用' }
  }
}

// ============================================================
// 恶魔果实
// ============================================================
// 果实效果是否被受害者抵消（糯糯护盾 / 武装色）
function fruitCountered(state, victim, fruit) {
  if (!victim || victim.bankrupt) return false
  if (victim.mochiWard) {
    victim.mochiWard = false
    addLog(state, `${victim.name} 的糯糯果实抵消了「${fruit.name}」！`)
    return true
  }
  const armCard = victim.hand.find((c) => c.kind === 'haki' && c.defId === 'armament')
  if (armCard) {
    removeCard(victim, armCard.uid)
    addLog(state, `${victim.name} 用武装色抵消了「${fruit.name}」！`)
    return true
  }
  return false
}

// 使用果实（需在 awaitAction；指向性果实进入 awaitTarget）
export function useFruit(state, uid) {
  const p = getCurrentPlayer(state)
  const card = p.hand.find((c) => c.uid === uid)
  if (!card || card.kind !== 'fruit') return { error: '没有该果实' }
  if (state.phase !== 'awaitAction') return { error: '当前不能用卡' }
  if (p.inJail) return { error: '坐牢期间无法使用道具' }
  if (p.frozen > 0) return { error: '冰冻期间无法使用道具' }
  if (p.cardsUsedThisTurn >= 1) return { error: '本回合已主动使用过1张卡' }
  const fruit = FRUIT_BY_ID[card.defId]
  if (!fruit) { removeCard(p, uid); return { error: '果实数据异常，已丢弃' } }
  if (fruit.target === 'player') {
    state.pendingFruitUid = uid
    state.phase = 'awaitTarget'
    return { status: 'awaitTarget', fruit }
  }
  executeFruit(state, p, card, fruit, null)
  return { status: 'ok' }
}

export function confirmFruitTarget(state, targetId) {
  const p = getCurrentPlayer(state)
  if (!state.pendingFruitUid) return { error: '当前没有待选目标的果实' }
  const target = state.players.find((x) => x.id === targetId)
  if (!target || target.bankrupt) return { error: '目标玩家无效' }
  if (target.id === p.id) return { error: '不能以自己为目标' }
  const uid = state.pendingFruitUid
  const card = p.hand.find((c) => c.uid === uid)
  if (!card) return { error: '未选择目标' }
  const fruit = FRUIT_BY_ID[card.defId]
  if (!fruit) { state.pendingFruitUid = null; return { error: '果实数据异常' } }
  state.pendingFruitUid = null
  executeFruit(state, p, card, fruit, targetId)
  return { status: 'ok' }
}

export function cancelTarget(state) {
  state.pendingFruitUid = null
  backToAction(state)
  return { status: 'ok' }
}

// 果实结算后回到行动阶段；若已产生赢家则保持结束状态
function backToAction(state) {
  if (!state.winner) state.phase = 'awaitAction'
}

function executeFruit(state, p, card, fruit, targetId) {
  removeCard(p, card.uid)
  p.cardsUsedThisTurn += 1
  if (p.stats) p.stats.cardsUsed += 1
  addLog(state, `${p.name} 使用「${fruit.name}」。`)

  switch (fruit.id) {
    case 'dark': {
      const t = state.players.find((x) => x.id === targetId)
      if (fruitCountered(state, t, fruit)) { backToAction(state); break }
      const pool = stealableCards(t)
      if (pool.length === 0) {
        addLog(state, `${t.name} 没有可偷的卡。`)
        backToAction(state)
        break
      }
      const stolen = pool[Math.floor(Math.random() * pool.length)]
      removeCard(t, stolen.uid)
      if (p.hand.length >= ECONOMY.HAND_LIMIT) {
        addLog(state, `${p.name} 手牌已满，偷来的卡消散。`)
      } else {
        p.hand.push(stolen)
        const def = stolen.kind === 'fruit' ? FRUIT_BY_ID[stolen.defId] : HAKI_BY_ID[stolen.defId]
        addLog(state, `${p.name} 从 ${t.name} 处偷得「${def.name}」！`)
      }
      backToAction(state)
      break
    }
    case 'quake': {
      const victims = state.players.filter((x) => x !== p && !x.bankrupt)
      for (const v of victims) {
        if (fruitCountered(state, v, fruit)) continue
        addLog(state, `${v.name} 受海震损失 80。`)
        settleDebt(state, v, 80, null, 'fruit')
      }
      backToAction(state)
      break
    }
    case 'light': {
      const steps = 1 + Math.floor(Math.random() * 6)
      addLog(state, `${p.name} 闪闪果实再前进 ${steps} 格。`)
      forceMoveSteps(state, p, steps)
      return
    }
    case 'ice': {
      const t = state.players.find((x) => x.id === targetId)
      if (fruitCountered(state, t, fruit)) { backToAction(state); break }
      t.frozen = 1
      addLog(state, `${t.name} 被冰冻，下回合无法行动！`)
      backToAction(state)
      break
    }
    case 'magma': {
      const t = state.players.find((x) => x.id === targetId)
      if (fruitCountered(state, t, fruit)) { backToAction(state); break }
      addLog(state, `${t.name} 被岩浆逼退 3 格。`)
      forceMoveSteps(state, t, 3, true)
      return
    }
    case 'paw': {
      const t = state.players.find((x) => x.id === targetId)
      if (fruitCountered(state, t, fruit)) { backToAction(state); break }
      const target = Math.floor(Math.random() * BOARD_SIZE)
      addLog(state, `${t.name} 被肉球弹飞。`)
      forceLand(state, t, target)
      return
    }
    case 'mochi':
      p.mochiWard = true
      addLog(state, `${p.name} 获得糯糯护盾，将抵消一次果实。`)
      backToAction(state)
      break
    case 'op': {
      const t = state.players.find((x) => x.id === targetId)
      if (fruitCountered(state, t, fruit)) { backToAction(state); break }
      const a = p.position
      const b = t.position
      addLog(state, `${p.name} 与 ${t.name} 交换位置。`)
      p.position = b
      t.position = a
      resolveLanding(state, p)
      resolveLanding(state, t)
      return
    }
    case 'flower': {
      // PRD §4.1：再抽 1 张事件卡并「选择是否生效」——先进入决策态，由玩家确认
      const evt = drawEvent(state, p)
      addLog(state, `${p.name} 花花果实再抽事件「${evt.name}」，可选择是否生效。`)
      state.modal = { type: 'flowerEvent', eventId: evt.id }
      state.phase = 'awaitFlower'
      return
    }
    case 'chop':
      p.rentImmune = true
      addLog(state, `${p.name} 四分五裂，本回合免疫租金。`)
      backToAction(state)
      break
    default:
      backToAction(state)
  }
}

// ============================================================
// 霸气卡使用
// action: 'preview'（见闻色预览）/ 默认
// ============================================================
export function useHaki(state, uid, action = 'cancel') {
  const p = getCurrentPlayer(state)
  const card = p.hand.find((c) => c.uid === uid)
  if (!card || card.kind !== 'haki') return { error: '没有该霸气卡' }
  if (state.phase !== 'awaitAction') return { error: '当前不能用卡' }
  if (p.inJail) return { error: '坐牢期间无法使用霸气卡' }
  if (p.cardsUsedThisTurn >= 1) return { error: '本回合已主动使用过1张卡' }

  if (card.defId === 'conqueror') {
    removeCard(p, card.uid)
    p.cardsUsedThisTurn += 1
    if (p.stats) p.stats.cardsUsed += 1
    state.players.filter((x) => x !== p && !x.bankrupt).forEach((x) => { x.diceDebuff = 1 })
    addLog(state, `${p.name} 释放霸王色！其余玩家下回合掷点 −2。`)
    return { status: 'ok' }
  }
  if (card.defId === 'observation' && action === 'preview') {
    removeCard(p, card.uid)
    p.cardsUsedThisTurn += 1
    if (p.stats) p.stats.cardsUsed += 1
    const next = (p.position + 1) % BOARD_SIZE
    state.modal = { type: 'preview', position: next }
    addLog(state, `${p.name} 用见闻色预览下一格（位置 ${next}）。`)
    // preview 随返回值透传给客户端弹情报面板（state.modal 只作广播记录）
    return { status: 'ok', preview: { position: next, cell: BOARD[next] } }
  }
  if (card.defId === 'armament') return { error: '武装色在被果实攻击时自动抵消' }
  return { error: '见闻色将在抽到负面事件时提示取消' }
}

// ============================================================
// 最终航行：集齐 4 块历史正文直达拉夫德鲁
// ============================================================
export function finalVoyage(state) {
  const p = getCurrentPlayer(state)
  if (state.phase !== 'awaitAction') return { error: '当前无法发起最终航行' }
  if (getHistoryIds(p).length < 4) return { error: '尚未集齐4块路标历史正文' }
  state.winner = p
  state.winKind = 'laftel'
  state.phase = 'ended'
  addLog(state, `🚢 ${p.name} 发起最终航行，抵达拉夫德鲁，成为海贼王！`)
  return { status: 'ok' }
}

// ============================================================
// 历史正文交易（仅发起方回合；对手可接受/拒绝）
// ============================================================// direction: 'buy' 我买对方的块 / 'sell' 我把我的块卖给对方
export function proposeTrade(state, targetId, historyId, price, direction = 'buy') {
  const p = getCurrentPlayer(state)
  if (state.phase !== 'awaitAction') return { error: '当前无法发起交易' }
  const t = state.players.find((x) => x.id === targetId)
  if (!t || t.bankrupt) return { error: '交易对象无效' }
  const holder = direction === 'sell' ? p : t
  const card = holder.hand.find((c) => c.kind === 'history' && c.historyId === historyId)
  if (!card) return { error: '没有该历史正文' }
  // 价格必须是有限的非负整数：此前只判 price < 0，字符串会通过并把现金污染成 NaN
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) return { error: '价格无效' }
  state.modal = { type: 'trade', fromId: p.id, targetId, historyId, price, direction }
  state.phase = 'awaitTrade'
  return { status: 'ok' }
}

// byId：发起应答的玩家 id（联机由服务端传入）。只允许「被交易方」决定，防止发起方自买自卖。
export function decisionTrade(state, accept, byId = null) {
  const m = state.modal
  if (!m || m.type !== 'trade') return { error: '当前没有待处理的交易' }
  if (byId != null && byId !== m.targetId) return { error: '只能由被交易方决定是否成交' }
  let buyer
  let seller
  if (m.direction === 'sell') {
    seller = state.players.find((x) => x.id === m.fromId)
    buyer = state.players.find((x) => x.id === m.targetId)
  } else {
    buyer = state.players.find((x) => x.id === m.fromId)
    seller = state.players.find((x) => x.id === m.targetId)
  }
  if (accept) {
    const card = seller.hand.find((c) => c.kind === 'history' && c.historyId === m.historyId)
    if (!card || buyer.cash < m.price) {
      addLog(state, '交易条件不再满足，交易取消。')
      state.modal = null
      backToAction(state)
      return { error: '交易失败' }
    }
    buyer.cash -= m.price
    seller.cash += m.price
    removeCard(seller, card.uid)
    buyer.hand.push(card)
    state.historyPieces[m.historyId].ownerId = buyer.id
    addLog(state, `${buyer.name} 以 ${m.price} 贝利从 ${seller.name} 处购得一块路标历史正文。`)
  } else {
    addLog(state, '交易被拒绝。')
  }
  state.modal = null
  backToAction(state)
  return { status: 'ok' }
}

// ============================================================
// 广播脱敏：按座位视角裁剪 state（PRD §8.2 服务器权威 + 信息隔离）
// 手牌是私有信息：自己看全量；其他座位的果实/霸气只给数量（kind:'hidden'），
// 不泄露 uid/defId（uid 是出牌指令的凭据，泄露可伪造他人出牌）。
// 历史正文按 PRD §7 保持公开（交易必须能指定 historyId）。
// 单机/引擎内部不受影响——只有联机广播走这一层。
// ============================================================
export function maskedStateFor(state, seatIdx) {
  if (state == null || !Array.isArray(state.players)) return state
  const me = state.players[seatIdx]
  if (!me) return state
  let changed = false
  const players = state.players.map((p) => {
    if (p === me) return p
    const hist = p.hand.filter((c) => c.kind === 'history')
    const nHidden = p.hand.length - hist.length
    if (nHidden === 0) return p
    changed = true
    return {
      ...p,
      hand: [
        ...hist,
        ...Array.from({ length: nHidden }, (_, i) => ({ uid: `hidden_${p.id}_${i}`, kind: 'hidden', defId: 'hidden' }))
      ]
    }
  })
  // 绝大多数广播没有可裁内容，原样返回避免整棵拷贝
  if (!changed) return state
  return { ...state, players }
}

// ============================================================
// 测试/验收专用导出：内部结算函数不参与业务接口，仅供
// tools/acceptance_mechanics.mjs 做确定性用例（模拟落点、直接施放事件）。
// 生产代码不得引用 __test__。
// ============================================================
export const __test__ = {
  resolveLanding,
  applyEvent,
  drawEvent,
  moveNormal,
  forceMoveSteps,
  advanceToNext
}
