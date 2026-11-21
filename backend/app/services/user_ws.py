"""站内消息 WebSocket 定向推送中心（按用户ID，线程安全）。"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, Set

from fastapi import WebSocket
from starlette.websockets import WebSocketState


class UserWsHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: dict[int, Set[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        # 调用方可能已完成 accept（如先做首帧认证），避免重复 accept 报错
        if ws.application_state != WebSocketState.CONNECTED:
            await ws.accept()
        with self._lock:
            self._clients.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: int, ws: WebSocket) -> None:
        with self._lock:
            conns = self._clients.get(user_id)
            if not conns:
                return
            conns.discard(ws)
            if not conns:
                self._clients.pop(user_id, None)

    def send_to_user_threadsafe(self, user_id: int, event: str, data: Any) -> None:
        """从同步业务线程安全推送给指定用户的所有连接。"""
        loop = self._loop
        if loop is None or not loop.is_running():
            return
        asyncio.run_coroutine_threadsafe(
            self._send(user_id, {"event": event, "data": data}), loop
        )

    async def _send(self, user_id: int, payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False, default=str)
        dead: list[WebSocket] = []
        with self._lock:
            conns = list(self._clients.get(user_id, set()))
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)


user_ws_hub = UserWsHub()
