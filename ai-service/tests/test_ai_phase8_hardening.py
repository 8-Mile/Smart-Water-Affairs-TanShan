"""阶段 8：限流与流式接口。"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.rate_limit import chat_limiter

TOKEN = "dev-ai-service-token-change-me"
HEADERS = {"X-AI-Token": TOKEN}


def test_rate_limit_blocks():
    with (
        patch(
            "app.api.router.chat_limiter.allow",
            side_effect=[True, True, False],
        ),
        patch(
            "app.api.router.ollama_client.health",
            return_value={"ok": True, "models": ["qwen2.5:7b"]},
        ),
        patch(
            "app.api.router.run_chat_with_tools",
            return_value={
                "content": "ok",
                "model": "m",
                "tool_trace": [],
                "pending_actions": [],
                "rounds": 1,
            },
        ),
    ):
        with TestClient(app) as client:
            for _ in range(2):
                r = client.post(
                    "/api/v1/chat",
                    headers=HEADERS,
                    json={"message": "hi", "user_id": "rate-user"},
                )
                assert r.status_code == 200
            r3 = client.post(
                "/api/v1/chat",
                headers=HEADERS,
                json={"message": "hi again", "user_id": "rate-user"},
            )
            assert r3.status_code == 429


def test_stream_endpoint_emits_done():
    def fake_iter(*_a, **_k):
        yield {"type": "status", "message": "thinking"}
        yield {"type": "token", "text": "你好"}
        yield {
            "type": "done",
            "content": "你好",
            "model": "m",
            "tool_trace": [],
            "pending_actions": [],
            "rounds": 1,
        }

    with (
        patch(
            "app.api.router.ollama_client.health",
            return_value={"ok": True, "models": ["qwen2.5:7b"]},
        ),
        patch("app.api.router.iter_chat_events", side_effect=fake_iter),
    ):
        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/api/v1/chat/stream",
                headers=HEADERS,
                json={"message": "hi", "user_id": "u2"},
            ) as res:
                assert res.status_code == 200
                text = "".join(res.iter_text())
                assert "data:" in text
                assert "done" in text
