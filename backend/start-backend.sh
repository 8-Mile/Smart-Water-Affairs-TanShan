#!/bin/bash
# 按当前 git 分支选择独立 SQLite 库启动后端：
#   dazhangzhuang-dev -> water_ops_dzz.db
#   其他分支(含 dev) -> water_ops.db
# 环境变量 DATABASE_URL 优先级高于 .env，启动即生效，无需改动 .env。
set -e
cd "$(dirname "$0")"

BRANCH=$(git -C .. branch --show-current 2>/dev/null || echo "")
case "$BRANCH" in
  dazhangzhuang-dev) DB_URL="sqlite:///./water_ops_dzz.db" ;;
  *)                 DB_URL="sqlite:///./water_ops.db" ;;
esac

echo "[start-backend] branch=${BRANCH:-unknown} db=${DB_URL}"
DATABASE_URL="$DB_URL" exec ./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
