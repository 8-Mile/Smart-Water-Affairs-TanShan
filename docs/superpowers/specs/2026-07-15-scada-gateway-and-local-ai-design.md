# SCADA 独立网关 + 本地 AI 助手 — 设计方案

**日期：** 2026-07-15  
**状态：** 设计稿（待确认后分期实现）  
**关联系统：** 生产运维管理系统 1.0.0  
**原则：** 本地优先、可离线、业务主站与采集/AI 解耦  

---

## 0. 目标一句话

1. **SCADA 网关服务**：Mock / 真 OPC-UA 统一在独立进程采集与存盘，主业务系统只消费数据、做告警与工单。  
2. **本地 AI 助手**：用本机大模型（Ollama 等）对系统业务数据与档案做自然语言问答，并在受控下创建业务数据（工单、计划等）。

---

## 1. 现状与痛点

| 现状 | 问题 |
|------|------|
| Mock 仿真线程跑在主 FastAPI 进程内（`app/scada/simulator.py`） | 采集与业务耦合；主站重启中断仿真；难单独扩容/替换真 OPC |
| 写库后直接调告警引擎 | 数据源切换时告警触发路径易乱 |
| 无 AI 能力 | 值班查数、翻档案依赖菜单与人工检索 |

**目标架构（逻辑）：**

```text
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  Mock 引擎      │     │  SCADA Gateway       │     │  主业务系统 (现有)   │
│  或 OPC-UA PLC  │────▶│  :8100               │────▶│  :8000               │
└─────────────────┘     │  · 采集 / 中转       │     │  · 告警 / 工单 / …  │
                        │  · 时序落库          │     │  · 读最新值/历史     │
                        │  · 推送变更          │     │  · 档案 / RBAC      │
                        └──────────────────────┘     └──────────┬──────────┘
                                                               │
                        ┌──────────────────────┐               │
                        │  AI 服务 :8200       │◀──────────────┘
                        │  · Tool/RAG          │
                        │  · 调业务 API        │
                        │  · 调本地 LLM        │
                        └──────────┬───────────┘
                                   │
                        ┌──────────▼───────────┐
                        │  Ollama / 本地模型    │
                        │  (qwen2.5 等)        │
                        └──────────────────────┘
```

---

# 第一部分：SCADA Gateway（独立中转站）

## 2. 职责边界

### 2.1 Gateway **负责**

| 职责 | 说明 |
|------|------|
| 数据源适配 | `mock` 仿真；`opcua` 真机订阅（asyncua，可后置） |
| 测点注册（采集侧） | tag_name、node_id、类型、仿真参数 / OPC 节点 |
| 数据持久化 | **最新值 + 历史时序** 全量存（本服务库） |
| 对外发布 | REST 查询 + WebSocket/SSE 实时推送 + 可选 Webhook 推主站 |
| 运行时控制 | start/stop、mode 切换、单点 inject（联调） |
| 健康与指标 | 连接状态、tick、写入延迟、断线重连 |

### 2.2 主业务系统 **负责**

| 职责 | 说明 |
|------|------|
| 业务测点映射 | 设备绑定 tag、告警规则 |
| 告警引擎 | 订阅 Gateway 新值或轮询 latest，评估规则 |
| 工单 / 巡检 / 供水能耗 | 只读 SCADA 历史/最新，不直接连 PLC |
| 用户权限与 UI | 保持现有 `/api/v1/scada/*` 外观，内部改为代理 Gateway |

### 2.3 明确 **不** 放在 Gateway 的内容

- 不跑告警规则、不写维修工单  
- 不做用户 JWT 业务鉴权（可用独立服务 Token / mTLS / 内网白名单）  
- 不存档案 PDF、不存组织用户  

---

## 3. 部署与进程

建议 monorepo 新增目录（与现有 `backend/` 并列）：

```text
fby/
├── backend/                 # 主业务 API（现有）
├── scada-gateway/           # 新建：独立服务
│   ├── app/
│   │   ├── main.py
│   │   ├── sources/         # mock.py, opcua.py
│   │   ├── store/           # models, writer, retention
│   │   ├── api/             # points, samples, stream, runtime
│   │   └── push/            # webhook to main app (optional)
│   ├── requirements.txt
│   └── .env.example
├── ai-service/              # 新建：本地 AI（见第二部分）
├── frontend/
└── docs/
```

