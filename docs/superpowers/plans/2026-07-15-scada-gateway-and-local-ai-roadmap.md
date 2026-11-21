# SCADA Gateway + 本地 AI — 有序待办清单

> **依据：** `docs/superpowers/specs/2026-07-15-scada-gateway-and-local-ai-design.md`  
> **决策：** 全部按推荐（Gateway 权威+主站镜像、独立 ai-service、写操作确认后执行、模型先 7b）  
> **原则：** 严格按序号做；每一大阶段有验收门槛，过线再进下一阶段  

**状态图例：** `⬜` 未开始 · `🔄` 进行中 · `✅` 完成 · `⏸` 暂缓  

---

## 总览顺序（先看这张）

```text
阶段 1  SCADA Gateway 独立可跑、能存数
阶段 2  主站接入 Gateway（关内置仿真，告警不回归）
阶段 3  主站代理 runtime/inject，前端无感
阶段 4  AI 底座（Ollama + ai-service 闲聊/健康检查）
阶段 5  AI 只读问数（Tools）
阶段 6  AI 档案 RAG
阶段 7  AI 受控写入（确认卡片）
阶段 8  体验与硬化（流式、审计、文档）
阶段 9  （可选）真 OPC-UA 适配
```

**依赖关系：** 1→2→3 可连续；4 可在 2 完成后与 3 并行；5 依赖 4；6 依赖 4（不依赖 5 完成，但建议 5 后再做）；7 依赖 5；8 收尾；9 独立可最后做。

---

## 阶段 1 — SCADA Gateway 骨架（S0）

**目标：** 独立进程 Mock 采集 + 落库 + REST 可查。  
**验收：** `curl :8100/api/v1/latest` 有数据；主站尚未改造也可单独演示。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 1.1 | 新建目录 `scada-gateway/`（FastAPI 项目结构、requirements、`.env.example`） | `scada-gateway/` | ✅ |
| 1.2 | 配置：端口 8100、库 URL、Token、Mock 周期、保留天数 | `scada-gateway/app/core/config.py` | ✅ |
| 1.3 | 数据模型：`gw_points` / `gw_point_latest` / `gw_tag_data` + 建表 | `scada-gateway/app/store/` | ✅ |
| 1.4 | 种子测点（对齐现网 DEFAULT_SCADA_POINTS） | bootstrap | ✅ |
| 1.5 | `MockSource`：按 sim_* 正弦/方波生成 Sample | `sources/mock.py` | ✅ |
| 1.6 | `SamplePipeline`：写 latest + history | `store/writer.py` | ✅ |
| 1.7 | 后台 Runtime 线程 start/stop/status | `runtime.py` | ✅ |
| 1.8 | REST：`/health` `/points` `/latest` `/history` `/runtime/*` `/inject` | `api/` | ✅ |
| 1.9 | 服务 Token 校验（`X-Gateway-Token`） | middleware | ✅ |
| 1.10 | README：如何单独启动 Gateway | `scada-gateway/README.md` | ✅ |
| 1.11 | **验收：** 独立启动 1 分钟后 latest 刷新；inject 单点成功 | — | ✅ |

---

## 阶段 2 — 主站接入（S1）

**目标：** 主站关闭内置仿真；Gateway 数据进主站并触发告警。  
**验收：** 原有 pytest 告警/工单相关用例通过；注入越限仍可出告警。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 2.1 | 主站配置：`SCADA_GATEWAY_URL`、`SCADA_GATEWAY_TOKEN`、`SCADA_MODE=gateway`、`SCADA_AUTO_START=false` | `backend/.env.example` + config | ✅ |
| 2.2 | `scada_client.py`：拉 latest / 调 runtime / inject（HTTP） | `backend/app/services/scada_client.py` | ✅ |
| 2.3 | 内部 Ingest API：`POST /api/v1/internal/scada/samples`（Token 校验） | `api/` | ✅ |
| 2.4 | Ingest 写 `scada_point_latest` + `scada_tag_data`，并调用 `evaluate_alarms_for_tags` | service | ✅ |
| 2.5 | Gateway Webhook：每 tick（或批量）POST 到主站 Ingest | `scada-gateway/push/` | ✅ |
| 2.6 | 主站 `main.py` lifespan：**移除**内置 `scada_runtime.start()`（gateway 模式） | `main.py` | ✅ |
| 2.7 | 兼容开关：`SCADA_MODE=mock` 仍可走旧内置（过渡期，可选） | config 分支 | ✅ |
| 2.8 | 测点同步：Ingest 按 tag 自动映射/创建 | tag 映射 | ✅ |
| 2.9 | 更新 `docs/RUN.md` 启动顺序：Gateway → 主站 → 前端 | docs | ✅ |
| 2.10 | **验收：** 双进程运行；告警规则越限可触发；`pytest` 关键 | — | ✅ |

