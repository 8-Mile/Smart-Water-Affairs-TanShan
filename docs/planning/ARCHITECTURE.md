# 生产运维管理系统 — 技术架构（冻结）

> **版本**：V1.0  
> **日期**：2026-07-13  
> **依据**：`2026-07-13-生产运维系统-重建规划.md` V0.2 已确认决策

---

## 1. 技术栈（冻结）

| 层 | 选型 | 版本基线 |
|----|------|----------|
| 后端 | FastAPI + Uvicorn | Python 3.11+ |
| ORM | SQLAlchemy 2.x + Alembic | — |
| 校验 | Pydantic v2 | — |
| 鉴权 | JWT（Bearer）+ RBAC | — |
| 数据库 | MySQL 8 | — |
| 前端 | Vue 3 + TypeScript + Vite | Node 18+ |
| UI | Element Plus | — |
| 状态/路由 | Pinia + Vue Router | — |
| 图表 | ECharts（后续阶段引入） | — |
| SCADA | 仿真优先；真机用 asyncua | Phase 2 |
| 反向代理 | Nginx（上线时） | 开发期 Vite 代理 |

## 2. 架构形态

- **单体 FastAPI**：API + 鉴权 + 业务 +（后续）告警引擎 / SCADA 仿真同仓。
- SCADA 代码放在 `backend/app/scada/`，接口清晰，必要时再拆进程。
- 前端 SPA，开发期 `vite proxy → :8000`，生产期 Nginx 托管 dist + 反代 `/api`。

## 3. 仓库结构

```
fby/
├── backend/                 # FastAPI
│   ├── app/
│   │   ├── main.py
│   │   ├── core/            # config, security, deps, response
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── api/             # routers
│   │   ├── services/
│   │   ├── scada/           # Phase 2+
│   │   └── alarm_engine/    # Phase 3+
│   ├── alembic/
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── frontend/                # Vue3
│   └── src/
│       ├── api/
│       ├── views/
│       ├── layouts/
│       ├── router/
│       ├── stores/
│       └── components/
├── docs/planning/
└── scripts/
```

## 4. API 约定

- 前缀：`/api/v1`
- 统一响应：

```json
{ "code": 0, "message": "ok", "data": {} }
```

- 业务错误：`code != 0`，HTTP 多数仍 200 或按场景 4xx；鉴权失败 401。
- 分页请求：`page`（从 1）、`page_size`
- 分页响应：`{ "items": [], "total": 0, "page": 1, "page_size": 20 }`
- JWT：`Authorization: Bearer <token>`

## 5. 配置与密钥

- 仅通过环境变量 / `.env` 注入
- 仓库只提交 `.env.example`
- 禁止把数据库密码、JWT secret 写进代码

## 6. 首期范围（到 M3）

P0 骨架 → P1 系统底座+设备 → P2 SCADA 仿真 → P3 告警 → P4 工单闭环。

- **不迁移**旧数据
- **不做**一键部署包（开发完成后再定）
- OPC **先仿真**

### SCADA 模块约定（Phase 2）

| 项 | 说明 |
|----|------|
| 模式 | `SCADA_MODE=mock`（默认）；真机预留 `opcua` |
| 测点表 | `scada_points` |
| 最新值 | `scada_point_latest` |
| 历史 | `scada_tag_data`（对齐旧系统表名） |
| 运行时 | `app/scada/simulator.py` 后台线程周期写库 |
| API | `/api/v1/scada/*`（points / latest / history / runtime / inject） |
| 旧配置参考 | `opc.tcp://192.168.2.222:9433`，Security None，匿名 |

## 7. 开发命令（约定）

```bash
# 后端
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 按需改
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 前端
cd frontend
npm install
npm run dev
```

默认：前端 `http://localhost:5173`，后端 `http://localhost:8000`，文档 `http://localhost:8000/docs`。
