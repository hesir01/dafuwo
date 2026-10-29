// 游戏 socket：房间管理 + 服务器权威对局
import {
  createRoom, joinRoom, leaveRoom, getRoomBySocket,
  playerView, startGame, reconnectRoom,
  assignRandomChars, restartRoom, clearSelectTimer
} from '../rooms.js'
import {
  roll, buy, declineBuy, buyHistory, declineHistory,
  endTurn, useSkill, useFruit, useHaki, upgrade, proposeTrade,
  confirmFruitTarget, cancelTarget, decisionReroll,
  decisionEventCancel, decisionTrade, decisionFlower, finalVoyage,
  getCurrentPlayer, maskedStateFor
} from '../../shared/engine.js'
import { aiStep } from '../../shared/aiPlayer.js'
import { CHARACTER_BY_ID } from '../../shared/gameData.js'

// 引擎里的 decision* 会读取 modal / pending* 等运行态；任何客户端都能在任意时刻发指令，
// 缺守卫时会抛 TypeError 直接压垮进程（实测可让全服房间丢失）。这里统一兜底。
function safeCall(fn) {
  try { return fn() } catch (e) {
    console.error('[action] 引擎异常', e && e.stack ? e.stack : e)
    return { error: '操作无效' }
  }
}

function broadcastRoom(io, room) {
  room.lastActiveAt = Date.now()
  room.players.forEach((p) => {
    io.to(p.socketId).emit('room:update', playerView(room, p.socketId))
  })
}

// 重连凭证只私发给本人（绝不出现在 playerView 广播里）
function selfToken(room, socketId) {
  const p = room.players.find((x) => x.socketId === socketId)
  return (p && p.resumeToken) || null
}

// 每个客户端只知道自己坐第几号位：按 socketId 单点下发座位号
function sendSeats(io, room) {
  room.players.forEach((p, i) => {
    if (p.isAI) return
    io.to(p.socketId).emit('game:seat', i)
  })
}

// 调度常量：AI 动作延迟 / 真人回合超时 / 交易应答超时 / 选角倒计时（PRD §8.4）
const AI_STEP_DELAY = 800
const TURN_TIMEOUT_MS = 30000
const TRADE_TIMEOUT_MS = 30000
const SELECT_TIMEOUT_MS = Number(process.env.OP_SELECT_TIMEOUT_MS) || 60000

// 选角倒计时：第一次有人选角（或房主尝试开局但有人未选）时启动；
// 超时由服务器给未选角座位随机分配剩余角色并广播——此前没有任何服务器侧
// 倒计时，一名玩家挂机就会让整个房间无限等待。测试可用 OP_SELECT_TIMEOUT_MS 缩短。
function armSelectTimer(io, room) {
  if (room.selectTimer || room.started) return
  room.selectDeadline = Date.now() + SELECT_TIMEOUT_MS
  room.selectTimer = setTimeout(() => {
    room.selectTimer = null
    room.selectDeadline = null
    if (!room || room.started) return
    const assigned = assignRandomChars(room)
    if (assigned.length) {
      console.log(`[select] 房间${room.code} 选角超时，自动分配：${assigned.join('、')}`)
    }
    broadcastRoom(io, room)
  }, SELECT_TIMEOUT_MS)
}

// 座位此刻是否真由 AI 掌控（主动托管 / 断线接管 / 空位填充都走 isAI）
function seatIsAI(room, id) {
  const s = room.players[id]
  return !!(s && s.isAI)
}

// 交易阶段（awaitTrade）的决策权属于「被交易方」modal.targetId，而不是当前行动玩家：
// 发起方才是 current player。历史上这里按 current player 调度 AI → AI 叫卖后 800ms
// 直接替人类被交易方接受，玩家「没点接受就买到/被卖掉」。所以交易必须单独判定。
function tradeDecider(room) {
  const st = room.state
  if (!st || st.phase !== 'awaitTrade' || !st.modal || st.modal.type !== 'trade') return null
  return st.modal.targetId
}

// 当前是否有「该由 AI 出手」的座位：返回座位号或 null
function aiDueSeat(room) {
  const st = room.state
  if (!st || st.gameOver || st.phase === 'ended') return null
  const decider = tradeDecider(room)
  if (decider != null) return seatIsAI(room, decider) ? decider : null
  const cp = getCurrentPlayer(st)
  return seatIsAI(room, cp.id) ? cp.id : null
}

