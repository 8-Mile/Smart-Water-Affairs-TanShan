#!/usr/bin/env bash
# 一键启动前后端开发服务（macOS / Linux）
# 用法：bash start-dev.sh

set -e
PROJ="$(cd "$(dirname "$0")" && pwd)"

echo "=== 生产运维管理系统 · 开发服务启动 ==="

# 清理旧进程
for port in 5173 5174 8000; do
  pids=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  清理端口 $port: $(echo $pids | tr '\n' ' ')"
    kill -9 $pids 2>/dev/null
  fi
done
sleep 1

# 后端
echo -n "后端 FastAPI (8000) ... "
cd "$PROJ/backend"
nohup .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/backend.log 2>&1 &
disown 2>/dev/null || true
BACK_PID=$!

# 前端
echo -n "前端 Vite (5173) ... "
cd "$PROJ/frontend"
rm -rf node_modules/.vite
nohup npx vite --port 5173 --host 0.0.0.0 > /tmp/vite.log 2>&1 &
disown 2>/dev/null || true
FRONT_PID=$!

# 等起来
for i in $(seq 1 15); do
  sleep 1
  if curl -s -o /dev/null http://localhost:8000/api/v1/health && \
     curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ | grep -q "200"; then
    break
  fi
done

echo ""
echo "=== 启动完成 ==="
echo "后端 PID $BACK_PID → http://localhost:8000  (日志 /tmp/backend.log)"
echo "前端 PID $FRONT_PID → http://localhost:5173  (日志 /tmp/vite.log)"
echo ""
echo "停止命令：kill $BACK_PID $FRONT_PID   或   pkill -f 'uvicorn|vite'"
