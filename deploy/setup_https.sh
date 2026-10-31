#!/usr/bin/env bash
# 一键启用 HTTPS + Nginx 反代 + 多来源 CORS
# 用法（在服务器上，项目位于 ~/op-monopoly）：
#   bash setup_https.sh <域名> <邮箱> [服务器IP] [后端端口]
# 例：
#   bash setup_https.sh boluodafuwo.duckdns.org you@example.com 43.128.149.78 8010
set -euo pipefail

DOMAIN="${1:-boluodafuwo.duckdns.org}"
EMAIL="${2:-you@example.com}"
SERVER_IP="${3:-43.128.149.78}"
PORT="${4:-8010}"

echo "==> 目标：域名=$DOMAIN 邮箱=$EMAIL 后端=127.0.0.1:$PORT"

echo "==> 安装 Nginx + certbot"
sudo apt-get update -y
sudo apt-get install -y nginx certbot python3-certbot-nginx

# 清掉默认站点，避免 80 端口冲突
sudo rm -f /etc/nginx/sites-enabled/default

echo "==> 写 Nginx 配置（全反代到 127.0.0.1:$PORT）"
sudo tee /etc/nginx/conf.d/op-monopoly.conf >/dev/null <<'EOF'
server {
    listen 80;
    server_name __DOMAIN__;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name __DOMAIN__;
    ssl_certificate     /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    location / {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF
sudo sed -i "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" /etc/nginx/conf.d/op-monopoly.conf

sudo mkdir -p /var/www/certbot
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo nginx -t
sudo systemctl enable --now nginx

echo "==> 申请 Let's Encrypt 证书（如已存在则跳过）"
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL"
else
  echo "证书已存在，跳过申请"
fi
sudo systemctl reload nginx

echo "==> 修改 CLIENT_URL 为多来源（IP + 域名）"
cd ~/op-monopoly
sed -i "s|^CLIENT_URL=.*|CLIENT_URL=http://$SERVER_IP:$PORT,https://$DOMAIN|" .env
grep '^CLIENT_URL' .env

echo "==> 重启 PM2"
pm2 restart op-monopoly

echo "==> 验证（等待 2s）"
sleep 2
curl -s -o /dev/null -w "https://$DOMAIN/api/health -> %{http_code}\n" "https://$DOMAIN/api/health"
curl -s "https://$DOMAIN/api/health"; echo
echo "==> 完成。浏览器打开 https://$DOMAIN 测试联机"
