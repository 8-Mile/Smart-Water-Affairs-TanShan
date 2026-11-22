"""AI 助手 API：鉴权用户后代理到 ai-service（透传 JWT 供 Tools / 确认写）。"""

import json
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.core.response import ok
from app.models.ai_audit import AiAuditLog
from app.models.user import User
from app.services.ai_client import ai_service_client
from app.services import tanggang_mock_ai

router = APIRouter(prefix="/ai", tags=["ai"])


class DemoContext(BaseModel):
    # Client-supplied SIM snapshot is illustrative; server never regards it
    # as a measured SCADA reading or as authorization to perform real work.
    data_mode: Literal["SIM"] = "SIM"
    field_verified: Literal[False] = False
    scenario_id: Literal["baseline", "peak", "storm", "pump-fault"]
    run_number: int = Field(ge=1, le=1000000)
    demand_m3h: float = Field(ge=0, le=1000000, allow_inf_nan=False)
    delivered_m3h: float = Field(ge=0, le=1000000, allow_inf_nan=False)
    shortage_m3h: float = Field(ge=0, le=1000000, allow_inf_nan=False)
    coverage_percent: float = Field(ge=0, le=100, allow_inf_nan=False)
    pool_forecast_m3: float = Field(ge=0, le=100000000, allow_inf_nan=False)
    monitor_risk: Literal["normal", "attention", "critical", "insufficient"]
    triggered_rules: list[str] = Field(default_factory=list, max_length=8)


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    session_id: str | None = Field(default=None, max_length=64)
    enable_tools: bool = True
    demo_context: DemoContext | None = None


class ActionBody(BaseModel):
    action_id: str = Field(..., min_length=8)


def _mock_mode() -> bool:
    # MOCK must be opt-in AND never available in production.
    settings = get_settings()
    return bool(settings.ai_mock_enabled and not settings.is_prod)


def _require_ai_enabled() -> None:
    settings = get_settings()
    if not settings.ai_enabled and not _mock_mode():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI 功能未启用（AI_ENABLED=false）",
        )


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return authorization.strip() or None


def _write_audit(
    db: Session,
    *,
    user: User,
    action_id: str,
    tool_name: str,
    title: str | None,
    status_val: str,
    payload: dict | None = None,
    result: dict | None = None,
    error: str | None = None,
    session_id: str | None = None,
) -> None:
    row = AiAuditLog(
        user_id=user.id,
        username=user.username,
        session_id=session_id,
        action_id=action_id,
        tool_name=tool_name,
        title=title,
        status=status_val,
        payload_json=json.dumps(payload, ensure_ascii=False, default=str) if payload else None,
        result_json=json.dumps(result, ensure_ascii=False, default=str) if result else None,
        error=(error or "")[:500] or None,
    )
    db.add(row)
    db.commit()


@router.get("/health")
def ai_health(current_user: CurrentUser):
    _require_ai_enabled()
    if _mock_mode():
        return ok({
            "enabled": True, "ok": True, "mock": True, "mode": "MOCK",
            "chat_model": tanggang_mock_ai.MODEL_NAME,
            "user": current_user.username,
            "data_mode": "SIM",
        })
    result = ai_service_client.health()
    return ok(
        {
            "enabled": True,
            "user": current_user.username,
            **result,
        }
    )


@router.post("/chat")
def ai_chat(
    body: ChatBody,
    current_user: CurrentUser,
    db: DbSession,
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    _require_ai_enabled()
    if _mock_mode():
        return ok(tanggang_mock_ai.chat(
            db, current_user, body.message, body.session_id,
            body.demo_context.model_dump() if body.demo_context else None,
        ))
    user_token = _bearer(authorization)
    try:
        data = ai_service_client.chat(
            body.message,
            session_id=body.session_id,
            user_id=str(current_user.id),
            username=current_user.username,
            user_token=user_token,
            enable_tools=body.enable_tools,
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        ) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"无法连接 AI 服务: {e}",
        ) from e
    return ok(data)


