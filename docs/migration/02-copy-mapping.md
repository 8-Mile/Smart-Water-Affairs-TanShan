# 02 · 复制映射与独立运行

## 1. 新工程

- 目录：`/Users/8-mile/代码仓库/唐港智慧水务-迁移开发版`
- 来源：`/Users/8-mile/代码仓库/唐港智慧水务`（完整仓库，不含 node_modules、.venv、dist、.git、缓存、日志、`*.db-wal/shm`、`.env`）
- 前端端口：`5190`（`strictPort: true`）
- 后端端口：`8010`（独立进程，独立 SQLite 快照）

## 2. 排除项与理由

| 排除项 | 理由 |
|---|---|
| `frontend/node_modules`、`backend/.venv` | 平台相关，按锁文件重装 |
| `frontend/dist`、`release/`、`build/` | 历史构建产物 |
| `.git` | 新工程重新初始化，基线提交可回滚到确定状态 |
| `backend/water_ops.db` 及 WAL/SHM | 运行库另用 `sqlite3 .backup` 生成一致性快照，避免复制半写文件 |
| `.env` | 可能含真实密钥，改为脱敏 `.env`（仅开发示例值） |

## 3. 端口与反向代理

`frontend/vite.config.ts`：

- dev：`5190`，`/api` → `http://127.0.0.1:8010`
- preview：`4190`，`/api` → `http://127.0.0.1:8010`

`backend/.env`（仅示例）：

```ini
DATABASE_URL=sqlite:///./water_ops.db
CORS_ORIGINS=http://localhost:5190,http://127.0.0.1:5190,...
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=admin123
SCADA_MODE=mock
SCADA_AUTO_START=true
AI_ENABLED=false
```

## 4. 数据快照

```bash
sqlite3 /源/5175/backend/water_ops.db \
  ".backup '/新工程/backend/water_ops.db'"
```

快照成功后 `PRAGMA integrity_check` = ok。新工程不读写 5175/5188/5174 的端口与文件进程。

## 5. 启动方式

```bash
# 后端（新工程内）
cd backend && .venv/bin/python -m uvicorn app.main:app --port 8010

# 前端
cd frontend && npx vite --port 5190 --host 0.0.0.0
```

依赖安装：

- 前端 `npm ci`（`package-lock.json` 锁定，361 包）
- 后端 Python 3.13 venv + `pip install -r requirements.txt`

## 6. 端口独立性验证

- `curl http://localhost:5190/api/v1/health` → 200（经 Vite 代理到 8010）
- 页面全部静态资源与 CAD/GLB 请求均指向 5190，不请求 5188/5175
- 关闭 5175/5188 后，5190 页面与接口不受影响（仅 5175 回归测试时另行启动）
