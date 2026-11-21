"""轻量后台调度：巡检/维保自动派发 + 每日能耗自动重算 + SCADA 历史清理。"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta
from typing import Optional

from app.core.database import SessionLocal
from app.models.scada import ScadaTagData
from app.services import (
    audit_service,
    energy_stats_service,
    inspection_service,
    maintenance_service,
)

SCADA_HISTORY_RETENTION_DAYS = 90  # scada_tag_data 只保留最近 90 天


class OpsScheduler:
    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._running = False
        self._interval_sec = 3600  # 默认每小时检查
        self._last_run_at: Optional[float] = None
        self._last_result: dict = {}

    def status(self) -> dict:
        return {
            "running": self._running,
            "interval_sec": self._interval_sec,
            "last_run_at": self._last_run_at,
            "last_result": self._last_result,
        }

    def start(self, interval_sec: float = 3600) -> None:
        if self._running:
            return
        self._interval_sec = max(float(interval_sec), 30)
        self._stop.clear()
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, name="ops-scheduler", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._thread = None

    def run_once(self) -> dict:
        db = SessionLocal()
        try:
            insp = inspection_service.dispatch_due_plans(db)
            # inspection commits inside; open new session for maintenance if needed
        finally:
            db.close()
        db = SessionLocal()
        try:
            maint = maintenance_service.dispatch_due_plans(db)
        finally:
            db.close()
        db = SessionLocal()
        try:
            logs_deleted = audit_service.cleanup_operation_logs(db)
        finally:
            db.close()
        db = SessionLocal()
        try:
            energy = self._recalc_energy(db)
        finally:
            db.close()
        db = SessionLocal()
        try:
            scada_deleted = self._cleanup_scada_history(db)
        finally:
            db.close()
        result = {
            "inspection_plans": insp,
            "maintenance_records": maint,
            "operation_logs_deleted": logs_deleted,
            "energy_recalc": energy,
            "scada_history_deleted": scada_deleted,
            "ts": time.time(),
        }
        self._last_run_at = time.time()
        self._last_result = result
        return result

    @staticmethod
    def _recalc_energy(db) -> dict:
        """重算今日与昨日能耗：今日随采集增量刷新，昨日做日终校准。"""
        today = date.today()
        try:
            return {
                "yesterday": energy_stats_service.recalc_day(
                    db, today - timedelta(days=1)
                ),
                "today": energy_stats_service.recalc_day(db, today),
            }
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    @staticmethod
    def _cleanup_scada_history(db) -> int:
        """删除 90 天前的 scada_tag_data，防止主站库无限增长。

        每小时调度都会调用，但仅当存在过期数据时才执行 DELETE；
        正常生产环境每天清理一次即可，这里按小时调用保证不积累。
        """
        cutoff = datetime.combine(
            date.today() - timedelta(days=SCADA_HISTORY_RETENTION_DAYS),
            datetime.min.time(),
        )
        cutoff_ms = int(cutoff.timestamp() * 1000)
        try:
            deleted = (
                db.query(ScadaTagData)
                .filter(ScadaTagData.ts_ms < cutoff_ms)
                .delete(synchronize_session=False)
            )
            db.commit()
            return int(deleted or 0)
        except Exception:  # noqa: BLE001
            db.rollback()
            return 0

    def _loop(self) -> None:
        # 启动后稍等再跑，避免与 seed 抢锁
        self._stop.wait(5)
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception as exc:  # noqa: BLE001
                self._last_result = {"error": str(exc), "ts": time.time()}
                self._last_run_at = time.time()
            self._stop.wait(self._interval_sec)


ops_scheduler = OpsScheduler()
