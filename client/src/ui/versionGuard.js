// ============================================================
// 版本守卫
// 场景：多人联机时，不同电脑可能一边开着「几天前加载的页面」，
// 另一边刷新过，于是同一局里界面不一样（旧版的排版 bug、旧版的字段），
// 彼此看到的东西对不上，还以为是「对面电脑有问题」。
// 做法：
//   1) 从自己的 <script src="assets/index-<hash>.js"> 里读出当前构建号；
//   2) 每分钟（以及切回标签页时）问一次服务器 /api/version；
//   3) 构建号不一致 → 顶部挂一条「有新版本，点击刷新」的提示，不打断对局。
// 开发模式（vite 直连 /src/main.js）读不到 hash，自动跳过。
// ============================================================

const POLL_MS = 60 * 1000

let build = ''
let banner = null
let timer = null
let polling = false

// 当前页面跑的是哪一版（构建号；读不到返回空串）
export function currentBuild () {
  return build
}

// 当前渲染倍率（1 或 2），给设置面板做「同屏观感」对照用
export function renderScale () {
  return window.__renderScale || 1
}

function readLocalBuild () {
  const s = document.querySelector('script[src*="/assets/index-"]')
  if (!s) return ''
  const m = String(s.src).match(/index-([A-Za-z0-9_-]+)\.js/)
  return m ? m[1] : ''
}

function showBanner (serverBuild) {
  if (banner) return
  banner = document.createElement('button')
  banner.type = 'button'
  banner.title = `当前 ${build} → 服务器 ${serverBuild}`
  banner.textContent = '🔄 游戏已更新，点击刷新'
  Object.assign(banner.style, {
    position: 'fixed',
    top: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '99999',
    padding: '7px 16px',
    font: '13px/1.4 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    color: '#ffe9a8',
    background: 'rgba(28, 18, 6, 0.94)',
    border: '1px solid #c9a86a',
    borderRadius: '999px',
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
    cursor: 'pointer'
  })
  banner.addEventListener('click', () => window.location.reload())
  document.body.appendChild(banner)
}

async function check () {
  if (polling) return
  polling = true
  try {
    const res = await fetch('/api/version', { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    if (data && data.build && data.build !== build) showBanner(data.build)
  } catch (e) {
    /* 离线/服务器重启中：下一轮再试 */
  } finally {
    polling = false
  }
}

export function installVersionGuard () {
  build = readLocalBuild()
  if (!build) return
  window.__build = build
  // 首次加载也查一次：浏览器缓存了旧 index.html 时，一进来就能发现
  check()
  if (timer) clearInterval(timer)
  timer = setInterval(check, POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check()
  })
}
