# 本地如何跑起来应用

本文说明 **开发环境** 如何启动生产运维管理系统（后端 FastAPI + 前端 Vue3）。  
生产部署请见 [DEPLOY.md](./DEPLOY.md)。

**当前版本：** 1.0.0  
**客户操作手册：** [USER_GUIDE.md](./USER_GUIDE.md) · [PDF](./生产运维管理系统-用户使用手册.pdf)

---

## 多风格界面（交付差异化）

系统提供 **4 套** 布局/登录风格，业务功能相同，壳层不同：

| 主题 ID | 气质 | 布局特征 |
|---------|------|----------|
| `harbor` | 深蓝政务（默认） | 左深色侧栏 + 白顶栏 |
| `slate` | 现代 SaaS | 顶栏导航 + 二级侧栏 |
| `orchid` | 轻量卡片 | 浅色侧栏 + 大圆角内容卡片 |
| `ember` | 运维深色 | 顶栏信息条 + 窄侧栏深色壳 |

### 开发预览

```bash
cd frontend
npm run dev
```

右下角 **主题预览** 可切换四套（仅开发环境，会刷新页面）。  
也可在 `frontend/.env.development` 修改：

```env
VITE_UI_THEME=slate
VITE_APP_TITLE=某某水厂运维平台
```

### 交付不同使用方

分别构建，产物中 **无** 主题切换入口：

```bash
cd frontend
VITE_UI_THEME=harbor VITE_APP_TITLE=甲泵站运维平台 npm run build
VITE_UI_THEME=slate  VITE_APP_TITLE=乙水厂生产管理系统 npm run build
VITE_UI_THEME=orchid VITE_APP_TITLE=丙站智慧运维 npm run build
VITE_UI_THEME=ember  VITE_APP_TITLE=丁厂值班监控台 npm run build
```

设计说明：`docs/superpowers/specs/2026-07-15-multi-theme-ui-design.md`

---

## SCADA Gateway（阶段 1–2）

Mock 采集与时序存储在独立进程（**8100**）。阶段 2 起可通过 Webhook 推到主站镜像表并触发告警。

### 单进程开发（默认）

主站 `SCADA_MODE=mock`（默认），无需起 Gateway，行为与以前一致。

### 双进程联调（gateway 模式）

**终端 A — Gateway：**

```bash
cd scada-gateway
source .venv/bin/activate
# .env 中 MAIN_APP_WEBHOOK_URL=http://127.0.0.1:8000/api/v1/internal/scada/samples
uvicorn app.main:app --reload --port 8100
```

**终端 B — 主业务：**

```bash
cd backend
source .venv/bin/activate
# .env 中设置：
# SCADA_MODE=gateway
# SCADA_AUTO_START=false
# SCADA_GATEWAY_URL=http://127.0.0.1:8100
# SCADA_GATEWAY_TOKEN=dev-scada-gateway-token-change-me
uvicorn app.main:app --reload --port 8000
```

**终端 C — 前端：** `cd frontend && npm run dev`

gateway 模式下，前端 **SCADA 实时监控** 的启停仿真 / 注入测点会由主站 **代理到 Gateway**（按 tag_name），数值经 Webhook 镜像回主站，页面无需改动。

| 配置 | 含义 |
|------|------|
| `SCADA_MODE=mock` | 主站内置仿真（默认，单进程） |
| `SCADA_MODE=gateway` | runtime/inject 走 Gateway |
| `SCADA_DATA_SOURCE=mirror` | latest/history 读主站镜像（默认） |
| `SCADA_DATA_SOURCE=gateway` | latest/history 透传 Gateway |

- Gateway 文档：http://127.0.0.1:8100/docs  
- Token：`X-Gateway-Token: dev-scada-gateway-token-change-me`  
- 说明：`scada-gateway/README.md`  
- OPC-UA：`docs/OPC_UA.md`

---

## 本地 AI（阶段 4–8）

完整步骤见 **[AI_SETUP.md](./AI_SETUP.md)**。

```bash
ollama serve
ollama pull qwen2.5:7b
ollama pull nomic-embed-text   # 档案 RAG

cd ai-service && source .venv/bin/activate
uvicorn app.main:app --reload --port 8200
```

主站 `AI_ENABLED=true`。能力：闲聊、Tools 查数、档案 RAG、确认后写工单/调度、流式回复、会话侧栏、对话限流。

---

## 推荐：多服务开发启动顺序

| 顺序 | 服务 | 端口 | 命令摘要 |
|------|------|------|----------|
| 1 | Ollama | 11434 | `ollama serve` |
| 2 | 主站 backend | 8000 | `uvicorn app.main:app --reload --port 8000` |
| 3 | SCADA Gateway（可选） | 8100 | `uvicorn app.main:app --reload --port 8100`（`SOURCE_MODE=mock\|opcua`） |
| 4 | AI Service | 8200 | `uvicorn app.main:app --reload --port 8200` |
| 5 | 前端 | 5173 | `npm run dev` |

- 仅业务功能：主站 + 前端即可（`SCADA_MODE=mock`）。  
- Gateway 模式：主站 `SCADA_MODE=gateway` + Gateway Webhook。  
- AI：主站与 ai-service **必须同时**运行。

---

## 1. 环境要求

| 组件 | 建议版本 |
|------|----------|
| Python | 3.11+ |
| Node.js | 18+ |
| npm | 随 Node 安装即可 |
| 数据库 | 开发默认 **SQLite**；可选 MySQL 8 |

操作系统：macOS / Linux / Windows 均可。

---

## 2. 目录结构（相关部分）

