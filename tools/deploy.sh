#!/usr/bin/env bash
# ============================================================
# 航海王大富翁 一键部署 / 回滚
# 用法：
#   tools/deploy.sh              # 构建 + 推送 + 重启 + 线上验收
#   tools/deploy.sh --no-verify  # 跳过线上验收（只做部署）
#   tools/deploy.sh rollback     # 回滚到上一版（服务器上的 ~/op-monopoly.bak）
# 前置：本机公钥已装到服务器（ssh -p $PORT $USER@$HOST 免密）
# ============================================================
set -euo pipefail

HOST=43.128.149.78
PORT=49822
USER_AT=boluo0172
APP_DIR='~/op-monopoly'
BASE_URL="http://$HOST:8010"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"

ssh_exec() { ssh -p "$PORT" "$USER_AT@$HOST" "$@"; }

build_local() {
  echo "==> [1/5] 本地构建（vite build + 素材瘦身）"
  cd "$PROJ"
  npm run build:deploy >/dev/null
  echo "==> [2/5] 打包"
  tar czf /tmp/op.tgz dist server shared package.json package-lock.json
  ls -lh /tmp/op.tgz
}

deploy() {
  build_local
  echo "==> [3/5] 上传并在服务器上备份旧版、解压新版"
  scp -P "$PORT" -q /tmp/op.tgz "$USER_AT@$HOST:~/op.tgz"
  # 备份旧版 → 解压新版 → 装依赖（package.json 有变化时生效）→ 重启
  ssh_exec "cd $APP_DIR && \
    rm -rf ~/op-monopoly.bak && cp -a . ~/op-monopoly.bak && \
    tar xzf ~/op.tgz && rm ~/op.tgz && \
    npm i --omit=dev --silent >/dev/null 2>&1 || true && \
    pm2 restart op-monopoly >/dev/null && sleep 2 && pm2 ls | grep -i monopoly"
  echo "==> [4/5] 健康检查"
  local n=0
  until curl -sf -m 5 "$BASE_URL/api/health" >/dev/null; do
    n=$((n+1)); [ "$n" -ge 6 ] && { echo "健康检查失败！回滚：tools/deploy.sh rollback"; exit 1; }
    sleep 2
  done
  echo "    新版 build: $(curl -s -m 5 "$BASE_URL/api/version")"
  [ "${1:-}" = "--no-verify" ] && { echo "==> 完成（跳过验收）"; return 0; }
  echo "==> [5/5] 线上验收（acceptance_online）"
  OP_URL="$BASE_URL" node "$PROJ/tools/acceptance_online.cjs" | tail -3
}

rollback() {
  echo "==> 回滚到 ~/op-monopoly.bak 并重启"
  ssh_exec "test -d ~/op-monopoly.bak || { echo '没有备份可回滚'; exit 1; }; \
    cd $APP_DIR && rm -rf ./* && cp -a ~/op-monopoly.bak/. . && pm2 restart op-monopoly >/dev/null && sleep 2"
  echo "    当前 build: $(curl -s -m 5 "$BASE_URL/api/version")"
}

case "${1:-deploy}" in
  deploy)   deploy "${2:-}" ;;
  rollback) rollback ;;
  *) echo "用法: tools/deploy.sh [--no-verify] | tools/deploy.sh rollback"; exit 1 ;;
esac
