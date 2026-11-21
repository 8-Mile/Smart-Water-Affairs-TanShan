"""阶段 4：主站 AI 代理（mock ai-service）。"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.scada.simulator import scada_runtime


def _login(client: TestClient) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


def test_ai_health_and_chat_proxied():
    scada_runtime.stop()
    with (
        patch(
            "app.api.ai.ai_service_client.health",
            return_value={
                "ok": True,
                "data": {
                    "status": "up",
                    "ollama": {"ok": True, "chat_model": "qwen2.5:7b"},
                    "chat_model": "qwen2.5:7b",
                },
            },
        ),
        patch(
            "app.api.ai.ai_service_client.chat",
            return_value={
                "session_id": "sess-test-1",
                "reply": "你好，我是本地运维助手。",
                "model": "qwen2.5:7b",
                "tool_trace": [],
            },
        ) as m_chat,
    ):
        with TestClient(app) as client:
            scada_runtime.stop()
            h = _login(client)

            health = client.get("/api/v1/ai/health", headers=h)
            assert health.status_code == 200
            assert health.json()["data"]["ok"] is True

            chat = client.post(
                "/api/v1/ai/chat",
                headers=h,
                json={"message": "你好"},
            )
            assert chat.status_code == 200, chat.text
            data = chat.json()["data"]
            assert data["reply"]
            assert data["session_id"] == "sess-test-1"
            m_chat.assert_called_once()
            # 透传用户 id 与 token
            uid = m_chat.call_args.kwargs.get("user_id")
            assert uid is not None and str(uid).isdigit()
            assert m_chat.call_args.kwargs.get("user_token")


def test_ai_requires_auth():
    with TestClient(app) as client:
        r = client.get("/api/v1/ai/health")
        assert r.status_code == 401


def test_ai_confirm_proxied_and_audited():
    scada_runtime.stop()
    with (
        patch(
            "app.api.ai.ai_service_client.confirm_action",
            return_value={
                "ok": True,
                "tool": "create_repair_order",
                "title": "创建维修工单",
                "result": {"id": 1, "order_no": "RO-X"},
                "action": {
                    "tool": "create_repair_order",
                    "title": "创建维修工单",
                    "payload": {"equipment_id": 1, "description": "x"},
                    "session_id": "s1",
                },
            },
        ),
    ):
        with TestClient(app) as client:
            scada_runtime.stop()
            h = _login(client)
            r = client.post(
                "/api/v1/ai/confirm",
                headers=h,
                json={"action_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
            )
            assert r.status_code == 200, r.text
            assert r.json()["data"]["ok"] is True

            logs = client.get("/api/v1/ai/audit-logs", headers=h)
            assert logs.status_code == 200
            assert logs.json()["data"]["total"] >= 1