| 服务 | 默认端口 | 数据库建议 |
|------|----------|------------|
| 主业务 | 8000 | `water_ops`（业务表；SCADA 表可逐步只读镜像或废弃本地写） |
| SCADA Gateway | **8100** | 独立库 `scada_hub`（SQLite 开发 / MySQL 生产）或 **Timescale/同 MySQL 独立 schema** |
| AI Service | **8200** | 可选：对话历史、向量索引（见 AI 节） |
| Ollama | 11434 | 模型文件本地 |

**开发启动顺序：** Gateway → 主业务 → 前端 →（可选）Ollama + AI。

---

## 4. Gateway 数据模型

保留与现网兼容的语义，便于迁移：

| 表 | 作用 |
|----|------|
| `gw_points` | 测点注册：tag_name, node_id, value_type, unit, enabled, sim_*, source |
| `gw_point_latest` | 最新值缓存：value_*, ts_ms, quality, updated_at |
| `gw_tag_data` | 历史时序：tag_name, node_id, value_*, ts_ms（可按月分区/归档） |
| `gw_ingest_log`（可选） | 批次写入统计、错误 |

**质量码：** `Good / Bad / Uncertain`，Mock 默认 Good。

**保留策略（可配）：**

- 历史默认保留 **90 天**（`RETENTION_DAYS`）  
- 定时任务删除过期 `gw_tag_data`  
- 最新值永不过期（仅覆盖）

---

## 5. Gateway API（对外契约）

