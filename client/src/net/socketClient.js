import { io } from 'socket.io-client'

// 开发时经 Vite 代理做同源连接；生产由 Nginx 转发 WebSocket。
export function createSocket() {
  return io({
    autoConnect: true,
    reconnection: true
  })
}
