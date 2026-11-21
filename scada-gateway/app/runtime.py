"""采集运行时：mock 周期 tick / opcua 订阅轮询。"""

from __future__ import annotations

import threading
import time
from typing import Any, Optional

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.push.webhook import push_samples_to_main
from app.sources.mock import generate_mock_samples
from app.sources.opcua import OpcUaSource
from app.store.models import GwPoint
from app.store.sample import Sample
from app.store.writer import apply_samples


class GatewayRuntime:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._running = False
        self._mode = "mock"
        self._tick_count = 0
        self._last_error: Optional[str] = None
        self._last_tick_at: Optional[float] = None
        self._last_sample_count = 0
        self._started_at: Optional[float] = None
        self._endpoint = "mock://local-simulator"
        self._interval_sec = 1.0
        self._last_webhook: Optional[dict[str, Any]] = None
        self._opcua: Optional[OpcUaSource] = None

    def status(self) -> dict[str, Any]:
        with self._lock:
            settings = get_settings()
            st = {
                "mode": self._mode,
                "running": self._running,
                "endpoint": self._endpoint,
                "interval_sec": self._interval_sec,
                "tick_count": self._tick_count,
                "last_error": self._last_error,
                "last_tick_at": self._last_tick_at,
                "last_sample_count": self._last_sample_count,
                "started_at": self._started_at,
                "auto_start": settings.auto_start,
                "retention_days": settings.retention_days,
                "opcua_endpoint_config": settings.opcua_endpoint,
                "webhook_url": settings.main_app_webhook_url or None,
                "last_webhook": self._last_webhook,
            }
            if self._opcua is not None:
                st["opcua"] = self._opcua.status()
            return st

    def start(
        self,
        mode: str | None = None,
        interval_sec: float | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if self._running:
                return self.status()
            settings = get_settings()
            self._mode = (mode or settings.source_mode or "mock").lower()
            self._interval_sec = float(
                interval_sec if interval_sec is not None else settings.sim_interval_sec
            )
            if self._mode == "mock":
                self._endpoint = "mock://local-simulator"
            elif self._mode == "opcua":
                self._endpoint = settings.opcua_endpoint
            else:
                raise ValueError(f"不支持的 mode: {self._mode}（mock|opcua）")

            self._stop.clear()
            self._last_error = None
            self._started_at = time.time()
            self._running = True

            if self._mode == "opcua":
                self._opcua = OpcUaSource(on_samples=self._ingest_samples)
                self._opcua.start()
            else:
                self._opcua = None
                self._thread = threading.Thread(
                    target=self._loop_mock,
                    name="scada-gateway-runtime",
                    daemon=True,
                )
                self._thread.start()
            return self.status()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._stop.set()
            thread = self._thread
            opcua = self._opcua
            self._running = False
        if opcua is not None:
            opcua.stop()
        if thread and thread.is_alive():
            thread.join(timeout=3)
        with self._lock:
            self._thread = None
            self._opcua = None
            return self.status()

    def _loop_mock(self) -> None:
        while not self._stop.is_set():
            try:
                self._tick_mock_once()
            except Exception as exc:  # noqa: BLE001
                with self._lock:
                    self._last_error = str(exc)
            self._stop.wait(self._interval_sec)

    def _tick_mock_once(self) -> int:
        db = SessionLocal()
        try:
            points = db.query(GwPoint).filter(GwPoint.enabled == 1).all()
            samples = generate_mock_samples(points)
            if samples:
                self._ingest_samples(samples, db=db)
            else:
                with self._lock:
                    self._tick_count += 1
                    self._last_sample_count = 0
                    self._last_tick_at = time.time()
            return len(samples)
        finally:
            db.close()

    def _ingest_samples(
        self,
        samples: list[Sample],
        *,
        db: Any = None,
        write_history: bool = True,
    ) -> None:
        own_db = db is None
        if own_db:
            db = SessionLocal()
        try:
            if samples:
                apply_samples(db, samples, write_history=write_history)
                wh = push_samples_to_main(samples, write_history=write_history)
                with self._lock:
                    self._tick_count += 1
                    self._last_sample_count = len(samples)
                    self._last_tick_at = time.time()
                    self._last_webhook = wh
                    self._last_error = None
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._last_error = str(exc)
            raise
        finally:
            if own_db:
                db.close()

    def inject(
        self,
        point_id: int,
        value: Any,
        value_type: str | None = None,
        write_history: bool = True,
    ) -> Sample:
        db = SessionLocal()
        try:
            point = db.query(GwPoint).filter(GwPoint.id == point_id).first()
            if not point:
                raise ValueError("测点不存在")
            vt = value_type or point.value_type
            ts_ms = int(time.time() * 1000)

            # opcua 模式可选写回现场
            if self._mode == "opcua" and self._opcua is not None:
                settings = get_settings()
                if settings.opcua_allow_write:
                    try:
                        self._opcua.write_node(point.node_id, value, vt)
                    except Exception as exc:  # noqa: BLE001
                        # 写失败仍允许本地镜像（联调）
                        with self._lock:
                            self._last_error = f"OPC write failed: {exc}"

            sample = Sample(
                point_id=point.id,
                tag_name=point.tag_name,
                node_id=point.node_id,
                value_type=vt,
                ts_ms=ts_ms,
            )
            if vt == "bool":
                b = (
                    bool(value)
                    if not isinstance(value, str)
                    else value.lower() in ("1", "true", "yes", "on")
                )
                sample.value_bool = b
                sample.value_num = 1.0 if b else 0.0
            elif vt == "string":
                sample.value_str = str(value)
            else:
                sample.value_num = float(value)

            apply_samples(db, [sample], write_history=write_history)
            wh = push_samples_to_main([sample], write_history=write_history)
            with self._lock:
                self._last_webhook = wh
            return sample
        finally:
            db.close()


gateway_runtime = GatewayRuntime()
