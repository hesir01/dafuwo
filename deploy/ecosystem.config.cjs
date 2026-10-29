// PM2 进程配置（CommonJS，避免 package.json 的 type:module 影响 PM2 解析）
// 用法（在项目根目录执行）：pm2 start deploy/ecosystem.config.cjs
const path = require('node:path')

const root = path.resolve(__dirname, '..')

module.exports = {
  apps: [
    {
      name: 'op-monopoly',
      script: path.join(root, 'server/index.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // 与 .env 保持一致；这里再写一份是为了 PM2 重启时不会读到空值
        CLIENT_URL: 'http://localhost:5173'
      },
      // ⚠️ 部署前把上面的 CLIENT_URL 改成实际域名（https://你的域名），否则 Socket.IO 连不上
      error_file: path.join(root, 'logs/err.log'),
      out_file: path.join(root, 'logs/out.log')
    }
  ]
}
