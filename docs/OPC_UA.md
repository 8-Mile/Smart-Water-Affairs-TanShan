# SCADA Gateway · OPC-UA 联调清单（阶段 9）

## 1. 模式说明

| `SOURCE_MODE` | 行为 |
|---------------|------|
| `mock`（默认） | 本地正弦/方波仿真 |
| `opcua` | 连接现场/仿真 OPC-UA Server，订阅 + 轮询 |

测点 `node_id` 为 OPC 节点 ID（如 `ns=1;i=700` 或 `ns=2;s=Temperature`）。

## 2. 依赖

```bash
cd scada-gateway
source .venv/bin/activate
pip install -r requirements.txt   # 含 asyncua
```

## 3. 配置（`scada-gateway/.env`）

```env
SOURCE_MODE=opcua
AUTO_START=true

OPCUA_ENDPOINT=opc.tcp://192.168.2.222:9433
OPCUA_SECURITY_POLICY=None
# anonymous | user
OPCUA_AUTH_MODE=anonymous
OPCUA_USERNAME=
OPCUA_PASSWORD=

# 若使用加密策略，填写证书路径
OPCUA_CERT_PATH=
OPCUA_KEY_PATH=

OPCUA_TIMEOUT_SEC=10
OPCUA_SUBSCRIPTION_PERIOD_MS=500
OPCUA_POLL_INTERVAL_SEC=2
OPCUA_RECONNECT_SEC=3
# 是否允许 inject 写回现场节点
OPCUA_ALLOW_WRITE=false

# 推主站（可选）
MAIN_APP_WEBHOOK_URL=http://127.0.0.1:8000/api/v1/internal/scada/samples
MAIN_APP_WEBHOOK_TOKEN=dev-scada-gateway-token-change-me
```

主站：

```env
SCADA_MODE=gateway
SCADA_AUTO_START=false
SCADA_GATEWAY_URL=http://127.0.0.1:8100
SCADA_GATEWAY_TOKEN=dev-scada-gateway-token-change-me
```

## 4. 测点准备

1. 在 Gateway `POST /api/v1/points` 或库表 `gw_points` 中维护测点。  
2. **`node_id` 必须与 OPC 地址空间一致**。  
3. `enabled=1` 才会订阅/轮询。  
4. 种子测点已带示例 `ns=1;i=...`，接现场时请改成真实 NodeId。

## 5. 启动与检查

```bash
# 1) OPC Server 可达（现场或 Prosys / open62541 仿真）
# 2) Gateway
cd scada-gateway && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8100

# 3) 状态
TOKEN=dev-scada-gateway-token-change-me
curl -s http://127.0.0.1:8100/api/v1/health -H "X-Gateway-Token: $TOKEN" | python3 -m json.tool
curl -s http://127.0.0.1:8100/api/v1/runtime/status -H "X-Gateway-Token: $TOKEN" | python3 -m json.tool
curl -s http://127.0.0.1:8100/api/v1/latest -H "X-Gateway-Token: $TOKEN" | python3 -m json.tool
```

健康/状态中应看到：

- `mode: opcua`
- `opcua.connected: true`（连上后）
- `opcua.subscribed_nodes` / `mapped_points` > 0
- `last_error` 为空

## 6. 联调检查表

- [ ] 网络互通：本机可 `telnet/nc` 到 `IP:端口`  
- [ ] Endpoint URL 正确（含 `opc.tcp://`）  
- [ ] 安全策略与现场一致（多数内网为 `None` + 匿名）  
- [ ] 用户名密码模式时 `OPCUA_AUTH_MODE=user`  
- [ ] NodeId 与 `gw_points.node_id` 一致  
- [ ] `SOURCE_MODE=opcua` 且 Gateway 已重启  
- [ ] latest 数值随现场变化  
- [ ] 断线后自动重连（拔网线再插回，`reconnect_count` 增加后恢复）  
- [ ] 主站 `SCADA_MODE=gateway` 时告警/监控有数据  
- [ ] inject：默认只改本地镜像；`OPCUA_ALLOW_WRITE=true` 才写回 PLC（慎用）

## 7. 常见问题

| 现象 | 处理 |
|------|------|
| `未安装 asyncua` | `pip install asyncua` |
| 一直 `connected: false` | 查 endpoint、防火墙、安全策略 |
| 订阅 0 节点 | 查 `enabled` 与 `node_id` 格式 |
| BadNodeIdUnknown | 现场地址空间与配置不一致，用 OPC 客户端浏览节点 |
| 有连接无变化 | 看 poll 是否更新；检查 Server 是否发布变化 |
| 安全策略失败 | 先试 `None`；加密需证书路径 |

## 8. 与 Mock 切换

```env
# 回仿真
SOURCE_MODE=mock
# 重启 Gateway
```

主站 `SCADA_MODE=mock` 可单进程开发；接现场时主站用 `gateway` + Gateway `opcua`。

## 9. 架构关系

```text
OPC-UA Server ──订阅/轮询──▶ scada-gateway (:8100)
                                │ 写 gw_* 库
                                │ Webhook
                                ▼
                         主业务系统 (:8000) 镜像 + 告警
```
