"""阶段 5：工具执行与编排（mock Ollama / 主站）。"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.tools.registry import execute_tool

TOKEN = "dev-ai-service-token-change-me"
HEADERS = {"X-AI-Token": TOKEN, "X-User-Token": "fake-user-jwt"}


def test_execute_tool_list_alarms():
    client = MagicMock()
    client.get.return_value = {
        "items": [{"id": 1, "rule_name": "温度过高", "alarm_status": "pending"}],
        "total": 1,
    }
    result = execute_tool(
        "list_alarms",
        {"realtime": True, "page_size": 5},
        client=client,
    )
    assert result["ok"] is True
    assert result["data"]["total"] == 1
    client.get.assert_called()
    path = client.get.call_args[0][0]
    assert path == "/alarms"


def test_chat_with_tool_round():
    """模拟模型先 tool_call 再给最终回答。"""
    call_count = {"n": 0}

    def fake_chat(messages, tools=None, temperature=None):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {
                "content": "",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "1",
                            "function": {
                                "name": "get_alarm_stats",
                                "arguments": {},
                            },
                        }
                    ],
                },
                "model": "qwen2.5:7b",
            }
        return {
            "content": "当前待处理告警 3 条。",
            "message": {"role": "assistant", "content": "当前待处理告警 3 条。"},
            "model": "qwen2.5:7b",
        }

    with (
        patch(
            "app.api.router.ollama_client.health",
            return_value={"ok": True, "models": ["qwen2.5:7b"]},
        ),
        patch("app.agent.orchestrator.ollama_client.chat", side_effect=fake_chat),
        patch(
            "app.agent.orchestrator.execute_tool",
            return_value={"ok": True, "tool": "get_alarm_stats", "data": {"pending": 3}},
        ),
    ):
        with TestClient(app) as client:
            r = client.post(
                "/api/v1/chat",
                headers=HEADERS,
                json={"message": "现在有多少告警？", "user_id": "1", "username": "admin"},
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert "告警" in data["reply"] or data["reply"]
            assert data["tool_trace"]
            assert data["tool_trace"][0]["name"] == "get_alarm_stats"