@router.post("/chat/stream")
def ai_chat_stream(
    body: ChatBody,
    current_user: CurrentUser,
    db: DbSession,
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    """SSE mode: MOCK events or real ai-service proxy (never mixed)."""
    _require_ai_enabled()
    if _mock_mode():
        # Calculate and commit while the request DB session is alive.
        record = tanggang_mock_ai.chat(
            db, current_user, body.message, body.session_id,
            body.demo_context.model_dump() if body.demo_context else None,
        )

        def mock_events():
            def line(event):
                return "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
            yield line({"type":"session","session_id":record["session_id"]})
            yield line({"type":"status","message":"MOCK业务规则分析"})
            for tool in record["tool_trace"]:
                yield line({"type":"tool","tool":tool})
            for action in record["pending_actions"]:
                yield line({"type":"pending","action":action})
            # SSE chunks exercise the real UI transport; no simulated model token generation.
            reply = record["reply"]
            for i in range(0, len(reply), 48):
                yield line({"type":"token","text":reply[i:i+48]})
            yield line({"type":"done", **record})
        return StreamingResponse(
            mock_events(),media_type="text/event-stream",
            headers={"Cache-Control":"no-cache","X-AI-Mode":"MOCK",
                     "X-Accel-Buffering":"no"},
        )
    user_token = _bearer(authorization)

    def gen():
        try:
            for line in ai_service_client.stream_chat(
                body.message,
                session_id=body.session_id,
                user_id=str(current_user.id),
                username=current_user.username,
                user_token=user_token,
                enable_tools=body.enable_tools,
            ):
                # 上游已是 SSE 行；补 data 前缀兼容
                if line.startswith("data:") or line.strip() == "":
                    yield line if line.endswith("\n") else line + "\n"
                else:
                    yield f"data: {line}\n" if not line.startswith("data") else line
        except Exception as exc:  # noqa: BLE001
            payload = json.dumps(
                {"type": "error", "message": str(exc)},
                ensure_ascii=False,
            )
            yield f"data: {payload}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/confirm")
def ai_confirm(
    body: ActionBody,
    db: DbSession,
    current_user: CurrentUser,
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    """确认执行 AI 挂起的写操作。"""
    _require_ai_enabled()
    if _mock_mode():
        return ok(tanggang_mock_ai.resolve(
            db, current_user, body.action_id, confirm=True,
        ), message="SIM演示操作已确认")
    user_token = _bearer(authorization)
    try:
        data = ai_service_client.confirm_action(
            body.action_id,
            user_id=str(current_user.id),
            user_token=user_token,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        ) from e

    action = data.get("action") or {}
    _write_audit(
        db,
        user=current_user,
        action_id=body.action_id,
        tool_name=str(data.get("tool") or action.get("tool") or "unknown"),
        title=data.get("title") or action.get("title"),
        status_val="confirmed",
        payload=action.get("payload"),
        result=data.get("result"),
        session_id=action.get("session_id"),
    )
    return ok(data, message="已确认并执行")


@router.post("/cancel")
def ai_cancel(
    body: ActionBody,
    db: DbSession,
    current_user: CurrentUser,
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    _require_ai_enabled()
    if _mock_mode():
        return ok(tanggang_mock_ai.resolve(
            db, current_user, body.action_id, confirm=False,
        ), message="SIM演示操作已取消")
    user_token = _bearer(authorization)
    try:
        data = ai_service_client.cancel_action(
            body.action_id,
            user_id=str(current_user.id),
            user_token=user_token,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        ) from e

    action = data.get("action") or {}
    _write_audit(
        db,
        user=current_user,
        action_id=body.action_id,
        tool_name=str(action.get("tool") or "unknown"),
        title=action.get("title"),
        status_val="cancelled",
        payload=action.get("payload"),
        session_id=action.get("session_id"),
    )
    return ok(data, message="已取消")


@router.get("/sessions")
def ai_sessions(current_user: CurrentUser, db: DbSession):
    _require_ai_enabled()
    if _mock_mode():
        return ok(tanggang_mock_ai.list_sessions(db, current_user))
    try:
        rows = ai_service_client.list_sessions(user_id=str(current_user.id))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        ) from e
    return ok(rows)


@router.get("/sessions/{session_id}")
def ai_session_detail(session_id: str, current_user: CurrentUser, db: DbSession):
    _require_ai_enabled()
    if _mock_mode():
        return ok(tanggang_mock_ai.get_session(db, current_user, session_id))
    try:
        data = ai_service_client.get_session(session_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        ) from e
    if data.get("user_id") and data.get("user_id") != str(current_user.id):
        if current_user.role_code not in ("super_admin", "admin"):
            raise HTTPException(status_code=403, detail="无权查看该会话")
    return ok(data)


@router.get("/audit-logs")
def ai_audit_logs(
    db: DbSession,
    current_user: CurrentUser,
    page: int = 1,
    page_size: int = 20,
):
    """管理员可查看全部；普通用户仅本人。"""
    _require_ai_enabled()
    q = db.query(AiAuditLog).order_by(AiAuditLog.id.desc())
    if current_user.role_code not in ("super_admin", "admin"):
        q = q.filter(AiAuditLog.user_id == current_user.id)
    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    items = [
        {
            "id": r.id,
            "user_id": r.user_id,
            "username": r.username,
            "action_id": r.action_id,
            "tool_name": r.tool_name,
            "title": r.title,
            "status": r.status,
            "payload_json": r.payload_json,
            "result_json": r.result_json,
            "error": r.error,
            "created_at": r.created_at,
        }
        for r in rows
    ]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})
