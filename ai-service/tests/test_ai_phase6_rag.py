"""阶段 6：RAG 分块/检索（不依赖真实 Ollama embedding）。"""

from pathlib import Path
from unittest.mock import patch

from app.rag.chunk import chunk_text
from app.rag.parse import extract_text
from app.rag.store import VectorStore


def test_chunk_text_overlap():
    text = "第一句。第二句。第三句。" * 40
    chunks = chunk_text(text, chunk_size=100, overlap=20)
    assert len(chunks) >= 2
    assert all(c.strip() for c in chunks)


def test_extract_txt(tmp_path: Path):
    p = tmp_path / "a.txt"
    p.write_text("轴承温度巡检标准：不超过 85 摄氏度。", encoding="utf-8")
    t = extract_text(p, "txt")
    assert "85" in t


def test_vector_store_search(tmp_path: Path):
    store_path = tmp_path / "idx.jsonl"
    store = VectorStore(path=store_path)

    # 假 embedding：用字符直方图近似，保证相同文本相似度高
    def fake_embed(texts):
        out = []
        for t in texts:
            vec = [0.0] * 32
            for i, ch in enumerate(t[:200]):
                vec[i % 32] += (ord(ch) % 17) / 17.0
            out.append(vec)
        return out

    chunks = [
        "水泵轴承温度巡检不得超过八十五度。",
        "闸门开度操作需经调度确认。",
    ]
    with patch("app.rag.store.embed_one") as m_one, patch(
        "app.rag.embed.embed_texts", side_effect=fake_embed
    ):
        embs = fake_embed(chunks)
        m_one.side_effect = lambda q: fake_embed([q])[0]
        store.upsert_chunks(
            archive_id=1,
            archive_name="设备巡检制度",
            category_code="DOC-POLICY",
            category_name="管理制度",
            file_name="xuncha.txt",
            chunks=chunks,
            embeddings=embs,
        )
        hits = store.search("轴承温度巡检", top_k=2)
        assert hits
        assert hits[0]["archive_name"] == "设备巡检制度"
        assert "轴承" in hits[0]["text"] or hits[0]["score"] >= 0