```text
fby/
├── backend/          # FastAPI 后端
│   ├── app/
│   ├── .env          # 本地配置（由 .env.example 复制）
│   ├── .venv/        # Python 虚拟环境
│   └── requirements.txt
├── frontend/         # Vue3 前端
│   ├── src/
│   └── package.json
└── docs/
    ├── RUN.md        # 本文
    ├── DEPLOY.md     # 生产部署
    └── UAT.md        # 验收清单
```

---

## 3. 首次安装

### 3.1 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # 已有 .env 可跳过
```

`.env` 中与本地启动最相关的配置：

| 配置项 | 开发建议 | 说明 |
|--------|----------|------|
| `DATABASE_URL` | `sqlite:///./water_ops.db` | 无需安装 MySQL |
| `CORS_ORIGINS` | 含 `http://localhost:5173` | 允许前端跨域 |
| `SCADA_MODE` | `mock` | 仿真 SCADA |
| `SCADA_AUTO_START` | `true` | 启动后端时自动开仿真 |
| `BOOTSTRAP_ADMIN_USERNAME` | `admin` | 首次种子管理员 |
| `BOOTSTRAP_ADMIN_PASSWORD` | `admin123` | 首次种子密码 |

### 3.2 前端

```bash
cd frontend
npm install
```

---

## 4. 日常启动（两个终端）

**务必先起后端，再起前端。**

### 终端 A — 后端（端口 8000）

```bash
cd backend
source .venv/bin/activate          # Windows: .venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

成功标志：日志出现类似：

```text
Uvicorn running on http://127.0.0.1:8000
```

| 用途 | 地址 |
|------|------|
| 服务根 | http://localhost:8000 |
| Swagger 文档 | http://localhost:8000/docs |
| 健康检查 | http://localhost:8000/api/v1/health |

首次启动会自动：

- 建表（SQLite 文件：`backend/water_ops.db`）
- 种子管理员、角色菜单、默认 SCADA 测点等
- 若 `SCADA_AUTO_START=true`，启动 **SCADA mock 仿真线程**

### 终端 B — 前端（端口 5173）

```bash
cd frontend
npm run dev
```

浏览器打开：

**http://localhost:5173**

前端开发服务器会把 `/api` 代理到 `http://127.0.0.1:8000`（见 `frontend/vite.config.ts`），因此后端必须在 8000 端口监听。

---

## 5. 登录

| 字段 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | `admin123` |

> 上线或给他人使用前请修改默认密码（支持接口改密：`POST /api/v1/auth/change-password`）。

---

## 6. 启动后可验证的功能入口

| 菜单 | 说明 |
|------|------|
| 工作台 | KPI、图表、待办 |
| SCADA → 测点配置 / 实时监控 | mock 测点是否在刷新 |
| 告警 / 维修工单 | 告警与工单闭环 |
| 巡检 / 维保 / 调度 | 运维业务 |
| 供水 / 能耗 | 统计与电费 |
| 档案管理 | 上传下载收藏 |
| 系统管理 | 组织、用户、角色、菜单 |

### 快速确认 SCADA 仿真

1. 打开 **SCADA → 实时监控**，数值应随时间变化。  
2. 或调用运行状态：

```bash
curl -s http://127.0.0.1:8000/api/v1/health
```

健康检查中 `checks.scada.running` 应为 `true`（自动启动开启时）。

### 手动注入测点值（可选）

```bash
# 1) 登录拿 token
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")

# 2) 注入温度点 700（可配合告警规则联调）
curl -s -X POST http://127.0.0.1:8000/api/v1/scada/inject \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"tag_name":"700","value":95}'
```

---

## 7. 停止服务

在对应终端按 **`Ctrl + C`**。

后端进程退出时会停止 SCADA 仿真线程。

---

## 8. 一键命令备忘

```bash
# 终端 A
cd /path/to/fby/backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# 终端 B
cd /path/to/fby/frontend && npm run dev

# 浏览器
open http://localhost:5173   # macOS
```

---

## 9. 常见问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 前端页面能开，接口 404/网络错误 | 后端未启动或端口不是 8000 | 先起 `uvicorn`，确认 8000 |
| `Address already in use` | 端口被占用 | 换端口，或结束占用进程 |
| 登录失败 | 密码错误 / 库被清空后种子未跑 | 用默认账号；必要时删库重建 |
| 测点数值不更新 | 仿真未启动 | `POST /api/v1/scada/runtime/start` 或检查 `.env` 中 `SCADA_AUTO_START` |
| 想清空本地数据重来 | SQLite 文件残留 | 停后端后删除 `backend/water_ops.db`，再启动 |
| `pip` / `npm` 安装慢 | 镜像问题 | 使用国内镜像源重试 |

### 端口被占用时

```bash
# 查看占用（macOS / Linux）
lsof -i :8000
lsof -i :5173

# 后端换端口示例
uvicorn app.main:app --reload --port 8001
# 同时修改 frontend/vite.config.ts 里 proxy.target 为 8001
```

### 重置 SQLite 数据

```bash
# 先停止后端
cd backend
rm -f water_ops.db
# 再启动后端 → 自动重建表与种子数据
```

---

## 10. 自动化测试（可选）

```bash
# 后端单测
cd backend
source .venv/bin/activate
pytest -q

# 前端生产构建校验
cd frontend
npm run build
```

---

## 11. 相关文档

| 文档 | 内容 |
|------|------|
| [DEPLOY.md](./DEPLOY.md) | 生产部署、Nginx、环境变量 |
| [UAT.md](./UAT.md) | 用户验收检查表 |
| [ARCHITECTURE.md](./planning/ARCHITECTURE.md) | 技术架构 |
| [重建规划](./planning/2026-07-13-生产运维系统-重建规划.md) | 分期与范围 |

---

**小结：** 两个进程 — `uvicorn`（8000）+ `npm run dev`（5173）→ 浏览器打开 http://localhost:5173 → `admin` / `admin123`。