---

## 阶段 3 — 代理与前端无感（S2）

**目标：** UI 上 runtime/监控/inject 走 Gateway，用户无感知。  
**验收：** 前端 SCADA 页启停、监控、注入与改造前体验一致。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 3.1 | 主站 `/scada/runtime/*` 转发 Gateway | `api/scada.py` | ✅ |
| 3.2 | 主站 `/scada/inject` 转发 Gateway（Gateway 再 webhook 回主站或 inject 双写） | `api/scada.py` | ✅ |
| 3.3 | `/scada/latest` `/history`：读主站镜像（默认）或透传 Gateway | 配置项 | ✅ |
| 3.4 | 健康检查增加 gateway 连通性 | `api/health.py` | ✅ |
| 3.5 | **验收：** 前端测点配置/实时监控/注入联调通过 | — | ✅ |

---

## 阶段 4 — AI 底座（A0）

**目标：** 本地 Ollama + 独立 ai-service 能对话。  
**验收：** 前端或 curl 能收到模型回复；无 Ollama 时健康检查明确失败。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 4.1 | 安装/文档：Ollama + `qwen2.5:7b` + `nomic-embed-text` | `docs/AI_SETUP.md` | ✅ |
| 4.2 | 新建 `ai-service/` FastAPI 骨架（8200） | `ai-service/` | ✅ |
| 4.3 | Ollama 客户端封装（chat completions） | `ai-service/llm/ollama.py` | ✅ |
| 4.4 | `GET /health`：模型是否可用 | api | ✅ |
| 4.5 | 主站代理：`GET /api/v1/ai/health`、`POST /api/v1/ai/chat`（先非流式） | `backend/app/api/ai.py` | ✅ |
| 4.6 | 会话表（可选一期内存/SQLite）：session + messages | store | ✅ |
| 4.7 | 前端菜单「智能助手」+ 简易对话页 | `frontend/src/views/ai/` | ✅ |
| 4.8 | 权限 `ai:chat` + bootstrap 菜单 | bootstrap | ✅ |
| 4.9 | **验收：** 登录后闲聊中文正常；关掉 Ollama 有友好提示 | — | ✅ |

---

## 阶段 5 — AI 只读 Tools（A1）