export function broadcastState(io, room) {
  // 防御：对局未开始（state=null）或无玩家时不广播，避免 getCurrentPlayer(null) 崩溃
  if (!room || !room.started || !room.state || !room.state.players) return
  room.lastActiveAt = Date.now()
  room.players.forEach((p, i) => {
    // 对手手牌里的果实/霸气是私有信息（见闻色预览 modal 同理）：
    // 每个座位只收到自己的完整手牌，其余按 kind 脱敏（历史正文按 PRD 保持公开可交易）
    io.to(p.socketId).emit('game:state', maskedStateFor(room.state, i))
  })
  scheduleNext(io, room)
}

// 唯一调度入口：决定「下一步由谁行动、等多久、等不到怎么办」
// timing 仅供测试注入更短的等待（生产走默认值）
export function scheduleNext(io, room, timing = {}) {
  const aiDelay = timing.aiDelay ?? AI_STEP_DELAY
  const tradeWait = timing.tradeTimeout ?? TRADE_TIMEOUT_MS
  const turnWait = timing.turnTimeout ?? TURN_TIMEOUT_MS
  // 清掉上一个定时器
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null }
  const st = room.state
  if (!st || st.gameOver || st.phase === 'ended') return
  const canControl = (id) => seatIsAI(room, id)

  // ① 交易等待中：只有被交易方是 AI 才自动应答；人类必须自己点
  const decider = tradeDecider(room)
  if (decider != null && !canControl(decider)) {
    room.turnTimer = setTimeout(() => {
      if (!room.state || room.state.phase !== 'awaitTrade') return
      // 超时按「拒绝」处理（绝不默认成交），避免一局卡在等答复
      console.log(`[trade] 座位${decider} 超时未应答，自动拒绝`)
      decisionTrade(room.state, false, decider)
      broadcastState(io, room)
    }, tradeWait)
    return
  }

  const who = decider != null ? decider : getCurrentPlayer(st).id

  // ② AI 座位：延迟一拍再动（让客户端先播动画）
  if (canControl(who)) {
    if (room.aiPending) return
    room.aiPending = true
    setTimeout(() => {
      room.aiPending = false
      if (!room || !room.started || !room.state || room.state.gameOver) return
      // 期间状态可能已变（人类抢先应答 / 回合已推进）：只在仍需 AI 时出手
      if (aiDueSeat(room) == null) return
      aiStep(room.state, { canControl })
      broadcastState(io, room)
    }, aiDelay)
    return
  }

  // ③ 真人玩家 30 秒倒计时，超时自动 AI 代打
  const cpId = getCurrentPlayer(st).id
  room.turnTimer = setTimeout(() => {
    if (!room.started || !room.state || room.state.phase === 'ended') return
    const seat2 = room.players[cpId]
    if (seat2 && !seat2.isAI) {
      seat2.timeouts = (seat2.timeouts || 0) + 1
      // PRD §8.3：连续超时进入托管（连续 2 次即交 AI 代打本局）
      if (seat2.timeouts >= 2) {
        seat2.isAI = true
        console.log(`[timer] 玩家${cpId}连续超时，转托管`)
      }
    }
    console.log(`[timer] 玩家${cpId}超时，AI代打`)
    aiStep(room.state, { canControl })
    broadcastState(io, room)
  }, turnWait)
}

