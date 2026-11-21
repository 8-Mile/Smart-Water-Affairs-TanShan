#!/usr/bin/env python3
"""全量重建档案向量索引。

用法（在 ai-service 目录）:
  source .venv/bin/activate
  python scripts/reindex_archives.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.rag.indexer import reindex_all  # noqa: E402


def main() -> None:
    result = reindex_all()
    print(result)


if __name__ == "__main__":
    main()
