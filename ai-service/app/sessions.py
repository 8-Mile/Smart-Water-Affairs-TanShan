"""简易内存会话（阶段 4）；进程重启清空。"""

from __future__ import annotations

import time
import uuid
from threading import Lock
from typing import Any


class SessionStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._sessions: dict[str, dict[str, Any]] = {}

    def create(self, user_id: str | None = None) -> dict[str, Any]:
        sid = str(uuid.uuid4())
        now = time.time()
        item = {
            "id": sid,
            "user_id": user_id,
            "created_at": now,
            "updated_at": now,
            "messages": [],  # {role, content, ts}
        }
        with self._lock:
            self._sessions[sid] = item
        return {"id": sid, "created_at": now}

    def get(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._sessions.get(session_id)

    def list_sessions(self, user_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = list(self._sessions.values())
        if user_id is not None:
            rows = [r for r in rows if r.get("user_id") == user_id]
        rows.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
        out = []
        for r in rows[:limit]:
            msgs = r.get("messages") or []
            preview = ""
            for m in msgs:
                if m.get("role") == "user":
                    preview = (m.get("content") or "")[:80]
                    break
            out.append(
                {
                    "id": r["id"],
                    "user_id": r.get("user_id"),
                    "created_at": r.get("created_at"),
                    "updated_at": r.get("updated_at"),
                    "message_count": len(msgs),
                    "preview": preview,
                }
            )
        return out

    def append(
        self,
        session_id: str,
        role: str,
        content: str,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            sess = self._sessions.get(session_id)
            if not sess:
                sess = {
                    "id": session_id,
                    "user_id": user_id,
                    "created_at": time.time(),
                    "updated_at": time.time(),
                    "messages": [],
                }
                self._sessions[session_id] = sess
            sess["messages"].append(
                {"role": role, "content": content, "ts": time.time()}
            )
            sess["updated_at"] = time.time()
            if user_id and not sess.get("user_id"):
                sess["user_id"] = user_id
            return sess


session_store = SessionStore()
