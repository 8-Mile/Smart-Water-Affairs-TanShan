"""本地 JSONL 向量索引（无外部向量库依赖）。"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.rag.embed import cosine_similarity, embed_one


class VectorStore:
    def __init__(self, path: Path | None = None) -> None:
        settings = get_settings()
        self.path = path or Path(settings.rag_store_path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._rows: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        self._rows = []
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    self._rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    def _save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for row in self._rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        tmp.replace(self.path)

    def delete_by_archive(self, archive_id: int) -> int:
        with self._lock:
            before = len(self._rows)
            self._rows = [r for r in self._rows if r.get("archive_id") != archive_id]
            removed = before - len(self._rows)
            if removed:
                self._save()
            return removed

    def upsert_chunks(
        self,
        *,
        archive_id: int,
        archive_name: str,
        category_code: str | None,
        category_name: str | None,
        file_name: str | None,
        chunks: list[str],
        embeddings: list[list[float]],
    ) -> int:
        if len(chunks) != len(embeddings):
            raise ValueError("chunks 与 embeddings 数量不一致")
        with self._lock:
            self._rows = [r for r in self._rows if r.get("archive_id") != archive_id]
            now = time.time()
            for i, (text, emb) in enumerate(zip(chunks, embeddings)):
                self._rows.append(
                    {
                        "id": str(uuid.uuid4()),
                        "archive_id": archive_id,
                        "archive_name": archive_name,
                        "category_code": category_code,
                        "category_name": category_name,
                        "file_name": file_name,
                        "chunk_index": i,
                        "text": text,
                        "embedding": emb,
                        "updated_at": now,
                    }
                )
            self._save()
            return len(chunks)

    def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        category_code: str | None = None,
    ) -> list[dict[str, Any]]:
        q = (query or "").strip()
        if not q:
            return []
        with self._lock:
            rows = list(self._rows)
        if not rows:
            return []
        if category_code:
            rows = [r for r in rows if r.get("category_code") == category_code]
            if not rows:
                return []

        qv = embed_one(q)
        scored: list[tuple[float, dict[str, Any]]] = []
        for r in rows:
            emb = r.get("embedding") or []
            score = cosine_similarity(qv, emb)
            scored.append((score, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        out = []
        for score, r in scored[: max(1, top_k)]:
            out.append(
                {
                    "score": round(score, 4),
                    "archive_id": r.get("archive_id"),
                    "archive_name": r.get("archive_name"),
                    "category_code": r.get("category_code"),
                    "category_name": r.get("category_name"),
                    "file_name": r.get("file_name"),
                    "chunk_index": r.get("chunk_index"),
                    "text": r.get("text"),
                }
            )
        return out

    def stats(self) -> dict[str, Any]:
        with self._lock:
            aids = {r.get("archive_id") for r in self._rows}
            return {
                "chunks": len(self._rows),
                "archives": len(aids),
                "path": str(self.path),
            }


_store: VectorStore | None = None


def get_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store
