"""文本分块。"""

from __future__ import annotations


def chunk_text(
    text: str,
    *,
    chunk_size: int = 600,
    overlap: int = 80,
) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    # 统一空白
    text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if len(text) <= chunk_size:
        return [text]

    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        # 尽量在句号/换行处切
        if end < n:
            window = text[start:end]
            for sep in ("\n", "。", "；", ";", ".", "！", "？"):
                pos = window.rfind(sep)
                if pos > chunk_size // 3:
                    end = start + pos + 1
                    break
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks
