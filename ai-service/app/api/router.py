from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.actions import action_store
from app.agent.orchestrator import iter_chat_events, run_chat_with_tools
from app.core.config import get_settings
from app.core.response import ok
from app.llm.ollama import ollama_client
from app.rag.indexer import delete_archive_index, index_archive, reindex_all, search_knowledge
from app.rag.store import get_store
from app.rate_limit import chat_limiter
from app.sessions import session_store
from app.tools.registry import get_tool_names
from app.tools.writes import cancel_pending_action, execute_pending_action

router = APIRouter()


def _check_token(x_ai_token: str | None) -> None:
    expected = get_settings().ai_service_token
    if not expected:
        return
    if not x_ai_token or x_ai_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 AI Service Token",
        )


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return authorization.strip() or None


def _rate_limit_user(user_id: str | None) -> None:
    settings = get_settings()
    # 热更新限流参数
    chat_limiter.max_calls = settings.ai_rate_limit_max
    chat_limiter.window_sec = settings.ai_rate_limit_window_sec
    key = user_id or "anonymous"
    if not chat_limiter.allow(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"对话过于频繁，请稍后再试（{settings.ai_rate_limit_max}次/{settings.ai_rate_limit_window_sec}秒）",
        )


def _prepare_chat_messages(body: "ChatRequest") -> tuple[str, list[dict[str, Any]]]:
    session_id = body.session_id
    if not session_id:
        created = session_store.create(user_id=body.user_id)
        session_id = created["id"]

    messages: list[dict[str, Any]] = []
    sess = session_store.get(session_id)
    if sess and sess.get("messages"):
        for m in sess["messages"][-20:]:
            if m.get("role") in ("user", "assistant") and m.get("content"):
                messages.append({"role": m["role"], "content": m["content"]})
    elif body.history:
        for m in body.history[-20:]:
            if m.get("role") in ("user", "assistant") and m.get("content"):
                messages.append({"role": m["role"], "content": m["content"]})

    messages.append({"role": "user", "content": body.message})
    session_store.append(session_id, "user", body.message, user_id=body.user_id)
    return session_id, messages


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    username: Optional[str] = None
    history: list[dict[str, str]] = Field(default_factory=list)
    enable_tools: bool = True


@router.get("/health")
def health(x_ai_token: str | None = Header(default=None, alias="X-AI-Token")):
    _check_token(x_ai_token)
    ollama = ollama_client.health()
    settings = get_settings()
    status_str = "up" if ollama.get("ok") else "degraded"
    return ok(
        {
            "status": status_str,
            "service": "ai-service",
            "version": "0.4.0",
            "ollama": ollama,
            "chat_model": settings.ollama_chat_model,
            "embed_model": settings.ollama_embed_model,
            "tools_enabled": settings.ai_tools_enabled,
            "tools": get_tool_names(),
            "main_app_url": settings.main_app_url,
            "writes": {
                "confirm_required": True,
                "scada_inject_allowed": settings.ai_allow_scada_inject,
            },
            "rag": {
                "enabled": settings.rag_enabled,
                **get_store().stats(),
            },
        }
    )


class IndexBody(BaseModel):
    archive_id: int = Field(..., ge=1)


