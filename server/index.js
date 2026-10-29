import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import dotenv from 'dotenv'

import { registerGameSocket } from './sockets/gameSocket.js'
import { sweepRooms } from './rooms.js'

dotenv.config()

const PORT = process.env.PORT || 3000
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

const app = express()
app.use(cors({ origin: CLIENT_URL }))
app.use(express.json())

// 健康检查 / hello
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'op-monopoly', time: Date.now() })
})

// 生产模式：Node 单端口直出前端（dist 由 npm run build:deploy 产出）
// 好处：不用 Nginx，静态页面与 Socket.IO 同源，无跨域问题
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')

// 当前线上构建号（dist/index.html 里的 assets/index-<hash>.js）。
// 客户端靠它判断自己拿到的是不是最新页面 —— 旧 index.html 被浏览器缓存时，
// 不同电脑会长时间跑不同版本，界面对不上，排查起来像「灵异事件」。
let buildCache = { mtime: 0, id: 'dev' }
function readBuildId () {
  try {
    const file = path.join(distDir, 'index.html')
    const st = fs.statSync(file)
    if (st.mtimeMs !== buildCache.mtime) {
      const html = fs.readFileSync(file, 'utf8')
      const m = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/)
      buildCache = { mtime: st.mtimeMs, id: m ? m[1] : String(Math.round(st.mtimeMs)) }
    }
    return buildCache.id
  } catch (e) {
    return 'dev'
  }
}

app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ build: readBuildId(), uptime: Math.round(process.uptime()) })
})

if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, {
    etag: true,
    setHeaders (res, filePath) {
      if (filePath.endsWith('index.html')) {
        // 入口页必须每次回源校验：否则会一直用缓存里的旧 bundle
        res.setHeader('Cache-Control', 'no-cache, must-revalidate')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // 带 hash 的产物可以强缓存一年
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    }
  }))
  // SPA 兜底：刷新非根路径不 404（排除 API 与 Socket.IO 自身路径）
  app.get(/^\/(?!api\/|socket\.io\/|assets\/|audio\/).*/, (req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate')
    res.sendFile(path.join(distDir, 'index.html'))
  })
  console.log(`[server] 生产静态托管：${distDir}（build=${readBuildId()}）`)
}

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: CLIENT_URL }
})

// 注册 socket 事件
registerGameSocket(io)

// 每 5 分钟巡检一次：销毁长期无在线真人的房间（默认闲置 30 分钟，OP_ROOM_IDLE_MS 可调）。
// 此前房间永不回收，内存只增不减——PRD §10 稳定性缺口。
setInterval(() => {
  const removed = sweepRooms()
  if (removed > 0) console.log(`[rooms] 已回收 ${removed} 个无人房间`)
}, 5 * 60 * 1000).unref()

server.listen(PORT, () => {
  console.log(`[server] 后端已启动：http://localhost:${PORT}`)
})
