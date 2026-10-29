// ============================================================
// 托管 AI：空位填充 / 断线接管 / 超时代打。
// 简单策略：处理所有 phase；awaitAction 时 最终航行 > 用卡 > 升级 > 结束。
// ============================================================

import {
  getCurrentPlayer, roll, buy, declineBuy, buyHistory, declineHistory,
  upgrade, endTurn, useFruit, useHaki, confirmFruitTarget,
  cancelTarget, decisionReroll, decisionEventCancel, decisionFlower, finalVoyage,
  decisionTrade, proposeTrade, getHistoryIds
} from './engine.js'
import { ISLAND_BY_ID, BOARD } from './gameData.js'

export function isAIReady() {
  return true
}

// 选择目标：优先资金最多的对手
function pickTarget(state, self) {
  const others = state.players.filter((p) => p !== self && !p.bankrupt)
  if (others.length === 0) return null
  others.sort((a, b) => b.cash - a.cash)
  return others[0].id
}

// 执行一个 AI 动作
// opts.canControl(id) 可选：判断某个座位当前是否真由 AI 掌控（联机由服务端传入）。
// 交易阶段（awaitTrade）的决策权属于「被交易方」，不是当前行动玩家；发起方是 AI 时
// 若不加这道闸门，AI 会在 800ms 后替人类被交易方拍板（历史 bug：没点接受就成交）。
export function aiStep(state, opts = {}) {
  const canControl = typeof opts.canControl === 'function' ? opts.canControl : null
  const p = getCurrentPlayer(state)
  switch (state.phase) {
    case 'awaitRoll':
      roll(state)
      return 'roll'

    case 'awaitReroll': {
      const first = state.pendingReroll.first
      decisionReroll(state, first.total <= 6)
      return 'reroll'
    }

    case 'awaitBuy': {
      const isl = ISLAND_BY_ID[state.pendingIslandId]
      let price = isl.price
      if (p.charId === 2) price = Math.round(price * 0.8)
      if (state.pendingDiscount) price = Math.round(price * state.pendingDiscount)
      if (p.cash >= price) buy(state)
      else declineBuy(state)
      return 'buy'
    }

    case 'awaitBuyHistory': {
      // 买不起 或 手牌已满（上限 5 含正文）都必须放弃，否则 phase 不变会死循环
      const r = p.cash >= state.pendingHistoryPrice ? buyHistory(state) : { error: 'no cash' }
      if (r.error) declineHistory(state)
      return 'buyHistory'
    }

    case 'awaitEventCancel':
      decisionEventCancel(state, true)
      return 'eventCancel'

    case 'awaitFlower':
      // 花花果实：AI 一律让事件生效（正面占多数）
      decisionFlower(state, true)
      return 'flowerEvent'

    case 'awaitTarget': {
      const tid = pickTarget(state, p)
      if (tid == null) cancelTarget(state)
      else {
        // 目标非法（已破产等）时取消，避免停留在 awaitTarget 空转
        const r = confirmFruitTarget(state, tid)
        if (r && r.error) cancelTarget(state)
      }
      return 'target'
    }

    case 'awaitTrade': {
      const m = state.modal
      if (!m || m.type !== 'trade') return 'idle'
      const decider = m.targetId
      // 决策权在被交易方：该座位由人操作时绝不代答（返回 tradeWait，服务端继续等）。
      if (canControl && !canControl(decider)) return 'tradeWait'
      let accept
      if (m.direction === 'sell') {
        // 决策者是买方（targetId）：在收集历史或价格划算时接受
        const buyer = state.players.find((x) => x.id === decider)
        accept = !!buyer && buyer.cash >= m.price && (getHistoryIds(buyer).length >= 1 || m.price <= 250)
      } else {
        // 决策者是卖方（targetId）：出价高或自己缺钱时接受
        const seller = state.players.find((x) => x.id === decider)
        accept = !!seller && (m.price >= 250 || seller.cash < 300)
      }
      // 交易条件可能已失效：失败时取消 modal，避免永久停在 awaitTrade。
      // byId 传决策者自身，兼作引擎层二次校验（非被交易方永远无法成交）。
      const r = decisionTrade(state, accept, decider)
      if (r && r.error) state.modal = null
      return 'trade'
    }

    case 'awaitAction':
      return aiAction(state, p)

    default:
      return 'idle'
  }
}

// awaitAction 策略
function aiAction(state, p) {
  // 坐牢 / 冰冻期间不能升级、不能主动用卡（PRD §8.4）：
  // 直接结束回合。否则下面的 useFruit/upgrade 会一直返回错误、phase 不变，
  // 托管循环将永久空转（历史 bug：AI 入狱后整局卡死）。
  if (p.inJail || p.frozen > 0) {
    endTurn(state)
    return 'end(noAction)'
  }

  // 集齐 4 块：最终航行
  if (getHistoryIds(p).length >= 4) {
    finalVoyage(state)
    return 'finalVoyage'
  }

  const myHist = getHistoryIds(p)

  // 资金紧张且持有历史正文 → 主动叫卖（避免破产散佚）
  if (p.cash < 250 && myHist.length >= 1 && !state.tradeAttempted) {
    const buyers = state.players.filter((x) => x !== p && !x.bankrupt).sort((a, b) => b.cash - a.cash)
    const sellCard = p.hand.find((c) => c.kind === 'history')
    if (buyers.length && sellCard && buyers[0].cash >= 250) {
      state.tradeAttempted = true
      proposeTrade(state, buyers[0].id, sellCard.historyId, 250, 'sell')
      return 'sell'
    }
  }

  // 主动收购历史正文：已持有≥1块、资金≥350、本回合未尝试
  if (myHist.length >= 1 && p.cash >= 350 && !state.tradeAttempted) {
    for (const other of state.players) {
      if (other === p || other.bankrupt) continue
      const oCard = other.hand.find((c) => c.kind === 'history')
      if (oCard) {
        const offer = Math.max(250, Math.round(p.cash * 0.3))
        if (p.cash >= offer) {
          state.tradeAttempted = true
          proposeTrade(state, other.id, oCard.historyId, offer)
          return 'proposeTrade'
        }
      }
    }
  }

  // 用果实（self 类立即生效，player 类进入 awaitTarget）
  const fruitCard = p.hand.find((c) => c.kind === 'fruit')
  if (fruitCard && p.cardsUsedThisTurn < 1) {
    useFruit(state, fruitCard.uid)
    return 'fruit'
  }

  // 霸王色
  const conc = p.hand.find((c) => c.kind === 'haki' && c.defId === 'conqueror')
  if (conc && p.cardsUsedThisTurn < 1) {
    useHaki(state, conc.uid)
    return 'conqueror'
  }

  // 升级当前所在的自己的岛
  const cell = BOARD[p.position]
  if (cell && cell.type === 'island') {
    const isl = ISLAND_BY_ID[cell.islandId]
    const st = state.islandState[cell.islandId]
    let cost = isl.upgradeCost
    if (p.charId === 8) cost = Math.round(cost * 0.7)
    if (st.ownerId === p.id && st.level < 3 && p.cash >= cost) {
      upgrade(state, cell.islandId)
      return 'upgrade'
    }
  }

  endTurn(state)
  return 'end'
}
