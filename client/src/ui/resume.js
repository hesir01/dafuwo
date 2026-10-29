// 断线重连凭据：{ id: 旧 socketId, token: 座位私发凭证 }
// token 由服务端在 room:create / room:join 的 ack 里只发给本人，
// 绝不出现在 playerView 广播里——否则知道别人 socketId 就能顶掉他的座位。
const KEY = 'op_game_resume'
const LEGACY_KEY = 'op_game_old_id'

export function saveResume(id, token) {
  if (!id) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, token: token || null }))
    localStorage.removeItem(LEGACY_KEY)
  } catch (e) { /* 隐私模式下 localStorage 不可用，忽略 */ }
}

export function loadResume() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw)
      if (v && typeof v.id === 'string') return { id: v.id, token: v.token || null }
    }
  } catch (e) { /* 解析失败按无凭据处理 */ }
  // 兼容老版本只存 socketId 的情况：没有 token 会被服务端拒绝，玩家重新进房即可
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) return { id: legacy, token: null }
  } catch (e) { /* ignore */ }
  return null
}

export function clearResume() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(LEGACY_KEY)
  } catch (e) { /* ignore */ }
}