前缀建议：`http://127.0.0.1:8100/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 存活 + source 状态 |
| GET/POST/PUT | `/points` | 测点 CRUD |
| GET | `/latest` | 全部或按 tag 过滤最新值 |
| GET | `/history` | `tag_name` + `from_ts` + `to_ts` + limit |
| POST | `/runtime/start\|stop` | 启停采集 |
| GET | `/runtime/status` | mode、running、endpoint、tick |
| POST | `/inject` | 写单点（mock/联调；真机是否允许写由配置） |
| WS | `/ws/stream` | 推送 `{tag_name, value, ts_ms, quality}` 批次 |
| POST | `/webhook/test` | 测试推送主站 |

**鉴权（内网）：**  
`X-Gateway-Token: <shared secret>`（主站与 Gateway 共享），不对公网暴露 8100。

---

## 6. 主站接入方式（两种，可组合）

### 方案 A：主站代理 + 本地镜像写（推荐迁移路径）

```text
Gateway 写 scada_hub
    │
    ├─ Webhook/WS ──▶ 主站 Ingest API
    │                    └─ 写 scada_point_latest / scada_tag_data（兼容旧表）
    │                    └─ evaluate_alarms_for_tags()
    │
    └─ 主站 /scada/* 读本地镜像 或 透传 Gateway
```

- **优点：** 告警引擎几乎不用改；前端无感  
- **缺点：** 数据双写一份（可控）

### 方案 B：主站只读 Gateway，不落历史

- 主站 `/scada/latest|history` HTTP 转发 Gateway  
- 告警引擎定时拉 latest 或订 WS  
- **优点：** 单存储  
- **缺点：** Gateway 宕机业务监控全挂；改造面大  

**推荐：一期用方案 A（推送镜像 + 告警仍在主站），二期可选历史只存 Gateway、主站只留 latest。**

### 主站改造点

| 文件/模块 | 改动 |
|-----------|------|
| `main.py` lifespan | **去掉**内置 `scada_runtime.start()` |
| 新 `services/scada_client.py` | HTTP/WS 客户端连 Gateway |
| 新 `api/scada_ingest.py` | 接收 Gateway webhook：`POST /api/v1/internal/scada/samples` |
| `api/scada.py` | runtime 控制转发 Gateway；points 可主站维护后同步 Gateway 或只在 Gateway 维护 |
| 配置 | `SCADA_GATEWAY_URL`、`SCADA_GATEWAY_TOKEN`、`SCADA_INGEST_MODE=webhook\|poll` |

测点配置 **单一事实来源** 建议：  
- **一期：** 仍在主站配置测点 → 同步 API 推到 Gateway  
- **二期：** 测点只在 Gateway，主站只存「设备-tag 绑定」与告警规则  

---

## 7. Mock / 真机 统一接口

```text
SourceAdapter (protocol)
  ├── MockSource.tick() -> list[Sample]
  └── OpcUaSource.on_data_change() -> list[Sample]
           │
           ▼
     SamplePipeline
           │
           ├─► store.apply_samples()   # 落 latest + history
           ├─► stream.broadcast()      # WS
           └─► webhook.push(main_app)  # 可选
```

Mock 参数迁移自现有 `sim_base / sim_amplitude / sim_period_sec`。  
OPC-UA：`endpoint`、`security_policy`、`auth` 从 Gateway `.env` 读取（现 `SCADA_OPCUA_*` 迁走）。

---

## 8. 实施分期（SCADA）

| 阶段 | 内容 | 验收 |
|------|------|------|
| **S0** | 抽出 `scada-gateway` 骨架 + Mock + 落库 + REST latest/history | 独立进程有数据 |
| **S1** | Webhook → 主站 ingest + 告警仍触发；主站关闭内置仿真 | 告警闭环不回归 |
| **S2** | 主站 runtime/inject 代理到 Gateway；前端无感 | UAT SCADA 项通过 |
| **S3** | OPC-UA adapter（真机）+ 断线重连 | 配置切 `opcua` 可读现场 |
| **S4** | 保留策略、监控、可选历史只存 Gateway | 磁盘与性能可控 |

---

# 第二部分：本地 AI 助手

## 9. 目标能力

| 能力 | 说明 | 优先级 |
|------|------|--------|
| **自然语言问询** | 「现在有几条一类告警？」「1#泵最近温度？」 | P0 |
| **档案检索** | 问制度/图纸要点，基于文档中心 | P0 |
| **受控创建** | 「帮我建一条维修工单…」→ 确认后调业务 API | P1 |
| **多轮对话** | 会话上下文 | P0 |
| **审计** | 每次工具调用与结果落日志 | P0 |
| **纯本地** | 默认 Ollama，数据不出机房 | 硬性 |

**非目标（一期）：** 自动执行危险写操作不经确认、替人审批工单、连公有云大模型（可配置开关但默认关）。

---

## 10. 总体架构

```text
┌──────── Frontend ────────┐
│  AI 对话页 / 浮窗        │
│  流式展示 + 确认卡片     │
└───────────┬──────────────┘
            │ JWT
┌───────────▼──────────────┐
│  主业务 backend :8000    │
│  POST /api/v1/ai/chat    │  ──可选薄代理──▶
└───────────┬──────────────┘
            │ 服务间 Token
┌───────────▼──────────────┐
│  ai-service :8200        │
│  · Orchestrator          │
│  · Tool Registry         │
│  · RAG (档案)            │
│  · Policy / Confirm      │
└─────┬───────────┬────────┘
      │           │
      ▼           ▼
  Ollama      主业务 API + 档案文件
  :11434      (只带用户 JWT 或服务账号)
```

**为何独立 `ai-service`：**  
- 模型推理慢、占 GPU/内存，避免拖垮主 API  
- Prompt/Tool 迭代不影响业务发版  
- 可单独开关：没装 Ollama 时主站其余功能正常  

若资源紧，一期也可 **先把 AI 路由放进主 backend 子模块**，接口形状保持一致，二期再拆进程（接口兼容）。

---

## 11. 本地模型选型（建议）

| 场景 | 推荐模型（Ollama） | 备注 |
|------|-------------------|------|
| 默认对话 + 工具调用 | `qwen2.5:14b` 或 `qwen2.5:7b` | 中文与 JSON 工具调用较好 |
| 机器内存 ≤16GB | `qwen2.5:7b` / `qwen2.5:3b` | 工具能力变弱，需强 Schema 约束 |
| 仅嵌入（RAG） | `nomic-embed-text` 或 `bge-m3` | 档案向量化 |
| 长上下文 | `qwen2.5:14b` 32k 视显存 | 少塞全库，靠检索 |

配置示例：

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
AI_TEMPERATURE=0.2
AI_MAX_TOOL_ROUNDS=6
```

**无 GPU：** 7B Q4 可在较强 CPU 上跑，延迟数秒～十余秒，UI 需流式与「思考中」状态。

---

## 12. 工具（Tools）设计 — 系统数据读写

AI **不直连数据库**，一律通过 **主业务已有 REST**（复用 RBAC）：

### 12.1 只读工具（默认可自动执行）

| Tool 名 | 映射 API / 行为 |
|---------|-----------------|
| `get_dashboard_summary` | 工作台 KPI/待办 |
| `list_alarms` | 实时/历史告警，支持 level/status 过滤 |
| `list_repairs` | 工单列表与状态 |
| `get_scada_latest` | 测点最新值（主站或 Gateway） |
| `get_scada_history` | 指定 tag 时间范围历史 |
| `list_equipment` | 设备台账检索 |
| `list_dispatch` | 调度指令 |
| `list_inspection_tasks` | 巡检任务 |
| `search_archives` | 档案元数据检索（名称/分类） |
| `get_water_energy_stats` | 供水/能耗摘要 |
| `get_current_user` | 当前用户与角色 |

### 12.2 写工具（必须「确认后执行」）

| Tool 名 | 映射 | 风险 |
|---------|------|------|
| `create_repair_order` | 创建维修工单 | 中 |
| `create_dispatch` | 新建调度指令 | 中 |
| `create_inspection_plan` | 巡检计划 | 中 |
| `inject_scada_value` | 注入测点（仅测试/授权） | **高** |
| `upload_archive_meta` | 仅元数据；文件上传走 UI | 低 |

**确认协议：**

1. 模型返回 `tool_call` 且 `risk != read`  
2. 后端 **不执行**，向前端返回 `pending_action` 卡片（人类可读摘要 + JSON 参数）  
3. 用户点「确认执行」→ `POST /ai/confirm` → 服务端用 **用户 JWT** 调业务 API  
4. 结果回写对话；全程审计  

**禁止工具：** 删除用户、改角色、删档案实体、跳过审批直接验收通过（除非未来单独开「管理员代理」开关）。

---

## 13. 档案 / 文档中心 RAG

```text
档案上传成功（主站）
    │
    ▼
异步任务：拉取文件 → 解析文本
  · PDF: pypdf / pdfplumber
  · DOCX: python-docx
  · 图片扫描件：一期可只索引文件名+描述，OCR 二期
    │
    ▼
分块 (chunk 500~800 字, overlap 80)
    │
    ▼
Ollama embeddings → 向量库
  推荐：Chroma（本地目录）或 SQLite-VSS / Qdrant 单机
    │
    ▼
问询时：embed(question) → topK 块 → 塞进 Prompt 引用
```

**元数据过滤：** category_code、权限（全员可读档案一期；二期按角色）。  
**回答规范：** 必须带来源：`档案名 + 片段`，避免幻觉；找不到则明确说「档案库未检索到」。

**与「业务 Tool」分工：**

- 问「现在有多少待验收工单」→ **Tool**  
- 问「轴承温升巡检标准是什么」→ **RAG 档案**  
- 可组合：先 RAG 再建议建工单（写操作仍要确认）

---

## 14. 对话 API（主站暴露给前端）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/ai/chat` | body: `{ session_id?, message }` → 流式 SSE 或整包 |
| GET | `/api/v1/ai/sessions` | 历史会话列表 |
| GET | `/api/v1/ai/sessions/{id}` | 消息明细 |
| POST | `/api/v1/ai/confirm` | `{ action_id }` 执行挂起写操作 |
| POST | `/api/v1/ai/cancel` | 取消挂起 |
| GET | `/api/v1/ai/health` | Ollama 是否可达、当前模型 |

**响应事件类型（SSE 示例）：**

```text
event: token        data: {"text":"..."}
event: tool_start   data: {"name":"list_alarms"}
event: tool_result  data: {"name":"list_alarms","summary":"3条待处理"}
event: pending_action data: {"action_id":"...","title":"创建工单","payload":{...}}
event: done         data: {"session_id":"..."}
event: error        data: {"message":"..."}
```

---

## 15. 前端形态

| 元素 | 说明 |
|------|------|
| 菜单 **智能助手** | `/ai/chat` 全页对话 |
| 可选浮窗 | 各业务页右下角（勿与主题 DEV 切换器冲突） |
| 消息气泡 | 用户 / 助手 / 工具摘要 / **待确认卡片** |
| 空态提示 | 示例问题：「今日一类告警」「查设备 700 温度」「找水泵维保制度」 |

权限：新菜单 `ai:chat`；无权限不显示。写操作权限仍跟业务 API（助手不能提权）。

---

## 16. 安全与合规

| 项 | 措施 |
|----|------|
| 数据不出域 | 默认仅 Ollama localhost；禁止默认外发 OpenAI |
| 鉴权 | 对话 API 必须用户 JWT；Tool 调用继承该用户权限 |
| 注入防护 | 系统 Prompt 固定角色；用户输入当数据不执行指令优先 |
| 审计 | `ai_audit_log`：user_id, prompt摘要, tools, action, result_code |
| 限流 | 每用户 QPM；单会话 tool 轮次上限 |
| 敏感字段 | 密码、Token 不进 Prompt；档案下载链接短时有效 |

---

## 17. AI 实施分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **A0** | Ollama 连通 + `/ai/health` + 无工具闲聊 | 本地模型能答 |
| **A1** | 只读 Tools（告警/工单/SCADA/设备） | 自然语言查数准确率可抽检 |
| **A2** | 档案解析 + 向量检索 + 引用回答 | 问制度能指到档案 |
| **A3** | 写工具 + 确认卡片 + 审计 | 创建工单需人工点确认 |
| **A4** | 流式体验、会话管理、示例提示优化 | 值班可用 |

---

## 18. 与两需求的衔接关系

```text
SCADA Gateway 存全量时序
        │
        ▼
主站告警/供水能耗 ──┐
档案中心 ──────────┼──▶ AI Tools + RAG ──▶ 自然语言问答/受控创建
工单/调度/巡检 ────┘
```

Gateway 让「测点数据可信、可独立演进」；AI 让「人用自然语言消费这些数据与文档」。

---

## 19. 仓库与配置一览（落地后）

```env
# 主业务 backend/.env
SCADA_MODE=gateway
SCADA_GATEWAY_URL=http://127.0.0.1:8100
SCADA_GATEWAY_TOKEN=***
SCADA_AUTO_START=false

AI_ENABLED=true
AI_SERVICE_URL=http://127.0.0.1:8200
# 或内嵌时：
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
```

```bash
# 开发启动（示意）
cd scada-gateway && uvicorn app.main:app --port 8100
cd backend && uvicorn app.main:app --port 8000
cd ai-service && uvicorn app.main:app --port 8200
ollama serve && ollama pull qwen2.5:7b && ollama pull nomic-embed-text
cd frontend && npm run dev
```

---

## 20. 风险与对策

| 风险 | 对策 |
|------|------|
| 双写不一致 | Webhook 失败重试队列；主站可 poll 对账 |
| 本地模型幻觉 | 强制 Tool/RAG 优先；无证据不编造数字 |
| 7B 工具调用不稳定 | JSON Schema 校验失败重试；降级为「只检索展示」 |
| 档案扫描件无文本 | 二期 OCR；一期靠文件名+描述 |
| 性能 | AI/Gateway 分进程；历史降采样查询 |

---

## 21. 推荐确认项（请您拍板）

1. **SCADA 存储：**  
   - **R1（推荐）** Gateway 权威库 + 主站镜像 latest/history（方案 A）  
   - R2 仅 Gateway 存储，主站全透传  

2. **AI 部署：**  
   - **R1（推荐）** 独立 `ai-service` + Ollama  
   - R2 先嵌在主 `backend` 内模块，接口预留拆分  

3. **写操作：**  
   - **R1（推荐）** 一律确认卡片后执行  
   - R2 只读 AI，写操作二期再做  

4. **一期模型：** `qwen2.5:7b` 还是必须 `14b`？  

---

## 22. 确认后建议实施顺序

```text
1) scada-gateway S0–S2（独立 Mock + 主站切断内置仿真 + 告警不回归）
2) AI A0–A1（本地模型 + 只读问数）
3) AI A2（档案 RAG）
4) AI A3（受控创建）
5) Gateway S3（真 OPC-UA）按现场需要
```

---

**文档结束。** 请确认第 21 节选项（或直接回复「按推荐 R1 全部执行」），确认后可出详细实现计划并开工。