export function registerGameSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[socket] 连接: ${socket.id}`)

    // 客户端可能 emit 时只带数据不带回调：ack 归一化，避免服务器崩溃
    const safeAck = (ack) => (typeof ack === 'function' ? ack : () => {})

    // ack 归一化：客户端 BoardScene.act() 统一以 emit(event, extra, cb) 三参发送，
    // 而无载荷事件（game:roll 等）的处理器签名是 (ack)——{} 会被误当成 ack，
    // 客户端回调永远收不到 → 5 秒后误报「服务器无响应」。
    // 这里统一在监听层取「最后一个函数参数」作为 ack，第一个参数作为载荷。
    // ack / 载荷归一化（统一两参约定）：
    // 所有处理器签名一律为 (payload, ack)。包装层弹出 ack 后：
    //   - 有载荷 → handler(payload, ack)
    //   - 无载荷 → handler({}, ack)
    // 历史 bug 两种都踩过：按 handler.length 判定会被默认值参数骗（chat:send 的 length 为 0，
    // 载荷被当 ack 吞掉）；按 args.length 判定又会让 (ack) 风格处理器收到 {} 当 ack、
    // 真 ack 被丢弃（game:roll 等超时无响应）。统一签名后不再有任何歧义。
    const rawOn = socket.on.bind(socket)
    socket.on = (event, handler) => rawOn(event, (...args) => {
      const ack = typeof args[args.length - 1] === 'function' ? args.pop() : undefined
      handler(args[0] ?? {}, ack)
    })

    // 房间不再接受客户端自定义昵称：座位名由服务端按顺序生成（玩家1/2/…），
    // 选角后所有展示都改用角色名（见 playerView.charName 与 rooms.startGame）。
    socket.on('room:create', ({ maxPlayers } = {}, ack) => {
      const done = safeAck(ack)
      // 该连接若还挂在旧房间，createRoom 会先将其清出（防房号串台），旧房间其他人需要收到更新
      const evicted = []
      const room = createRoom(socket, null, maxPlayers, evicted)
      evicted.forEach((old) => broadcastRoom(io, old))
      socket.join(room.code)
      done({ ok: true, room: playerView(room, socket.id), socketId: socket.id, resumeToken: selfToken(room, socket.id) })
    })

    socket.on('room:join', ({ code } = {}, ack) => {
      const done = safeAck(ack)
      const r = joinRoom(code, socket, null)
      if (r.error) return done({ ok: false, error: r.error })
      // 加入时若被清出其它房间，旧房间其他人需要收到更新（防房号串台）
      ;(r.roomsChanged || []).forEach((old) => broadcastRoom(io, old))
      socket.join(r.room.code)
      broadcastRoom(io, r.room)
      done({ ok: true, room: playerView(r.room, socket.id), socketId: socket.id, resumeToken: selfToken(r.room, socket.id) })
    })

    // 断线重连：需要「旧 socketId + 该座位私发的 resumeToken」两件套
    socket.on('room:reconnect', ({ oldSocketId, resumeToken } = {}, ack) => {
      const done = safeAck(ack)
      const room = reconnectRoom(oldSocketId, socket, resumeToken)
      if (!room) return done({ ok: false, error: '重连失败，请重新进房' })
      // 已结束的对局：拒绝重连，避免客户端被拉进死局棋盘
      if (room.state && room.state.phase === 'ended') {
        return done({ ok: false, error: '该房间对局已结束' })
      }
      sendSeats(io, room)
      // 对局尚未开始：只回房间视图，绝不能 broadcastState（state 为 null 会崩）
      if (!room.started) {
        broadcastRoom(io, room)
        return done({ ok: true, room: playerView(room, socket.id), state: null, resumeToken: selfToken(room, socket.id) })
      }
      broadcastState(io, room)
      // 重连回包同样按座位脱敏，与广播口径一致
      const seatIdx = room.players.findIndex((x) => x.socketId === socket.id)
      done({ ok: true, room: playerView(room, socket.id), state: maskedStateFor(room.state, seatIdx), resumeToken: selfToken(room, socket.id) })
    })

    // ---------- 聊天与快捷互动 ----------
    // 频控：同一连接 700ms 一条；文本上限 60 字；只转发到同房间
    const EMOJIS = ['⚓', '💰', '🏴', '😂', '😱', '👏']
    const PHRASES = ['快点吧', '好牌！', '这岛我要了', '联手吗？', '抱歉～', '打得不错']

    socket.on('chat:send', ({ kind, value } = {}, ack) => {
      const done = safeAck(ack)
      try {
        const room = getRoomBySocket(socket.id)
        if (!room) return done({ ok: false, error: '不在房间' })
        const now = Date.now()
        if (socket.__lastChat && now - socket.__lastChat < 700) {
          return done({ ok: false, error: '发送太快了' })
        }
        let payload
        if (kind === 'emoji' && EMOJIS.includes(value)) {
          payload = { kind: 'emoji', value }
        } else if (kind === 'phrase' && PHRASES.includes(value)) {
          payload = { kind: 'phrase', value }
        } else if (kind === 'text' && typeof value === 'string' && value.trim()) {
          const text = value.trim().slice(0, 60)
          payload = { kind: 'text', value: text }
        } else {
          return done({ ok: false, error: '不支持的消息' })
        }
        socket.__lastChat = now
        const seat = room.players.find((p) => p.socketId === socket.id)
        const seatIdx = room.players.findIndex((p) => p.socketId === socket.id)
        const msg = {
          ...payload,
          from: seatIdx,
          // 聊天气泡/聊天窗显示角色名，选角前回落座位号（不再有自定义昵称）
          name: (seat && seat.charId && CHARACTER_BY_ID[seat.charId]?.name) || (seat && seat.name) || '玩家',
          ts: now
        }
        io.to(room.code).emit('chat:message', msg)
        done({ ok: true })
      } catch (e) {
        console.error('[chat:send] ERROR', e && e.stack ? e.stack : e)
        done({ ok: false, error: '服务器错误' })
      }
    })

    socket.on('player:selectChar', ({ charId }, ack) => {
      const done = safeAck(ack)
      const room = getRoomBySocket(socket.id)
      if (!room || room.started) return done({ ok: false, error: '房间不存在或已开始' })
      const p = room.players.find((x) => x.socketId === socket.id)
      const taken = room.players.some((x) => x.charId === charId && x.socketId !== socket.id)
      if (taken) return done({ ok: false, error: '这个角色已被选' })
      p.charId = charId
      p.ready = true
      // 第一名玩家开始选角 = 选角阶段开始：随之启动 60 秒服务器倒计时（PRD §8.4）
      armSelectTimer(io, room)
      broadcastRoom(io, room)
      done({ ok: true })
    })

    // 主动拉取当前房间视图（换场景后本地没有 roomData 时用，如「再来一局」跳选角）。
    // 副作用：进选角界面即启动选角倒计时（PRD §8.4），不能等「有人选角」才计时。
    socket.on('room:view', (_p, ack) => {
      const done = safeAck(ack)
      const room = getRoomBySocket(socket.id)
      if (!room) return done({ ok: false, error: '不在房间' })
      if (!room.started) armSelectTimer(io, room)
      done({ ok: true, room: playerView(room, socket.id) })
    })

    socket.on('game:start', (_p, ack) => {
      const done = safeAck(ack)
      const room = getRoomBySocket(socket.id)
      if (!room) return done({ ok: false, error: '不在房间' })
      if (room.hostId !== socket.id) return done({ ok: false, error: '只有房主能开始' })
      // PRD §8.4：对局已开始时不可再次触发（否则房主可随时清空整局）
      if (room.started) return done({ ok: false, error: '对局已经开始' })
      const humans = room.players.filter((p) => !p.isAI && !p.disconnected)
      if (humans.length < 2) return done({ ok: false, error: '至少需要 2 名玩家才能开局' })
      const missing = room.players.find((p) => !p.isAI && !p.charId)
      if (missing) {
        // 有人没选角：不再无限等待——启动选角倒计时（已在计时则不重置），超时自动分配
        armSelectTimer(io, room)
        broadcastRoom(io, room)
        return done({ ok: false, error: `${missing.name}还没选角色，倒计时结束将自动分配` })
      }
      const r = startGame(room)
      if (r.error) return done({ ok: false, error: r.error })
      clearSelectTimer(room)
      sendSeats(io, room)
      broadcastState(io, room)
      done({ ok: true })
    })

    // 再来一局（PRD §7 / §9）：对局结束后保留真人座位、清空状态、全员重进选角。
    // 房内任何真人都能发起——对局已结束，不存在破坏对局的问题。
    socket.on('game:restart', (_p, ack) => {
      const done = safeAck(ack)
      const room = getRoomBySocket(socket.id)
      if (!room) return done({ ok: false, error: '不在房间' })
      if (!room.players.some((x) => x.socketId === socket.id)) return done({ ok: false, error: '不在对局' })
      if (!room.started || !room.state || room.state.phase !== 'ended') {
        return done({ ok: false, error: '对局尚未结束' })
      }
      const r = restartRoom(room)
      if (!r) return done({ ok: false, error: '房间已无人，无法再来一局' })
      sendSeats(io, room)
      broadcastRoom(io, room)
      done({ ok: true })
    })

    function doAction(fn, ack) {
      const done = safeAck(ack)
      const room = getRoomBySocket(socket.id)
      if (!room || !room.started) return done({ ok: false, error: '游戏未开始' })
      const seatIdx = room.players.findIndex((x) => x.socketId === socket.id)
      if (seatIdx < 0) return done({ ok: false, error: '不在对局' })
      const cp = getCurrentPlayer(room.state)
      if (cp.id !== seatIdx) return done({ ok: false, error: '还没轮到你' })
      const r = safeCall(() => fn(room.state))
      // 玩家有操作即清空连续超时计数
      if (room.players[seatIdx]) room.players[seatIdx].timeouts = 0
      broadcastState(io, room)
      // result 透传引擎返回值：见闻色预览等操作需要拿到具体结果（如下一格位置）
      done({ ok: !r.error, error: r.error, result: !r.error ? r : undefined })
    }

    socket.on('game:roll', (_p, ack) => doAction(roll, ack))
    socket.on('game:buy', (_p, ack) => doAction(buy, ack))
    socket.on('game:decline', (_p, ack) => doAction(declineBuy, ack))
    socket.on('game:buyHistory', (_p, ack) => doAction(buyHistory, ack))
    socket.on('game:declineHistory', (_p, ack) => doAction(declineHistory, ack))
    socket.on('game:endTurn', (_p, ack) => doAction(endTurn, ack))
    socket.on('game:useSkill', (_p, ack) => doAction(useSkill, ack))
    socket.on('game:upgrade', ({ islandId }, ack) => doAction((s) => upgrade(s, islandId), ack))
    socket.on('game:tradePropose', ({ targetId, historyId, price, direction = 'buy' }, ack) =>
      doAction((s) => proposeTrade(s, targetId, historyId, price, direction === 'sell' ? 'sell' : 'buy'), ack))
    socket.on('game:voyage', (_p, ack) => doAction(finalVoyage, ack))
    socket.on('game:useFruit', ({ uid }, ack) => doAction((s) => useFruit(s, uid), ack))
    // 见闻色双用途（PRD §4.2）：默认在负面事件时询问取消；action='preview' = 主动预览下一格
    socket.on('game:useHaki', ({ uid, action } = {}, ack) =>
      doAction((s) => useHaki(s, uid, action === 'preview' ? 'preview' : 'cancel'), ack))
    socket.on('game:confirmTarget', ({ targetId }, ack) => doAction((s) => confirmFruitTarget(s, targetId), ack))
    socket.on('game:cancelTarget', (_p, ack) => doAction(cancelTarget, ack))
    socket.on('game:reroll', ({ reroll }, ack) => doAction((s) => decisionReroll(s, reroll), ack))
    socket.on('game:eventCancel', ({ cancel }, ack) => doAction((s) => decisionEventCancel(s, cancel), ack))
    // 花花果实：确认事件是否生效（PRD §4.1）
    socket.on('game:flowerEvent', ({ accept } = {}, ack) => doAction((s) => decisionFlower(s, !!accept), ack))
    // 交易应答：必须允许「被交易方」操作（此时当前行动玩家是发起方）。
    // 引擎用 byId 校验只有 targetId 能决定，防止发起方自买自卖。
    socket.on('game:trade', ({ accept } = {}, ack) => {
      const done = safeAck(ack)
      const room = getRoomBySocket(socket.id)
      if (!room || !room.started) return done({ ok: false, error: '游戏未开始' })
      const seatIdx = room.players.findIndex((x) => x.socketId === socket.id)
      if (seatIdx < 0) return done({ ok: false, error: '不在对局' })
      const r = safeCall(() => decisionTrade(room.state, !!accept, seatIdx))
      // 非决策者乱点不应刷新被交易方的应答倒计时，只在状态真变化时广播
      if (!r.error || r.error !== '只能由被交易方决定是否成交') broadcastState(io, room)
      done({ ok: !r.error, error: r.error })
    })

    // 主动离船：对局中退出 = 放弃本局（座位交 AI），房间中退出 = 直接移除
    socket.on('room:leave', (_p, ack) => {
      const done = safeAck(ack)
      const room = leaveRoom(socket.id, { graceful: true })
      if (room) {
        socket.leave(room.code)
        if (!room.started) broadcastRoom(io, room)
        else broadcastState(io, room)
      }
      done({ ok: true })
    })

    // 主动托管 / 取消托管：服务器标记该座位由 AI 代打（与断线接管同一套机制）
    socket.on('game:autoplay', ({ on }, ack) => {
      const done = safeAck(ack)
      const room = getRoomBySocket(socket.id)
      if (!room || !room.started) return done({ ok: false, error: '游戏未开始' })
      const idx = room.players.findIndex((x) => x.socketId === socket.id)
      if (idx < 0) return done({ ok: false, error: '不在对局' })
      const p = room.players[idx]
      p.isAI = !!on
      p.disconnected = false
      broadcastRoom(io, room)
      // 交给统一调度：轮到自己是 AI、或正被交易询问时都会自动接手；
      // 取消托管时同理不会再排 AI 步骤（调度前会重新判定座位归属）。
      broadcastState(io, room)
      done({ ok: true })
    })

    socket.on('disconnect', () => {
      console.log(`[socket] 断开: ${socket.id}`)
      const room = leaveRoom(socket.id)
      if (room) {
        if (!room.started) broadcastRoom(io, room)
        else broadcastState(io, room) // 游戏中：广播新状态（断线玩家变AI）
      }
    })

    // disconnect 是 Phaser/socket.io 原生事件，不经包装层，无需改动；
    // 至此所有自定义处理器统一为 (payload, ack) 签名。
  })
}
