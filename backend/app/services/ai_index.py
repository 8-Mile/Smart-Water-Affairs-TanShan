"""主站触发 ai-service 档案索引（异步尽力而为）。"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.core.config import get_settings

logger = logging.getLogger("app.ai_index")
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai-index")


def _headers() -> dict[str, str]:
    settings = get_settings()
    return {
        "X-AI-Token": settings.ai_service_token,
        "Content-Type": "application/json",
    }


def _url(path: str) -> str:
    settings = get_settings()
    base = settings.ai_service_url.rstrip("/")
    prefix = settings.ai_service_api_prefix.rstrip("/")
    if not path.startswith("/"):
        path = "/" + path
    return f"{base}{prefix}{path}"


def _index_sync(archive_id: int) -> None:
    settings = get_settings()
    if not settings.ai_enabled or not settings.ai_rag_index_on_upload:
        return
    try:
        with httpx.Client(timeout=180.0) as client:
            r = client.post(
                _url("/rag/index"),
                headers=_headers(),
                json={"archive_id": archive_id},
            )
            if r.status_code >= 400:
                logger.warning(
                    "RAG index failed id=%s status=%s body=%s",
                    archive_id,
                    r.status_code,
                    r.text[:200],
                )
            else:
                logger.info("RAG index ok id=%s", archive_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("RAG index error id=%s: %s", archive_id, exc)


def _delete_sync(archive_id: int) -> None:
    settings = get_settings()
    if not settings.ai_enabled:
        return
    try:
        with httpx.Client(timeout=30.0) as client:
            client.delete(_url(f"/rag/index/{archive_id}"), headers=_headers())
    except Exception as exc:  # noqa: BLE001
        logger.warning("RAG delete error id=%s: %s", archive_id, exc)


def trigger_index_async(archive_id: int) -> None:
    _pool.submit(_index_sync, archive_id)


def trigger_delete_async(archive_id: int) -> None:
    _pool.submit(_delete_sync, archive_id)
