# AI Service（阶段 4）

本地智能助手服务：对接 **Ollama**，提供健康检查与非流式对话。

- 端口：**8200**
- 设计：`docs/superpowers/specs/2026-07-15-scada-gateway-and-local-ai-design.md`

## 依赖

1. 安装 [Ollama](https://ollama.com)
2. 拉取模型：

```bash
ollama pull qwen2.5:7b
# 阶段 6 RAG 再用：
# ollama pull nomic-embed-text
```

3. 确认 Ollama 运行：`curl http://127.0.0.1:11434/api/tags`

## 启动

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8200
```

- 文档：http://127.0.0.1:8200/docs  
- 请求头：`X-AI-Token: dev-ai-service-token-change-me`

```bash
TOKEN=dev-ai-service-token-change-me
curl -s http://127.0.0.1:8200/api/v1/health -H "X-AI-Token: $TOKEN"
curl -s -X POST http://127.0.0.1:8200/api/v1/chat \
  -H "X-AI-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"你好，介绍一下你自己"}'
```

## 测试

```bash
pytest -q
```

（用例 mock Ollama，无需本机已拉模型。）

## 与主站

主站 `AI_ENABLED=true` 时，前端走 `POST /api/v1/ai/chat`，由主站代理到本服务并**透传用户 JWT**。

阶段 5 Tools 会用该 JWT 调用主站只读 API（告警/工单/SCADA 等），因此：

1. 先启动主站 `:8000`  
2. 再启动本服务 `:8200`（`MAIN_APP_URL=http://127.0.0.1:8000`）  
3. 前端登录后使用智能助手

健康检查返回 `tools` 列表表示已加载工具。

## 档案 RAG（阶段 6）

```bash
ollama pull nomic-embed-text
pip install -r requirements.txt   # 含 pypdf、python-docx
```

- 主站上传档案后自动 `POST /api/v1/rag/index`  
- 全量：`python scripts/reindex_archives.py`  
- 索引文件：`data/rag_index.jsonl`  
- 对话工具：`search_knowledge` / `list_archives`

## 受控写入（阶段 7）

写工具只生成 **pending_action**，用户确认后才调用主站：

| 接口 | 说明 |
|------|------|
| `POST /api/v1/actions/confirm` | 执行（需用户 JWT） |
| `POST /api/v1/actions/cancel` | 取消 |
| `GET /api/v1/audit` | 简易审计列表 |

主站代理：`POST /api/v1/ai/confirm`、`/ai/cancel`，并写入 `ai_audit_log`。
