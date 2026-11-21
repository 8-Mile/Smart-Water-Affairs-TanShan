"""阶段 4：AI service 健康与鉴权（不依赖真实 Ollama 模型时可 mock）。"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

TOKEN = "dev-ai-service-token-change-me"
HEADERS = {"X-AI-Token": TOKEN}


def test_unauthorized():
    with TestClient(app) as client:
        r = client.get("/api/v1/health")
        assert r.status_code == 401


def test_health_with_mock_ollama():
    with patch(
        "app.api.router.ollama_client.health",
        return_value={
            "ok": True,
            "models": ["qwen2.5:7b"],
            "chat_model": "qwen2.5:7b",
            "chat_model_present": True,
        },
    ):
        with TestClient(app) as client:
            r = client.get("/api/v1/health", headers=HEADERS)
            assert r.status_code == 200
            body = r.json()
            assert body["code"] == 0
            assert body["data"]["status"] == "up"
            assert body["data"]["ollama"]["ok"] is True


def test_chat_with_mock_ollama():
    with (
        patch(
            "app.api.router.ollama_client.health",
            return_value={"ok": True, "models": ["qwen2.5:7b"]},
        ),
        patch(
            "app.api.router.ollama_client.chat",
            return_value={
                "content": "你好，我是运维助手。",
                "model": "qwen2.5:7b",
                "done": True,
            },
        ),
    ):
        with TestClient(app) as client:
            r = client.post(
                "/api/v1/chat",
                headers=HEADERS,
                json={"message": "你好", "user_id": "1"},
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["reply"]
            assert data["session_id"]
            sid = data["session_id"]

            sess = client.get(f"/api/v1/sessions/{sid}", headers=HEADERS)
            assert sess.status_code == 200
            msgs = sess.json()["data"]["messages"]
            assert len(msgs) >= 2
