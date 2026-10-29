# 部署说明（航海王大富翁）

## 〇、当前线上部署（2026-10-26 实际完成）

| 项 | 值 |
|---|---|
| 地址 | **http://43.128.149.78:8010** |
| 服务器 | 穹狼练习机（Ubuntu 24.04，Node 18，PM2 7） |
| 形态 | **Node 单端口直出**（Express 静态托管 dist + Socket.IO 同进程），无 Nginx |
| 进程 | PM2 `op-monopoly`，日志 `~/.pm2/logs/op-monopoly-*.log` |
| 目录 | `~/op-monopoly`（dist / server / shared / package.json / .env） |
| 环境变量 | `.env`：`PORT=8010`、`NODE_ENV=production`、`CLIENT_URL=http://43.128.149.78:8010` |
| 防火墙 | `sudo ufw allow 8010/tcp`（ufw 默认 DROP，不放行就是空响应） |

**更新部署**：本地 `npm run build:deploy` → `tar czf /tmp/op.tgz dist server shared package.json package-lock.json` → scp 到 `~/op-monopoly` 解压 → `pm2 restart op-monopoly`。

**已知限制**：练习服务器随时可能重置——重置后按上面两步（上传 + pm2 start）即可恢复；`pm2 save` 已做，机器不重置的话进程会自动拉起。

---

## 一、需要准备什么（通用流程，供正式部署参考）

| 类别 | 要求 | 说明 |
|---|---|---|
| 服务器 | Linux 云主机，**1 核 2G 即可**（4 人房内存占用极低） | 阿里云/腾讯云/轻量应用服务器均可 |
| 端口 | 对外放行 **80 / 443**；3000 只在机内监听 | 3000 不需要对外开放，由 Nginx 反代 |
| 域名 | 可选（无域名可用公网 IP + HTTP） | 国内云主机用域名走 80/443 **必须备案** |
| HTTPS | Let's Encrypt 免费证书（certbot） | 前端是 HTTPS 时 WebSocket 才能走 wss；不配也能跑 HTTP |
| 运行环境 | Node ≥ 20（项目在 22 上开发）、npm、Nginx、PM2 | `npm i -g pm2` |

> 前端 `io()` 是同源连接，**不需要改任何前端地址**；只要 Nginx 转发了 `/socket.io/` 就能连。

## 二、服务器上要放哪些文件

```
/opt/op-monopoly/
├─ server/          后端（只需这两个目录 + package.json）
├─ shared/          前后端共用的规则引擎（后端运行时依赖）
├─ package.json     装依赖用
├─ .env             生产环境变量（重点：CLIENT_URL）
└─ deploy/          Nginx / PM2 配置（可只留本地）
```

前端静态文件单独放：`/var/www/op-monopoly/` ← `dist/` 的内容。

## 三、步骤

```bash
# 1）本地：产出瘦身后的前端（377MB → ~54MB）
npm run build:deploy          # = vite build + python3 tools/trim_dist.py
scp -r dist/* user@server:/var/www/op-monopoly/

# 2）服务器：装依赖并以后端身份启动
ssh user@server
cd /opt/op-monopoly
npm i --omit=dev
cp .env.example .env && vi .env      # CLIENT_URL=https://你的域名（必改！）

# 3）PM2 守护后端
npm i -g pm2
pm2 start deploy/ecosystem.config.cjs   # 记得先把里面的 CLIENT_URL 改成域名
pm2 save && pm2 startup                 # 开机自启

# 4）Nginx
sudo cp deploy/nginx.conf /etc/nginx/conf.d/op-monopoly.conf
sudo vi /etc/nginx/conf.d/op-monopoly.conf   # 替换 your_domain_or_ip
sudo nginx -t && sudo systemctl reload nginx

# 5）证书（有域名时）
sudo certbot certonly --webroot -w /var/www/certbot -d 你的域名
```

## 四、验收清单

- [ ] `https://域名/api/health` 返回 `{"ok":true,...}`（Nginx 反代通）
- [ ] 打开首页无素材 404（浏览器 Network 面板）
- [ ] 大厅右上角连接徽标显示「已连接」（Socket.IO 通，不通先查 `CLIENT_URL`）
- [ ] 开两个浏览器/两台机器建房 → 加入 → 打完一局
- [ ] 关掉其中一个标签页，另一个不受影响，重开页面能回到原座位

## 五、已知限制

- 房间状态在**内存**：`pm2 restart` 或服务器重启会丢失进行中的对局（MVP 可接受，登录页可提示）。
- 每 30 秒无操作由服务器 AI 代打；断线即自动托管，重连交还控制权。
- 素材总量仍约 54MB，首次进页面加载较慢，后续走浏览器缓存。
