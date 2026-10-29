// 房间管理：内存 Map，6位数字房号（纯数字，不含字母，方便口述与输入）
import { createGame } from '../shared/engine.js'
import { CHARACTER_BY_ID } from '../shared/gameData.js'
import { randomBytes } from 'node:crypto'

const rooms = new Map() // code -> room
const CHARS_USED = '0123456789'

// 无人房间回收阈值：没有任何在线真人且闲置超过该时长的房间将被销毁（定时巡检见 index.js）
const DEFAULT_ROOM_IDLE_MS = Number(process.env.OP_ROOM_IDLE_MS) || 30 * 60 * 1000

// 重连凭证：座位私发、只有本人拿得到。
// 为什么需要：socketId 曾是「重连的唯一凭据」，而 playerView 又把每个座位的
// socketId 广播给所有人 → 知道对方 socketId 就能 room:reconnect 顶掉他的座位。
// 现在 socketId 不再下发，重连还必须出示只有本人持有的 resumeToken。
function makeResumeToken() {
  return randomBytes(16).toString('hex')
}

function generateCode() {
  let code = ''
  for (let i = 0; i < 6; i++) code += CHARS_USED[Math.floor(Math.random() * CHARS_USED.length)]
  return rooms.has(code) ? generateCode() : code
}

// 座位占位名：选角前用座位号（房间列表里能分清谁是谁），选角后一律改用角色名。
// 不再接受客户端自定义昵称——角色名是唯一显示名。
function seatLabel(index) {
  return `玩家${index + 1}`
}

export function createRoom(hostSocket, name, maxPlayers = 4, evicted = []) {
  // 先从旧房间优雅退出：一个连接同时挂在多个房间会导致 room:update 串台、房号来回跳。
  // 循环上限兜底：leaveRoom 对「已开局的座位」保留 players 记录，若其实现再次退化为
  // 幂等地返回同一房间，这里也只会退出有限次，不会把 evicted 撑爆。
  let left
  let guard = 0
  while (guard++ < 8 && (left = leaveRoom(hostSocket.id, { graceful: true }))) {
    if (left.players.length > 0) evicted.push(left)
  }
  const code = generateCode()
  const room = {
    code,
    hostId: hostSocket.id,
    players: [{ socketId: hostSocket.id, name: seatLabel(0), charId: null, ready: false, isAI: false, resumeToken: makeResumeToken() }],
    maxPlayers: Math.min(4, Math.max(2, Number(maxPlayers) || 4)),
    started: false,
    state: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(), // 无人回收的闲置计时基准：任何房间活动都会刷新（见 gameSocket 的广播函数）
    selectDeadline: null,     // 选角倒计时截止（PRD §8.4），由 gameSocket 起停
    selectTimer: null
  }
  rooms.set(code, room)
  console.log(`[rooms] 创建房间 ${code}（当前共 ${rooms.size} 间）`)
  return room
}

export function joinRoom(code, socket, name) {
  code = (code || '').toUpperCase().trim()
  const room = rooms.get(code)
  if (!room) return { error: '房间不存在' }
  if (room.started) return { error: '游戏已开始' }
  if (room.players.length >= room.maxPlayers) return { error: '房间已满' }
  const existing = room.players.find((p) => p.socketId === socket.id)
  if (existing) return { room, reconnected: true, roomsChanged: [] }
  // 防串台：加入前先退出其它房间，保证一个连接只在一个房间（同样加循环上限兜底）
  const roomsChanged = []
  let left
  let guard = 0
  while (guard++ < 8 && (left = leaveRoom(socket.id, { graceful: true }))) {
    if (left.players.length > 0) roomsChanged.push(left)
  }
  room.players.push({ socketId: socket.id, name: seatLabel(room.players.length), charId: null, ready: false, isAI: false, resumeToken: makeResumeToken() })
  room.lastActiveAt = Date.now()
  return { room, roomsChanged }
}

