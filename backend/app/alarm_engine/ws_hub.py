"""告警 WebSocket 广播中心（线程安全）。"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, Set

from fastapi import WebSocket
from starlette.websockets import WebSocketState


class AlarmWsHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: Set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        # 调用方可能已完成 accept（如先做首帧认证），避免重复 accept 报错
        if ws.application_state != WebSocketState.CONNECTED:
            await ws.accept()
        with self._lock:
            self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        with self._lock:
            self._clients.discard(ws)

    def broadcast_threadsafe(self, event: str, data: Any) -> None:
        """从同步线程（仿真/引擎）安全广播。"""
        payload = {"event": event, "data": data}
        loop = self._loop
        if loop is None or not loop.is_running():
            return
        asyncio.run_coroutine_threadsafe(self._broadcast(payload), loop)

    async def _broadcast(self, payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False, default=str)
        dead: list[WebSocket] = []
        with self._lock:
            clients = list(self._clients)
        for ws in clients:
            try:
                await ws.send_text(text)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


alarm_ws_hub = AlarmWsHub()
