"""历史时序保留：按天删除过期 gw_tag_data。"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.store.models import GwTagData

logger = logging.getLogger("scada-gateway.retention")


class RetentionWorker:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._last_run: float | None = None
        self._last_deleted: int = 0
        self._last_error: str | None = None

    def status(self) -> dict:
        settings = get_settings()
        return {
            "enabled": settings.retention_days > 0,
            "retention_days": settings.retention_days,
            "interval_sec": settings.retention_interval_sec,
            "last_run": self._last_run,
            "last_deleted": self._last_deleted,
            "last_error": self._last_error,
            "running": self._thread is not None and self._thread.is_alive(),
        }

    def start(self) -> None:
        settings = get_settings()
        if settings.retention_days <= 0:
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop,
            name="scada-retention",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._thread = None

    def run_once(self) -> int:
        settings = get_settings()
        days = int(settings.retention_days)
        if days <= 0:
            return 0
        # ts_ms 为毫秒
        cutoff = datetime.now() - timedelta(days=days)
        cutoff_ms = int(cutoff.timestamp() * 1000)
        db = SessionLocal()
        try:
            q = db.query(GwTagData).filter(GwTagData.ts_ms < cutoff_ms)
            # SQLite 大批量删除：分批
            deleted = 0
            while True:
                rows = q.limit(2000).all()
                if not rows:
                    break
                for r in rows:
                    db.delete(r)
                db.commit()
                deleted += len(rows)
                if len(rows) < 2000:
                    break
            self._last_run = time.time()
            self._last_deleted = deleted
            self._last_error = None
            if deleted:
                logger.info("retention deleted %s rows older than %s days", deleted, days)
            return deleted
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)
            logger.warning("retention error: %s", exc)
            db.rollback()
            return 0
        finally:
            db.close()

    def _loop(self) -> None:
        # 启动稍等，避免与 seed 抢
        self._stop.wait(5)
        while not self._stop.is_set():
            self.run_once()
            interval = max(60.0, float(get_settings().retention_interval_sec))
            self._stop.wait(interval)


retention_worker = RetentionWorker()