export function leaveRoom(socketId, opts = {}) {
  const { graceful = false } = opts
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex((p) => p.socketId === socketId)
    if (idx >= 0) {
      const p = room.players[idx]
      // 游戏中断线：标记离线，托管AI，5分钟后真的离开
      if (room.started && !graceful) {
        p.disconnected = true
        p.disconnectedAt = Date.now()
        p.isAI = true // 断线自动托管AI
        // 房主转移给下一个在线玩家
        if (room.hostId === socketId) {
          const next = room.players.find((x) => !x.disconnected)
          if (next) room.hostId = next.socketId
        }
        return room
      }
      // 房间未开始：保留座位等他回来（重连可恢复），只标记离线；
      // 空房（最后一人）仍销毁。主动离开（graceful）才移除。
      if (!room.started) {
        if (graceful) {
          room.players.splice(idx, 1)
          if (room.players.length > 0) room.hostId = room.players[0].socketId
          else { rooms.delete(code); return room }
        } else {
          p.disconnected = true
          p.disconnectedAt = Date.now()
        }
        return room
      }
      // 对局中主动离开：座位转 AI 继续打（不影响其他人）。
      // 关键：必须把座位与 socket 解绑（换成一个 AI 占位 id），否则
      //   ① 该 socket 仍被 getRoomBySocket 认作「在这个旧房间里」→ 新房开局被判「只有房主能开始」；
      //   ② createRoom/joinRoom 的离房循环会反复命中同一房间（曾把数组撑爆直接崩进程）。
      if (graceful) {
        if (p.disconnected) return null
        p.disconnected = true
        p.disconnectedAt = Date.now()
        p.isAI = true
        p.socketId = `ai_left_${Date.now()}_${idx}`
        if (room.hostId === socketId) {
          const next = room.players.find((x) => !x.disconnected)
          if (next) room.hostId = next.socketId
        }
        return room
      }
      room.players.splice(idx, 1)
      if (room.players.length > 0) room.hostId = room.players[0].socketId
      else rooms.delete(code)
      return room
    }
  }
  return null
}

// 重连：玩家断线后用新socketId恢复。必须同时出示该座位的 resumeToken（本人私发）。
export function reconnectRoom(oldSocketId, newSocket, resumeToken) {
  for (const room of rooms.values()) {
    const p = room.players.find((x) => x.socketId === oldSocketId)
    if (p) {
      if (p.isAI && !p.resumeToken) return null // 补位 AI 没有凭证，不可被接管
      if (!resumeToken || resumeToken !== p.resumeToken) return null
      p.socketId = newSocket.id
      p.disconnected = false
      p.disconnectedAt = null
      p.isAI = false
      // 房主身份跟着座位走：hostId 存的是 socketId，换 id 后必须同步，
      // 否则房主一刷新就「变成没人能开局」（playerView.isHost 靠 socketId 比对）。
      if (room.hostId === oldSocketId || !room.players.some((x) => x.socketId === room.hostId)) {
        room.hostId = newSocket.id
      }
      newSocket.join(room.code)
      return room
    }
  }
  return null
}

export function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) return room
  }
  return null
}

export function playerView(room, forSocketId) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    maxPlayers: room.maxPlayers,
    // 选角倒计时（服务器权威）：客户端只负责按它显示，超时分配一律由服务器执行
    selectDeadline: room.selectDeadline || null,
    players: room.players.map((p) => ({
      name: p.name,
      // 大厅/选角界面显示用：选角后等于角色名，未选角为 null（客户端回落座位号）
      charName: p.charId ? (CHARACTER_BY_ID[p.charId]?.name || null) : null,
      charId: p.charId,
      ready: p.ready,
      isAI: p.isAI,
      disconnected: !!p.disconnected,
      // 不再下发 socketId（那是重连凭据，泄露=可抢座）。
      // 客户端判断房主用 isHost，判断自己用 isYou。
      isHost: p.socketId === room.hostId,
      isYou: p.socketId === forSocketId
    }))
  }
}

export function startGame(room) {
  const humans = room.players.filter((p) => !p.isAI && !p.disconnected)
  if (humans.length < 1) return { error: '至少需要1名玩家' }
  // 已选的角色
  const usedChars = new Set(room.players.map((p) => p.charId).filter(Boolean))
  const allChars = [1,2,3,4,5,6,7,8,9,10]
  const aiChars = allChars.filter((c) => !usedChars.has(c))
  // 空位按房主设置补 AI（2-4 人均可开局），角色名用实际分到的角色
  const aiNames = ['巴基', '克洛', '阿龙', '克洛克达尔']
  let aiIdx = 0
  while (room.players.length < room.maxPlayers) {
    room.players.push({
      socketId: `ai_${Date.now()}_${aiIdx}`,
      name: aiNames[aiIdx % aiNames.length],
      charId: aiChars[aiIdx % aiChars.length],
      ready: true,
      isAI: true
    })
    aiIdx++
  }
  const charName = (id) => (CHARACTER_BY_ID[id] || {}).name || '船员'
  const gamePlayers = room.players.map((p, i) => ({
    id: i,
    // 对局内玩家名一律取角色名（引擎也会按 charId 再兜一次），不存在第二套昵称
    name: charName(p.charId),
    charId: p.charId,
    tokenIndex: p.charId ? p.charId - 1 : i // tokenIndex 跟随角色，保证旧逻辑兼容
  }))
  room.state = createGame(gamePlayers)
  room.started = true
  return { state: room.state }
}

