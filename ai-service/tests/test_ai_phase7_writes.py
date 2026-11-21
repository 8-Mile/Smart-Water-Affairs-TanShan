"""阶段 7：写工具挂起 + 确认执行。"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.actions import action_store
from app.main import app
from app.tools.writes import queue_write_tool, execute_pending_action, cancel_pending_action

TOKEN = "dev-ai-service-token-change-me"
HEADERS = {"X-AI-Token": TOKEN, "X-User-Token": "user-jwt"}


def test_queue_write_does_not_call_api():
    r = queue_write_tool(
        "create_repair_order",
        {"equipment_id": 1, "description": "轴承异响"},
        user_context={"user_id": "1", "username": "admin", "session_id": "s1"},
    )
    assert r["ok"] is True
    assert r["pending"] is True
    assert r["action_id"]
    item = action_store.get(r["action_id"])
    assert item and item["status"] == "pending"


def test_confirm_executes_post():
    r = queue_write_tool(
        "create_repair_order",
        {"equipment_id": 2, "description": "密封泄漏"},
        user_context={"user_id": "9", "username": "op"},
    )
    aid = r["action_id"]
    with patch("app.tools.writes.MainAppClient") as MockClient:
        inst = MockClient.return_value
        inst.post.return_value = {"id": 10, "order_no": "RO-TEST-1"}
        out = execute_pending_action(aid, user_token="jwt", user_id="9")
        assert out["ok"] is True
        assert out["result"]["order_no"] == "RO-TEST-1"
        inst.post.assert_called_once()
        assert inst.post.call_args[0][0] == "/repairs"


def test_cancel_pending():
    r = queue_write_tool(
        "create_dispatch",
        {
            "content": "开启1#泵",
            "executor_id": 3,
            "expected_finish_time": "2026-07-16T18:00:00",
        },
        user_context={"user_id": "1"},
    )
    out = cancel_pending_action(r["action_id"], user_id="1")
    assert out["ok"] is True
    assert action_store.get(r["action_id"])["status"] == "cancelled"


def test_inject_disabled_by_default():
    r = queue_write_tool(
        "inject_scada_value",
        {"tag_name": "700", "value": 99},
        user_context={"user_id": "1"},
    )
    assert r["ok"] is False
    assert "禁用" in r["error"]


def test_chat_returns_pending_actions():
    call_n = {"n": 0}

    def fake_chat(messages, tools=None, temperature=None):
        call_n["n"] += 1
        if call_n["n"] == 1:
            return {
                "content": "",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "create_repair_order",
                                "arguments": {
                                    "equipment_id": 1,
                                    "description": "测试工单",
                                },
                            }
                        }
                    ],
                },
                "model": "qwen2.5:7b",
            }
        return {
            "content": "已生成待确认工单，请点击确认。",
            "message": {
                "role": "assistant",
                "content": "已生成待确认工单，请点击确认。",
            },
            "model": "qwen2.5:7b",
        }

    with (
        patch(
            "app.api.router.ollama_client.health",
            return_value={"ok": True, "models": ["qwen2.5:7b"]},
        ),
        patch("app.agent.orchestrator.ollama_client.chat", side_effect=fake_chat),
    ):
        with TestClient(app) as client:
            r = client.post(
                "/api/v1/chat",
                headers=HEADERS,
                json={
                    "message": "帮我建工单",
                    "user_id": "1",
                    "username": "admin",
                },
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["pending_actions"]
            assert data["pending_actions"][0]["tool"] == "create_repair_order"

            aid = data["pending_actions"][0]["action_id"]
            with patch("app.tools.writes.MainAppClient") as MockClient:
                MockClient.return_value.post.return_value = {
                    "id": 1,
                    "order_no": "RO-1",
                }
                conf = client.post(
                    "/api/v1/actions/confirm",
                    headers=HEADERS,
                    json={"action_id": aid, "user_id": "1"},
                )
                assert conf.status_code == 200, conf.text
                assert conf.json()["data"]["ok"] is True
