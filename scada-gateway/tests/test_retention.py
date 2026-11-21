"""历史保留清理。"""

import time

from app.core.database import SessionLocal, init_db
from app.retention import retention_worker
from app.store.models import GwTagData
from app.core.config import get_settings


def test_retention_deletes_old_rows(monkeypatch):
    init_db()
    # 强制保留 0 天等价于删除全部历史：改用 1 天 + 很旧的 ts
    monkeypatch.setenv("RETENTION_DAYS", "1")
    get_settings.cache_clear()

    db = SessionLocal()
    try:
        old_ms = int((time.time() - 3 * 86400) * 1000)
        new_ms = int(time.time() * 1000)
        db.add(
            GwTagData(
                tag_name="OLD",
                node_id="n",
                value_type="number",
                value_num=1,
                ts_ms=old_ms,
            )
        )
        db.add(
            GwTagData(
                tag_name="NEW",
                node_id="n",
                value_type="number",
                value_num=2,
                ts_ms=new_ms,
            )
        )
        db.commit()
    finally:
        db.close()

    deleted = retention_worker.run_once()
    assert deleted >= 1

    db = SessionLocal()
    try:
        tags = {r.tag_name for r in db.query(GwTagData).all()}
        assert "OLD" not in tags
        assert "NEW" in tags
    finally:
        db.close()

    monkeypatch.delenv("RETENTION_DAYS", raising=False)
    get_settings.cache_clear()