// ---------- 选角超时分配（PRD §8.4：超时由服务器随机分配剩余角色） ----------
// 给所有还没选角的真人座位（含离线挂着的）随机分配未被选走的角色。
// 返回 [座位名→角色名] 列表供日志/测试断言。
export function assignRandomChars(room) {
  const used = new Set(room.players.map((p) => p.charId).filter(Boolean))
  const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((c) => !used.has(c))
  const assigned = []
  room.players.forEach((p) => {
    if (p.charId || p.isAI) return
    if (pool.length === 0) return
    const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    p.charId = pick
    p.ready = true
    assigned.push(`${p.name}→${(CHARACTER_BY_ID[pick] || {}).name || pick}`)
  })
  return assigned
}

export function clearSelectTimer(room) {
  if (room.selectTimer) { clearTimeout(room.selectTimer); room.selectTimer = null }
  room.selectDeadline = null
}

// ---------- 再来一局（PRD §7 / §9：保留座位、清空状态、重进角色选择） ----------
// 真人座位（持有 resumeToken）一律保留：在线的解除托管；离线的继续由 AI 代打，
// 凭证不动、可随时重连接管。开局时补位的纯 AI 座位（无凭证）不带入下一局。
// 房间已无人时销毁房间并返回 null。
export function restartRoom(room) {
  clearRoomTimers(room)
  room.players = room.players.filter((p) => !p.isAI || p.resumeToken)
  if (room.players.length === 0) {
    rooms.delete(room.code)
    return null
  }
  room.players.forEach((p) => {
    p.charId = null
    p.ready = false
    p.timeouts = 0
    if (p.resumeToken) {
      if (p.disconnected) {
        p.isAI = true // 不在线：继续托管，重连后由 reconnectRoom 置回 isAI=false
      } else {
        p.isAI = false
        p.disconnected = false
        p.disconnectedAt = null
      }
    } else {
      p.isAI = true
    }
  })
  // 房主座位若被清掉，移交给第一位留下的玩家
  if (!room.players.some((p) => p.socketId === room.hostId)) {
    room.hostId = room.players[0].socketId
  }
  room.state = null
  room.started = false
  room.lastActiveAt = Date.now()
  return room
}

// ---------- 无人房间回收 ----------
// 长期没有任何在线真人（全员离线 / 只剩 AI）且闲置超过阈值的房间直接销毁，
// 防止内存只增不减。清掉挂着的定时器，避免回收后仍触发广播。
export function sweepRooms(maxIdleMs = DEFAULT_ROOM_IDLE_MS) {
  const now = Date.now()
  let removed = 0
  for (const [code, room] of rooms) {
    const hasOnlineHuman = room.players.some((p) => !p.isAI && !p.disconnected)
    if (!hasOnlineHuman && now - (room.lastActiveAt || room.createdAt) > maxIdleMs) {
      clearRoomTimers(room)
      rooms.delete(code)
      removed++
    }
  }
  return removed
}

export function clearRoomTimers(room) {
  clearSelectTimer(room)
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null }
  room.aiPending = false
}

// ---------- 可观测性 ----------
// 供 /api/stats：房间/对局/在线概况，运维不用 SSH 也能看服务器状态
export function roomsStats() {
  let activeGames = 0, humansOnline = 0, humansOffline = 0, aiSeats = 0
  for (const room of rooms.values()) {
    if (room.started && room.state && room.state.phase !== 'ended') activeGames++
    for (const p of room.players) {
      if (p.isAI) aiSeats++
      else if (p.disconnected) humansOffline++
      else humansOnline++
    }
  }
  return { rooms: rooms.size, activeGames, humansOnline, humansOffline, aiSeats }
}
