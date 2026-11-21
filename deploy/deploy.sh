#!/usr/bin/env bash
# =====================================================================
# 生产运维管理系统 — 一键部署脚本（Linux + systemd + Nginx）
#
# 用法：
#   1. 把整个项目目录上传到服务器（git clone 或 scp -r）
#   2. 前端产物二选一：
#      a) 推荐：本地执行 `cd frontend && npm run build`，把 frontend/dist 一并上传
#      b) 或服务器已装 Node.js，本脚本会自动 npm ci && npm run build
#   3. sudo bash deploy/deploy.sh
#
# 幂等可重入：代码更新后重新上传再跑一遍本脚本即可；
# .env、SQLite 数据库、uploads、.venv 均会被保留，不会被覆盖。
# =====================================================================
set -euo pipefail

DEPLOY_ROOT=/opt/water-ops
APP_USER=waterops
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo -e "\033[1;32m==>\033[0m $*"; }
err() { echo -e "\033[1;31m错误:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || err "请用 root 或 sudo 执行"

# ---- 1. 系统依赖 ----
log "安装系统依赖（nginx / python3 / rsync）"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq nginx python3 python3-venv python3-pip rsync openssl
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx python3 python3-pip rsync openssl
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx python3 python3-pip rsync openssl
else
  err "未识别的包管理器，请手动安装 nginx、python3（含 venv）、rsync、openssl"
fi

# ---- 2. 运行用户（系统用户，无登录权限）----
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DEPLOY_ROOT" --shell /usr/sbin/nologin "$APP_USER"

# ---- 3. 同步代码到 /opt/water-ops ----
# .env / .venv / *.db / uploads 被排除：保护线上配置、数据库与已建虚拟环境（配合 --delete 也不会丢）
log "同步代码到 $DEPLOY_ROOT"
mkdir -p "$DEPLOY_ROOT"
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
  --exclude '.venv' --exclude '.env' --exclude '__pycache__' \
  --exclude 'uploads' --exclude '*.db' --exclude '*.db-shm' --exclude '*.db-wal' \
  "$PROJ/backend" "$PROJ/scada-gateway" "$PROJ/ai-service" "$DEPLOY_ROOT/"

# ---- 4. 前端静态产物 ----
if [ -d "$PROJ/frontend/dist" ]; then
  log "使用已构建的前端 dist"
else
  command -v npm >/dev/null 2>&1 || err "未找到 frontend/dist，且服务器没有 npm。请先在本地构建：cd frontend && npm run build，再把 dist 上传到服务器重跑本脚本"
  log "在服务器上构建前端（npm ci && npm run build）"
  (cd "$PROJ/frontend" && npm ci && npm run build)
fi
mkdir -p "$DEPLOY_ROOT/frontend"
rsync -a --delete "$PROJ/frontend/dist" "$DEPLOY_ROOT/frontend/"

# ---- 5. Python 虚拟环境（三个服务各自独立）----
for svc in backend scada-gateway ai-service; do
  log "准备 $svc 虚拟环境"
  [ -d "$DEPLOY_ROOT/$svc/.venv" ] || python3 -m venv "$DEPLOY_ROOT/$svc/.venv"
  "$DEPLOY_ROOT/$svc/.venv/bin/pip" install -q --upgrade pip
  "$DEPLOY_ROOT/$svc/.venv/bin/pip" install -q -r "$DEPLOY_ROOT/$svc/requirements.txt"
done

# ---- 6. 首次生成 .env 并注入随机密钥 ----
rand() { openssl rand -hex 24; }
copy_env() { [ -f "$DEPLOY_ROOT/$1/.env" ] || cp "$PROJ/deploy/env/$2" "$DEPLOY_ROOT/$1/.env"; }
set_key() { sed -i "s|^$2=.*|$2=$3|" "$1"; }

copy_env backend backend.env.example
copy_env scada-gateway scada-gateway.env.example
copy_env ai-service ai-service.env.example

B_ENV="$DEPLOY_ROOT/backend/.env"
G_ENV="$DEPLOY_ROOT/scada-gateway/.env"
A_ENV="$DEPLOY_ROOT/ai-service/.env"

# 只在仍是占位符时注入（避免重复部署冲掉运行中的令牌）
if grep -q '__JWT_SECRET__' "$B_ENV"; then
  set_key "$B_ENV" JWT_SECRET "$(rand)"
  log "已生成随机 JWT_SECRET"
fi
if grep -q '__SCADA_TOKEN__' "$B_ENV"; then
  T="$(rand)"
  set_key "$B_ENV" SCADA_GATEWAY_TOKEN "$T"
  set_key "$B_ENV" SCADA_INGEST_TOKEN "$T"
  set_key "$G_ENV" GATEWAY_TOKEN "$T"
  set_key "$G_ENV" MAIN_APP_WEBHOOK_TOKEN "$T"
  log "已生成并同步 SCADA 服务间令牌（backend ↔ scada-gateway）"
fi
if grep -q '__AI_TOKEN__' "$B_ENV"; then
  T="$(rand)"
  set_key "$B_ENV" AI_SERVICE_TOKEN "$T"
  set_key "$B_ENV" AI_INTERNAL_TOKEN "$T"
  set_key "$A_ENV" AI_SERVICE_TOKEN "$T"
  log "已生成并同步 AI 服务间令牌（backend ↔ ai-service）"
fi

# ---- 7. 目录属主交给运行用户 ----
chown -R "$APP_USER:$APP_USER" "$DEPLOY_ROOT"

# ---- 8. systemd 服务 ----
log "安装并启动 systemd 服务"
cp "$PROJ/deploy/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now water-ops-scada-gateway water-ops-ai water-ops-backend
# enable --now 已处理首启；此处 restart 确保重复部署时加载最新代码与环境
systemctl restart water-ops-scada-gateway water-ops-ai water-ops-backend

# ---- 9. Nginx ----
log "配置 Nginx"
cp "$PROJ/deploy/nginx/water-ops.conf" /etc/nginx/conf.d/water-ops.conf
rm -f /etc/nginx/sites-enabled/default   # Ubuntu/Debian 默认站点占用 80 端口
# CentOS/RHEL：SELinux 默认禁止 nginx 反代到本机端口，需显式放行
command -v setsebool >/dev/null 2>&1 && setsebool -P httpd_can_network_connect 1 || true
# CentOS/RHEL：firewalld 放行 80
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo ""
log "部署完成"
systemctl --no-pager status water-ops-backend water-ops-scada-gateway water-ops-ai 2>/dev/null | grep -E '●|Active:' || true
echo ""
echo "  访问: http://<服务器IP>"
echo "  日志: journalctl -u water-ops-backend -f   （其余两个服务同理换 -u 名称）"
echo ""
echo "  收尾三件事："
echo "  1) 首次启动已种子 admin 账号，密码在 $B_ENV 的 BOOTSTRAP_ADMIN_PASSWORD，请登录后立即修改"
echo "  2) AI 功能需要本机 Ollama 运行：curl https://ollama.com/install.sh | sh && ollama pull qwen2.5:7b && ollama pull nomic-embed-text"
echo "  3) 接真实 OPC UA：编辑 $G_ENV，把 SOURCE_MODE 改为 opcua 并核对 OPCUA_ENDPOINT，然后 systemctl restart water-ops-scada-gateway"
