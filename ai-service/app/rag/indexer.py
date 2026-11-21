"""从主站拉取档案并写入向量索引。"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings
from app.rag.chunk import chunk_text
from app.rag.embed import embed_texts
from app.rag.parse import extract_text
from app.rag.store import get_store

logger = logging.getLogger("ai-service.rag")


def _main_headers() -> dict[str, str]:
    settings = get_settings()
    return {
        "X-AI-Token": settings.ai_service_token,
        "X-Internal-Token": settings.main_app_internal_token
        or settings.ai_service_token,
    }


def _main_url(path: str) -> str:
    settings = get_settings()
    base = settings.main_app_url.rstrip("/")
    prefix = settings.main_app_api_prefix.rstrip("/")
    if not path.startswith("/"):
        path = "/" + path
    return f"{base}{prefix}{path}"


def fetch_archive_meta(archive_id: int) -> dict[str, Any]:
    with httpx.Client(timeout=30.0) as client:
        r = client.get(
            _main_url(f"/internal/archives/{archive_id}"),
            headers=_main_headers(),
        )
        if r.status_code == 404:
            raise FileNotFoundError(f"档案 {archive_id} 不存在")
        if r.status_code >= 400:
            raise RuntimeError(f"拉取档案元数据失败 {r.status_code}: {r.text[:200]}")
        body = r.json()
        return body.get("data") or body


def download_archive_file(archive_id: int, dest: Path) -> None:
    with httpx.Client(timeout=120.0) as client:
        r = client.get(
            _main_url(f"/internal/archives/{archive_id}/file"),
            headers=_main_headers(),
        )
        if r.status_code >= 400:
            raise RuntimeError(f"下载档案失败 {r.status_code}: {r.text[:200]}")
        dest.write_bytes(r.content)


def index_archive(archive_id: int) -> dict[str, Any]:
    settings = get_settings()
    meta = fetch_archive_meta(archive_id)
    name = meta.get("name") or f"档案{archive_id}"
    category_code = meta.get("category_code")
    category_name = meta.get("category_name")
    file_name = meta.get("file_name") or ""
    file_format = meta.get("file_format") or Path(file_name).suffix.lstrip(".")

    with tempfile.TemporaryDirectory(prefix="rag_") as td:
        dest = Path(td) / (file_name or f"file.{file_format or 'bin'}")
        download_archive_file(archive_id, dest)
        body = extract_text(dest, file_format)

    # 元数据块：保证至少可按名称检索
    meta_blob = (
        f"档案名称：{name}\n"
        f"分类：{category_name or category_code or '未知'}\n"
        f"文件：{file_name}\n"
        f"说明：{meta.get('description') or '无'}"
    )
    if body.strip():
        full = meta_blob + "\n\n" + body
    else:
        full = (
            meta_blob
            + "\n\n（正文未能提取：可能是扫描件/CAD/压缩包，仅支持按名称与说明检索）"
        )

    chunks = chunk_text(
        full,
        chunk_size=settings.rag_chunk_size,
        overlap=settings.rag_chunk_overlap,
    )
    if not chunks:
        chunks = [meta_blob]

    embeddings = embed_texts(chunks)
    n = get_store().upsert_chunks(
        archive_id=archive_id,
        archive_name=name,
        category_code=category_code,
        category_name=category_name,
        file_name=file_name,
        chunks=chunks,
        embeddings=embeddings,
    )
    return {
        "archive_id": archive_id,
        "archive_name": name,
        "chunks": n,
        "has_body_text": bool(body.strip()),
    }


def delete_archive_index(archive_id: int) -> dict[str, Any]:
    removed = get_store().delete_by_archive(archive_id)
    return {"archive_id": archive_id, "removed_chunks": removed}


def reindex_all() -> dict[str, Any]:
    """从主站拉全部档案并重建索引。"""
    with httpx.Client(timeout=60.0) as client:
        r = client.get(
            _main_url("/internal/archives"),
            headers=_main_headers(),
            params={"page_size": 500},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"列举档案失败 {r.status_code}: {r.text[:200]}")
        data = r.json().get("data") or {}
        items = data.get("items") if isinstance(data, dict) else data
        items = items or []

    ok_n = 0
    errors: list[dict[str, Any]] = []
    for it in items:
        aid = it.get("id")
        if not aid:
            continue
        try:
            index_archive(int(aid))
            ok_n += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("index archive %s failed: %s", aid, exc)
            errors.append({"archive_id": aid, "error": str(exc)})
    return {
        "indexed": ok_n,
        "failed": len(errors),
        "errors": errors[:20],
        "store": get_store().stats(),
    }


def search_knowledge(
    query: str,
    *,
    top_k: int = 5,
    category_code: str | None = None,
) -> dict[str, Any]:
    hits = get_store().search(
        query,
        top_k=top_k,
        category_code=category_code,
    )
    return {
        "query": query,
        "hits": hits,
        "count": len(hits),
        "note": "回答时请引用 archive_name，勿编造档案中不存在的条文",
    }
