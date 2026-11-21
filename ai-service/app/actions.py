"""写操作挂起（pending_action）与简易审计。"""

from __future__ import annotations

import time
import uuid
from threading import Lock
from typing import Any


class ActionStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._pending: dict[str, dict[str, Any]] = {}
        self._audit: list[dict[str, Any]] = []

    def create_pending(
        self,
        *,
        tool: str,
        title: str,
        payload: dict[str, Any],
        summary: str,
        user_id: str | None,
        username: str | None,
        session_id: str | None,
        risk: str = "write",
    ) -> dict[str, Any]:
        action_id = str(uuid.uuid4())
        now = time.time()
        item = {
            "action_id": action_id,
            "tool": tool,
            "title": title,
            "payload": payload,
            "summary": summary,
            "user_id": user_id,
            "username": username,
            "session_id": session_id,
            "risk": risk,
            "status": "pending",
            "created_at": now,
            "expires_at": now + 30 * 60,  # 30 分钟
            "result": None,
            "error": None,
        }
        with self._lock:
            self._pending[action_id] = item
        return dict(item)

    def get(self, action_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._pending.get(action_id)
            return dict(item) if item else None

    def mark(
        self,
        action_id: str,
        *,
        status: str,
        result: Any = None,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        with self._lock:
            item = self._pending.get(action_id)
            if not item:
                return None
            item["status"] = status
            item["result"] = result
            item["error"] = error
            item["resolved_at"] = time.time()
            audit = {
                "id": str(uuid.uuid4()),
                "action_id": action_id,
                "tool": item.get("tool"),
                "title": item.get("title"),
                "user_id": item.get("user_id"),
                "username": item.get("username"),
                "session_id": item.get("session_id"),
                "payload": item.get("payload"),
                "status": status,
                "result": result,
                "error": error,
                "created_at": time.time(),
            }
            self._audit.append(audit)
            if len(self._audit) > 500:
                self._audit = self._audit[-500:]
            return dict(item)

    def list_audit(self, user_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = list(self._audit)
        if user_id is not None:
            rows = [r for r in rows if r.get("user_id") == user_id]
        rows.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return rows[:limit]


action_store = ActionStore()
