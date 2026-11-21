"""Ollama embeddings。"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    settings = get_settings()
    base = settings.ollama_base_url.rstrip("/")
    model = settings.ollama_embed_model
    vectors: list[list[float]] = []
    with httpx.Client(timeout=settings.ollama_timeout_sec) as client:
        for t in texts:
            r = client.post(
                f"{base}/api/embeddings",
                json={"model": model, "prompt": t[:8000]},
            )
            if r.status_code != 200:
                raise RuntimeError(
                    f"Ollama embeddings 失败 HTTP {r.status_code}: {r.text[:200]}"
                )
            data = r.json()
            emb = data.get("embedding")
            if not emb:
                raise RuntimeError("Ollama 未返回 embedding")
            vectors.append(emb)
    return vectors


def embed_one(text: str) -> list[float]:
    return embed_texts([text])[0]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / ((na**0.5) * (nb**0.5))
