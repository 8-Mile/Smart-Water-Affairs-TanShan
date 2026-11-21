"""WebSocket 实时通道。

鉴权方式：连接建立后由客户端发送**首帧**认证消息（token 不再放在 URL 查询串，
避免落到浏览器历史、代理与访问日志）：
    {"type": "auth", "token": "<JWT>"}
认证失败或超时统一以 4401 关闭。
"""

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.alarm_engine.ws_hub import alarm_ws_hub
from app.core.database import SessionLocal
from app.core.security import TokenError, get_payload
from app.models.user import User
from app.services.user_ws import user_ws_hub

router = APIRouter(tags=["websocket"])

# 首帧认证等待上限（秒）
AUTH_TIMEOUT_SEC = 10.0


async def _auth_ws_user(websocket: WebSocket) -> User | None:
    """读取首帧 auth 消息并校验 JWT（含令牌版本，禁用/改密后旧令牌立即失效）。

    认证在 accept 之后进行（Starlette 要求先 accept 才能收消息）；token 不出现在 URL。
    """
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        await websocket.close(code=4401)
        return None
    except WebSocketDisconnect:
        return None
    try:
        token = str(json.loads(raw).get("token") or "")
    except (json.JSONDecodeError, AttributeError, TypeError):
        await websocket.close(code=4401)
        return None
    if not token:
        await websocket.close(code=4401)
        return None
    try:
        payload = get_payload(token)
    except TokenError:
        await websocket.close(code=4401)
        return None
    username = str(payload.get("sub") or "")
    if not username:
        await websocket.close(code=4401)
        return None
    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(User.username == username, User.deleted == 0, User.status == 1)
            .first()
        )
    finally:
        db.close()
    if not user or int(payload.get("tv", 0)) != int(user.token_version or 0):
        await websocket.close(code=4401)
        return None
    return user


@router.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    await websocket.accept()
    user = await _auth_ws_user(websocket)
    if not user:
        return
    await user_ws_hub.connect(user.id, websocket)
    try:
        await websocket.send_json({"event": "connected", "data": {"user_id": user.id}})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        user_ws_hub.disconnect(user.id, websocket)
    except Exception:  # noqa: BLE001
        user_ws_hub.disconnect(user.id, websocket)


@router.websocket("/ws/alarms")
async def ws_alarms(websocket: WebSocket):
    await websocket.accept()
    user = await _auth_ws_user(websocket)
    if not user:
        return

    await alarm_ws_hub.connect(websocket)
    try:
        await websocket.send_json({"event": "connected", "data": {"username": user.username}})
        while True:
            # 保持连接；客户端可发 ping
            await websocket.receive_text()
    except WebSocketDisconnect:
        alarm_ws_hub.disconnect(websocket)
    except Exception:  # noqa: BLE001
        alarm_ws_hub.disconnect(websocket)