class SearchBody(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(5, ge=1, le=20)
    category_code: str | None = None


@router.post("/rag/index")
def rag_index(
    body: IndexBody,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    """索引/重建单个档案（主站上传后调用）。"""
    _check_token(x_ai_token)
    if not get_settings().rag_enabled:
        raise HTTPException(status_code=503, detail="RAG 未启用")
    try:
        result = index_archive(body.archive_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ok(result, message="indexed")


@router.delete("/rag/index/{archive_id}")
def rag_delete(
    archive_id: int,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_token(x_ai_token)
    return ok(delete_archive_index(archive_id))


@router.post("/rag/reindex")
def rag_reindex(x_ai_token: str | None = Header(default=None, alias="X-AI-Token")):
    """全量重建索引（耗时，依赖 Ollama embedding）。"""
    _check_token(x_ai_token)
    if not get_settings().rag_enabled:
        raise HTTPException(status_code=503, detail="RAG 未启用")
    try:
        result = reindex_all()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ok(result, message="reindex done")


@router.post("/rag/search")
def rag_search(
    body: SearchBody,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_token(x_ai_token)
    try:
        result = search_knowledge(
            body.query,
            top_k=body.top_k,
            category_code=body.category_code,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ok(result)


@router.get("/sessions")
def list_sessions(
    user_id: str | None = None,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_token(x_ai_token)
    return ok(session_store.list_sessions(user_id=user_id))


@router.get("/sessions/{session_id}")
def get_session(
    session_id: str,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_token(x_ai_token)
    sess = session_store.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="会话不存在")
    return ok(
        {
            "id": sess["id"],
            "user_id": sess.get("user_id"),
            "messages": sess.get("messages") or [],
            "created_at": sess.get("created_at"),
            "updated_at": sess.get("updated_at"),
        }
    )


@router.post("/chat")
def chat(
    body: ChatRequest,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
):
    """
    对话。若携带用户 JWT，可调用主站 API 工具；写操作需确认。
    """
    _check_token(x_ai_token)
    _rate_limit_user(body.user_id)

    h = ollama_client.health()
    if not h.get("ok"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Ollama 不可用: {h.get('error', 'unknown')}",
        )

    session_id, messages = _prepare_chat_messages(body)
    user_token = x_user_token or _extract_bearer(authorization)
    if not body.enable_tools:
        user_token = None

    try:
        result = run_chat_with_tools(
            messages,
            user_token=user_token,
            user_context={
                "user_id": body.user_id,
                "username": body.username,
                "session_id": session_id,
            },
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    reply = (result.get("content") or "").strip() or "（模型未返回内容）"
    session_store.append(session_id, "assistant", reply, user_id=body.user_id)
    pending = result.get("pending_actions") or []

    return ok(
        {
            "session_id": session_id,
            "reply": reply,
            "model": result.get("model"),
            "message": {"role": "assistant", "content": reply},
            "tool_trace": result.get("tool_trace") or [],
            "pending_actions": pending,
            "rounds": result.get("rounds"),
            "tools_used": bool(result.get("tool_trace")),
        }
    )


@router.post("/chat/stream")
def chat_stream(
    body: ChatRequest,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
):
    """SSE 流式对话：status/tool/pending/token/done/error。"""
    _check_token(x_ai_token)
    _rate_limit_user(body.user_id)

    h = ollama_client.health()
    if not h.get("ok"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Ollama 不可用: {h.get('error', 'unknown')}",
        )

    session_id, messages = _prepare_chat_messages(body)
    user_token = x_user_token or _extract_bearer(authorization)
    if not body.enable_tools:
        user_token = None

    def event_gen():
        final_reply = ""
        try:
            yield _sse({"type": "session", "session_id": session_id})
            for ev in iter_chat_events(
                messages,
                user_token=user_token,
                user_context={
                    "user_id": body.user_id,
                    "username": body.username,
                    "session_id": session_id,
                },
                stream_final=True,
            ):
                if ev.get("type") == "done":
                    final_reply = (ev.get("content") or "").strip()
                    ev = {
                        **ev,
                        "session_id": session_id,
                        "reply": final_reply,
                        "tools_used": bool(ev.get("tool_trace")),
                    }
                yield _sse(ev)
                if ev.get("type") == "error":
                    return
            if final_reply:
                session_store.append(
                    session_id, "assistant", final_reply, user_id=body.user_id
                )
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


class ActionBody(BaseModel):
    action_id: str = Field(..., min_length=8)
    user_id: str | None = None


@router.post("/actions/confirm")
def confirm_action(
    body: ActionBody,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_token: str | None = Header(default=None, alias="X-User-Token"),
):
    """用户确认后执行挂起的写操作。"""
    _check_token(x_ai_token)
    user_token = x_user_token or _extract_bearer(authorization)
    if not user_token:
        raise HTTPException(status_code=401, detail="缺少用户 Token，无法执行写操作")
    result = execute_pending_action(
        body.action_id,
        user_token=user_token,
        user_id=body.user_id,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "执行失败")
    return ok(result, message="已确认并执行")


@router.post("/actions/cancel")
def cancel_action(
    body: ActionBody,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_token(x_ai_token)
    result = cancel_pending_action(body.action_id, user_id=body.user_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "取消失败")
    return ok(result, message="已取消")


@router.get("/actions/{action_id}")
def get_action(
    action_id: str,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_token(x_ai_token)
    item = action_store.get(action_id)
    if not item:
        raise HTTPException(status_code=404, detail="操作不存在")
    return ok(item)


@router.get("/audit")
def list_audit(
    user_id: str | None = None,
    limit: int = 50,
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_token(x_ai_token)
    return ok(action_store.list_audit(user_id=user_id, limit=limit))
