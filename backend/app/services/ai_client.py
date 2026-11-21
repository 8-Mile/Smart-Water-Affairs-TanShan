"""主站调用 ai-service 的客户端。"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Optional

import httpx

from app.core.config import get_settings


class AiServiceClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def enabled(self) -> bool:
        return bool(self.settings.ai_enabled and self.settings.ai_service_url)

    def _headers(self, user_token: Optional[str] = None) -> dict[str, str]:
        h = {
            "X-AI-Token": self.settings.ai_service_token,
            "Content-Type": "application/json",
        }
        if user_token:
            # 透传用户 JWT，供 Tools 调业务 API
            h["Authorization"] = (
                user_token
                if user_token.lower().startswith("bearer ")
                else f"Bearer {user_token}"
            )
            h["X-User-Token"] = user_token.replace("Bearer ", "").replace("bearer ", "")
        return h

    def _url(self, path: str) -> str:
        base = self.settings.ai_service_url.rstrip("/")
        prefix = self.settings.ai_service_api_prefix.rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        return f"{base}{prefix}{path}"

    def health(self) -> dict[str, Any]:
        if not self.settings.ai_service_url:
            return {"ok": False, "error": "AI_SERVICE_URL 未配置"}
        try:
            with httpx.Client(timeout=8.0) as client:
                r = client.get(self._url("/health"), headers=self._headers())
                if r.status_code != 200:
                    return {
                        "ok": False,
                        "error": f"HTTP {r.status_code}",
                        "body": r.text[:300],
                    }
                data = r.json().get("data") or {}
                return {"ok": True, "data": data}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}

    def chat(
        self,
        message: str,
        *,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        username: Optional[str] = None,
        user_token: Optional[str] = None,
        enable_tools: bool = True,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "message": message,
            "enable_tools": enable_tools,
        }
        if session_id:
            payload["session_id"] = session_id
        if user_id:
            payload["user_id"] = user_id
        if username:
            payload["username"] = username
        timeout = self.settings.ai_timeout_sec
        with httpx.Client(timeout=timeout) as client:
            r = client.post(
                self._url("/chat"),
                headers=self._headers(user_token=user_token),
                json=payload,
            )
            if r.status_code >= 400:
                detail = r.text
                try:
                    detail = r.json().get("detail") or r.json().get("message") or detail
                except Exception:  # noqa: BLE001
                    pass
                raise RuntimeError(f"AI 服务错误 ({r.status_code}): {detail}")
            body = r.json()
            if body.get("code", 0) != 0:
                raise RuntimeError(body.get("message") or "AI 服务返回失败")
            return body.get("data") or {}

    def stream_chat(
        self,
        message: str,
        *,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        username: Optional[str] = None,
        user_token: Optional[str] = None,
        enable_tools: bool = True,
    ) -> Iterator[str]:
        """透传 SSE 行（含 data: ... 与空行）。"""
        payload: dict[str, Any] = {
            "message": message,
            "enable_tools": enable_tools,
        }
        if session_id:
            payload["session_id"] = session_id
        if user_id:
            payload["user_id"] = user_id
        if username:
            payload["username"] = username
        timeout = self.settings.ai_timeout_sec
        with httpx.Client(timeout=timeout) as client:
            with client.stream(
                "POST",
                self._url("/chat/stream"),
                headers=self._headers(user_token=user_token),
                json=payload,
            ) as r:
                if r.status_code >= 400:
                    body = r.read().decode("utf-8", errors="ignore")
                    raise RuntimeError(f"AI 流式错误 ({r.status_code}): {body[:300]}")
                for line in r.iter_lines():
                    if line is None:
                        continue
                    # httpx 可能返回 str
                    text = line if isinstance(line, str) else line.decode("utf-8", errors="ignore")
                    yield text + "\n"

    def list_sessions(self, user_id: Optional[str] = None) -> list[dict[str, Any]]:
        params = {}
        if user_id:
            params["user_id"] = user_id
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                self._url("/sessions"),
                headers=self._headers(),
                params=params or None,
            )
            r.raise_for_status()
            return r.json().get("data") or []

    def get_session(self, session_id: str) -> dict[str, Any]:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                self._url(f"/sessions/{session_id}"),
                headers=self._headers(),
            )
            r.raise_for_status()
            return r.json().get("data") or {}

    def confirm_action(
        self,
        action_id: str,
        *,
        user_id: Optional[str] = None,
        user_token: Optional[str] = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"action_id": action_id}
        if user_id:
            payload["user_id"] = user_id
        with httpx.Client(timeout=self.settings.ai_timeout_sec) as client:
            r = client.post(
                self._url("/actions/confirm"),
                headers=self._headers(user_token=user_token),
                json=payload,
            )
            if r.status_code >= 400:
                detail = r.text
                try:
                    detail = r.json().get("detail") or detail
                except Exception:  # noqa: BLE001
                    pass
                raise RuntimeError(str(detail))
            body = r.json()
            if body.get("code", 0) != 0:
                raise RuntimeError(body.get("message") or "确认失败")
            return body.get("data") or {}

    def cancel_action(
        self,
        action_id: str,
        *,
        user_id: Optional[str] = None,
        user_token: Optional[str] = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"action_id": action_id}
        if user_id:
            payload["user_id"] = user_id
        with httpx.Client(timeout=30.0) as client:
            r = client.post(
                self._url("/actions/cancel"),
                headers=self._headers(user_token=user_token),
                json=payload,
            )
            if r.status_code >= 400:
                detail = r.text
                try:
                    detail = r.json().get("detail") or detail
                except Exception:  # noqa: BLE001
                    pass
                raise RuntimeError(str(detail))
            body = r.json()
            if body.get("code", 0) != 0:
                raise RuntimeError(body.get("message") or "取消失败")
            return body.get("data") or {}


ai_service_client = AiServiceClient()
