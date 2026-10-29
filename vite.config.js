import { defineConfig } from 'vite'

// 前端根目录为 client/，现有 assets/ 作为静态资源目录（publicDir）
// 开发时把 /api 与 /socket.io 代理到后端，实现前后端同源、免 CORS
export default defineConfig({
  root: 'client',
  publicDir: '../assets',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true }
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  test: {
    environment: 'node'
  }
})
