"""Ollama HTTP 客户端。"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from app.core.config import get_settings


class OllamaClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def base(self) -> str:
        return self.settings.ollama_base_url.rstrip("/")

    def health(self) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(f"{self.base}/api/tags")
                if r.status_code != 200:
                    return {
                        "ok": False,
                        "error": f"HTTP {r.status_code}",
                        "models": [],
                    }
                models = [m.get("name") for m in r.json().get("models", [])]
                chat = self.settings.ollama_chat_model
                has_chat = any(
                    (m or "").startswith(chat.split(":")[0]) or m == chat for m in models
                )
                return {
                    "ok": True,
                    "models": models,
                    "chat_model": chat,
                    "chat_model_present": has_chat or chat in models,
                    "embed_model": self.settings.ollama_embed_model,
                }
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc), "models": []}

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """
        调用 Ollama /api/chat（非流式）。
        messages 可含 tool / tool_calls 字段。
        """
        settings = self.settings
        payload: dict[str, Any] = {
            "model": model or settings.ollama_chat_model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": (
                    temperature if temperature is not None else settings.ai_temperature
                ),
            },
        }
        if tools:
            payload["tools"] = tools

        with httpx.Client(timeout=settings.ollama_timeout_sec) as client:
            r = client.post(f"{self.base}/api/chat", json=payload)
            if r.status_code != 200:
                raise RuntimeError(
                    f"Ollama chat 失败 HTTP {r.status_code}: {r.text[:400]}"
                )
            data = r.json()
            msg = data.get("message") or {}
            return {
                "content": msg.get("content") or "",
                "message": msg,
                "model": data.get("model") or payload["model"],
                "done": data.get("done", True),
                "raw": data,
            }


ollama_client = OllamaClient()
