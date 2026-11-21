# 本地 AI 安装与启动（阶段 4）

## 1. 安装 Ollama

- macOS：https://ollama.com/download  
- 或：`brew install ollama`

启动服务（若未自动启动）：

```bash
ollama serve
```

## 2. 拉取模型

```bash
ollama pull qwen2.5:7b
# 阶段 6 档案向量（RAG 必需）：
ollama pull nomic-embed-text
```

内存紧张可改用更小模型，并在 `ai-service/.env` 设置：

```env
OLLAMA_CHAT_MODEL=qwen2.5:3b
```

## 3. 启动 AI 服务

```bash
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8200
```

检查：

```bash
curl -s http://127.0.0.1:8200/api/v1/health \
  -H "X-AI-Token: dev-ai-service-token-change-me"
```

## 4. 主站配置

`backend/.env`：

```env
AI_ENABLED=true
AI_SERVICE_URL=http://127.0.0.1:8200
AI_SERVICE_TOKEN=dev-ai-service-token-change-me
```

重启主站后，浏览器登录 → 菜单 **智能助手 → 对话**。

## 5. 推荐启动顺序

```text
Ollama → ai-service:8200 → 主站:8000 → 前端:5173
（可选）scada-gateway:8100
```

## 6. 阶段能力

| 阶段 | 能力 |
|------|------|
| 4 | 本地模型闲聊、健康检查、会话记忆（内存） |
| 5 | 自然语言查告警/工单/测点等（Tools，透传用户 JWT） |
| 6 | 档案 RAG：上传自动索引 + 问答引用档案名 |
| 7 | 受控写入：建工单/调度挂起 → 界面确认后落库 + 审计 |
| **8（当前）** | 流式对话、会话侧栏、限流、Gateway 历史保留、文档/UAT |

### 阶段 5 推荐问句

1. 当前有多少条待处理告警？  
2. 有哪些待派单/维修中工单？  
3. 测点 700（或 PLC1.Flow）当前值是多少？  
4. 工作台待办摘要。  

### 阶段 6 档案 RAG

**依赖：** `ollama pull nomic-embed-text`，主站与 ai-service 同时运行。

1. 管理员在 **档案管理** 上传一份 **txt/pdf/docx**（建议管理制度类，正文可检索）。  
2. 上传后主站会异步通知 ai-service 建索引（需 ai-service 已启动）。  
3. 全量重建（可选）：

```bash
cd ai-service && source .venv/bin/activate
python scripts/reindex_archives.py
# 或
curl -X POST http://127.0.0.1:8200/api/v1/rag/reindex \
  -H "X-AI-Token: dev-ai-service-token-change-me"
```

4. 在智能助手提问，例如：  
   - 「档案里轴承温度巡检有什么规定？」  
   - 「有哪些管理制度类文档？」  

回答应引用 **档案名称**；扫描件/CAD 仅能按文件名与说明检索。

### 阶段 7 受控写入

1. 对话中说：「帮我创建一条维修工单…」（可先让 AI 查设备列表拿到 `equipment_id`）。  
2. 助手返回 **待确认卡片**（不会立刻写库）。  
3. 点 **确认执行** → 用当前登录用户权限调用业务 API。  
4. 点 **取消** → 不写库。  
5. 管理员可在 `GET /api/v1/ai/audit-logs` 查看确认/取消记录。  

支持工具：`create_repair_order`、`create_dispatch`；`inject_scada_value` 默认关闭（`AI_ALLOW_SCADA_INJECT=false`）。

### 阶段 8 体验

- **流式：** 对话逐步输出，工具执行时显示「正在查询…」  
- **会话侧栏：** 切换历史会话（内存会话，重启 ai-service 会清空）  
- **限流：** 默认每用户 20 次/分钟（`AI_RATE_LIMIT_*`）  
- Gateway 历史：`RETENTION_DAYS` 自动清理过期 `gw_tag_data`

**注意：** Tools / RAG / 确认写入均需 **主站 :8000 与 ai-service :8200 同时运行**，且登录 JWT 有效。

## 7. 常见问题

| 现象 | 处理 |
|------|------|
| 健康检查 failed / connection refused | 先 `ollama serve`，再起 ai-service |
| 模型不存在 | `ollama pull qwen2.5:7b` |
| 回复很慢 | 换更小模型或使用 GPU；增大 `AI_TIMEOUT_SEC` |
| 菜单没有智能助手 | 重启主站触发 bootstrap；管理员账号重新登录 |
