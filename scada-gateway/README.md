# SCADA Gateway（阶段 1）

独立的 SCADA **Mock / 未来 OPC-UA** 中转服务：采集、落库（最新值 + 历史）、REST 查询。

- **端口：** 8100  
- **版本：** 0.1.0  
- **阶段 1：** `mock` 数据源 + 落库 + REST  
- **阶段 2：** Webhook 推主站 `/api/v1/internal/scada/samples`，主站镜像 + 告警  
- **阶段 9：** `opcua` 真机（asyncua 订阅 + 轮询 + 断线重连）  

设计见：`docs/superpowers/specs/2026-07-15-scada-gateway-and-local-ai-design.md`  
OPC 联调：`docs/OPC_UA.md`

---

## 快速启动

```bash
cd scada-gateway
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
```

- 文档：http://127.0.0.1:8100/docs  
- 健康检查需带 Token：

```bash
export TOKEN=dev-scada-gateway-token-change-me

curl -s http://127.0.0.1:8100/api/v1/health \
  -H "X-Gateway-Token: $TOKEN" | python3 -m json.tool

curl -s http://127.0.0.1:8100/api/v1/latest \
  -H "X-Gateway-Token: $TOKEN" | python3 -m json.tool

# 注入测点
curl -s -X POST http://127.0.0.1:8100/api/v1/inject \
  -H "X-Gateway-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tag_name":"700","value":95}'
```

---

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 服务与 runtime 状态 |
| GET | `/api/v1/points` | 测点列表 |
| POST/PUT/DELETE | `/api/v1/points` | 测点维护 |
| GET | `/api/v1/latest` | 最新值 |
| GET | `/api/v1/history?tag_name=` | 历史时序 |
| POST | `/api/v1/runtime/start\|stop` | 启停采集 |
| GET | `/api/v1/runtime/status` | 运行状态 |
| POST | `/api/v1/inject` | 手动写值 |

所有业务接口需请求头：`X-Gateway-Token: <GATEWAY_TOKEN>`

---

## 数据

| 表 | 说明 |
|----|------|
| `gw_points` | 测点注册（含仿真参数） |
| `gw_point_latest` | 最新值 |
| `gw_tag_data` | 历史 |

默认 SQLite 文件：`scada_gateway/scada_hub.db`（相对工作目录）。

首次启动自动种子 8 个测点（PLC1.Flow、700 温度等，与主站一致）。

---

## 测试

```bash
cd scada-gateway
source .venv/bin/activate
pytest -q
```

---

## 与主业务联调（阶段 2）

1. 主站 `.env`：`SCADA_MODE=gateway`，`SCADA_AUTO_START=false`，Token 与 Gateway 一致。  
2. Gateway `.env`：

```env
MAIN_APP_WEBHOOK_URL=http://127.0.0.1:8000/api/v1/internal/scada/samples
MAIN_APP_WEBHOOK_TOKEN=dev-scada-gateway-token-change-me
```

3. **先起主站 :8000，再起 Gateway :8100**（或反之；Webhook 失败会打日志，主站恢复后下一 tick 会再推）。  
4. 主站健康检查 `GET /api/v1/health` 在 gateway 模式下会探测 Gateway 连通性。  
5. 采样按 **tag_name** 映射主站测点（Gateway 的 point_id 不直接使用）。

不配 `MAIN_APP_WEBHOOK_URL` 时 Gateway 仍可独立运行，只是不推主站。

## OPC-UA 模式（阶段 9）

```env
SOURCE_MODE=opcua
OPCUA_ENDPOINT=opc.tcp://192.168.2.222:9433
OPCUA_SECURITY_POLICY=None
OPCUA_AUTH_MODE=anonymous
```

```bash
pip install asyncua   # 或 pip install -r requirements.txt
# 确保 gw_points.node_id 为真实 OPC NodeId
uvicorn app.main:app --port 8100
```

详见 **[docs/OPC_UA.md](../docs/OPC_UA.md)**。