**目标：** 自然语言查询系统实时/业务数据。  
**验收：** 固定问句抽检（告警数、工单待办、测点最新值）回答与 API 一致。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 5.1 | Tool 注册表 + JSON Schema | `ai-service/tools/` | ✅ |
| 5.2 | 实现只读 tools：dashboard / alarms / repairs / scada latest·history / equipment / dispatch / inspection / water·energy 摘要 | tools/*.py | ✅ |
| 5.3 | 业务 API 调用层：透传**用户 JWT**（主站转 ai-service 时带上） | client | ✅ |
| 5.4 | Orchestrator：模型 tool_call 循环（上限 N 轮）+ 结果再答 | agent.py | ✅ |
| 5.5 | 系统 Prompt：角色=运维助手；禁止编造数字；无数据如实说 | prompts | ✅ |
| 5.6 | 对话页展示「已查询 xxx」工具摘要（可选） | frontend | ✅ |
| 5.7 | **验收用例表**（写入测试或手工脚本） | docs 或 tests | ✅ |

**建议验收问句：**

1. 当前有多少条待处理告警？  
2. 有哪些待派单/维修中工单？  
3. 测点 700（或 PLC1.Flow）当前值是多少？  
4. 工作台待办摘要。  

---

## 阶段 6 — 档案 RAG（A2）

**目标：** 问制度/图纸类问题能引用档案库。  
**验收：** 上传一份制度 PDF 后，提问能答出要点并带档案名。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 6.1 | 档案文本提取（PDF/DOCX/TXT）；失败记日志 | `ai-service/rag/parse.py` | ✅ |
| 6.2 | 分块 + Ollama embedding | `rag/chunk.py` `embed.py` | ✅ |
| 6.3 | 向量库本地持久化（推荐 Chroma 目录） | `rag/store.py` | ✅ |
| 6.4 | 主站档案上传成功后异步触发索引（HTTP 调 ai-service 或队列） | backend hook | ✅ |
| 6.5 | 存量档案批量重建索引命令 | CLI | ✅ |
| 6.6 | Tool 或内置检索：`search_knowledge` topK 片段进 Prompt | agent | ✅ |
| 6.7 | 回答必须带来源字段；前端展示引用 | UI | ✅ |
| 6.8 | **验收：** 问档案内可见条文，答案可追溯 | — | ✅ |

---

## 阶段 7 — 受控写入（A3）

**目标：** 自然语言起草创建，用户确认后落库。  
**验收：** 未确认不写库；确认后工单出现在列表；审计可查。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 7.1 | 写 tools：`create_repair_order`、`create_dispatch`（先这两个） | tools | ✅ |
| 7.2 | 风险分级：read 自动执行 / write 挂起 | policy | ✅ |
| 7.3 | `pending_action` 存储 + `POST /ai/confirm` `/ai/cancel` | api | ✅ |
| 7.4 | 前端确认卡片（参数摘要 + 确认/取消） | Chat UI | ✅ |
| 7.5 | 确认时用**用户 JWT**调主站业务 API | client | ✅ |
| 7.6 | `ai_audit_log` 表：人、问题、tool、参数、结果 | backend 或 ai-service | ✅ |
| 7.7 | 高危默认关闭：`inject_scada_value` 需配置开关 | config | ✅ |
| 7.8 | **验收：** 说「帮我建工单」→ 卡片 → 确认 → 列表可见 | — | ✅ |

---

## 阶段 8 — 体验与硬化（A4）

**目标：** 值班可用、可运维。  
**验收：** RUN/AI 文档齐全；限流与失败提示明确。

| # | 待办 | 产出/位置 | 状态 |
|---|------|-----------|------|
| 8.1 | 对话 SSE 流式输出 | ai-service + 前端 | ✅ |
| 8.2 | 会话列表 / 历史消息 | UI + API | ✅ |
| 8.3 | 空态示例问题（一键填入） | UI | ✅ |
| 8.4 | 每用户限流、tool 轮次、超时 | middleware | ✅ |
| 8.5 | Gateway 历史保留任务（按天删） | gateway cron | ✅ |
| 8.6 | 更新 `USER_GUIDE` AI 章节 + `RUN.md` 多服务启动 | docs | ✅ |
| 8.7 | 可选：重新导出用户手册 PDF | docs | ✅ |
| 8.8 | **总验收：** 按 UAT 增补「Gateway + AI」检查项勾选 | `docs/UAT.md` | ✅ |

---

## 阶段 9 — 真 OPC-UA（S3，可后置）

**目标：** 配置切换即可接现场，不改业务代码。  
**验收：** `SOURCE_MODE=opcua` 时 latest 来自 PLC。

| # | 待办 | 状态 |
|---|------|------|
| 9.1 | `OpcUaSource`（asyncua）订阅 + 断线重连 | ✅ |
| 9.2 | 安全策略/匿名或用户名配置 | ✅ |
| 9.3 | 与 Mock 切换文档与现场联调清单 | ✅ |
| 9.4 | **验收：** 现场或仿真 OPC Server 读数稳定 | ✅ |

---

## 建议排期（参考人天，单人全职）

| 阶段 | 粗估 | 累计 |
|------|------|------|
| 1 Gateway S0 | 2–3 天 | 3 |
| 2 主站接入 S1 | 2–3 天 | 6 |
| 3 代理 S2 | 1 天 | 7 |
| 4 AI 底座 A0 | 1.5–2 天 | 9 |
| 5 只读 Tools A1 | 2–3 天 | 12 |
| 6 档案 RAG A2 | 2–3 天 | 15 |
| 7 受控写入 A3 | 2 天 | 17 |
| 8 硬化 A4 | 1–2 天 | 19 |
| 9 OPC（可选） | 2–4 天 | — |

机器装 Ollama、拉模型时间另计（视网速）。

---

## 每阶段开始前检查

- [ ] 上一阶段验收项已勾完  
- [ ] 相关配置已写入 `.env.example`  
- [ ] 不破坏现有 `pytest` 与前端 build（改主站时）  
- [ ] 提交信息按阶段拆分（如 `feat(scada-gateway): …` / `feat(ai): …`）

---

## 当前推荐的「下一步唯一动作」

**从 1.1 开始：创建 `scada-gateway/` 项目骨架并跑通 Mock 写库。**

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-15 | 初版：按设计推荐方案排出 1–9 阶段有序待办 |
