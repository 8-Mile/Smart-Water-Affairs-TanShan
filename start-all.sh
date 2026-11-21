#!/bin/bash
# 一键启动后端 + 前端
PROJ="/Users/8-mile/Desktop/产品文档/新一代运管平台/代码/fby-project-handoff-2026-10-03"

echo "==> 清理旧进程"
pkill -9 -f uvicorn 2>/dev/null
pkill -9 -f vite 2>/dev/null
sleep 1

echo "==> 清缓存"
find "$PROJ/backend" -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find "$PROJ/frontend/node_modules" -name ".vite" -exec rm -rf {} + 2>/dev/null
# 注意：不要直接删 water_ops.db-wal/-shm，未 checkpoint 的提交会随之丢失；交由 SQLite 自行恢复。

echo "==> 启动后端 (port 8000)"
cd "$PROJ/backend"
nohup "$PROJ/backend/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
echo "后端 PID: $!"

echo "==> 启动前端 (port 5173)"
cd "$PROJ/frontend"
nohup /usr/local/bin/npm run dev > /tmp/frontend.log 2>&1 &
echo "前端 PID: $!"

sleep 8
echo ""
echo "========== 状态 =========="
echo "后端: $(lsof -i :8000 -sTCP:LISTEN -t 2>/dev/null | head -1 || echo '未监听')"
echo "前端: $(lsof -i :5173 -sTCP:LISTEN -t 2>/dev/null | head -1 || echo '未监听')"
echo ""
echo "后端日志(最后3行):" && tail -3 /tmp/backend.log
echo ""
echo "前端错误:" && grep -i "error\|fail" /tmp/frontend.log | tail -3 || echo "无错误"
echo ""
echo "访问 http://localhost:5173"
