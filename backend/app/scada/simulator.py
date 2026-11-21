"""SCADA 仿真运行时：周期生成测点值并落库。

真机 OPC-UA 接入时保留同一写入接口，仅替换数据源实现。
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any, Optional

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.scada import ScadaPoint
from app.scada.writer import Sample, apply_samples


class ScadaRuntime:
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

    def status(self) -> dict[str, Any]:
        with self._lock:
            settings = get_settings()
            return {
                "mode": self._mode,
                "running": self._running,
                "endpoint": self._endpoint,
                "interval_sec": self._interval_sec,
                "tick_count": self._tick_count,
                "last_error": self._last_error,
                "last_tick_at": self._last_tick_at,
                "last_sample_count": self._last_sample_count,
                "started_at": self._started_at,
                "opcua_endpoint_config": settings.scada_opcua_endpoint,
                "auto_start": settings.scada_auto_start,
            }

    def start(self, mode: str = "mock", interval_sec: Optional[float] = None) -> dict[str, Any]:
        with self._lock:
            if self._running:
                return self.status()
            settings = get_settings()
            self._mode = mode or settings.scada_mode
            self._interval_sec = float(
                interval_sec if interval_sec is not None else settings.scada_sim_interval_sec
            )
            if self._mode == "mock":
                self._endpoint = "mock://local-simulator"
            else:
                self._endpoint = settings.scada_opcua_endpoint
            self._stop.clear()
            self._last_error = None
            self._started_at = time.time()
            self._running = True
            self._thread = threading.Thread(
                target=self._loop,
                name="scada-simulator",
                daemon=True,
            )
            self._thread.start()
            return self.status()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._stop.set()
            thread = self._thread
            self._running = False
        if thread and thread.is_alive():
            thread.join(timeout=3)
        with self._lock:
            self._thread = None
            return self.status()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                count = self._tick_once()
                with self._lock:
                    self._tick_count += 1
                    self._last_sample_count = count
                    self._last_tick_at = time.time()
                    self._last_error = None
            except Exception as exc:  # noqa: BLE001
                with self._lock:
                    self._last_error = str(exc)
            self._stop.wait(self._interval_sec)

    def _tick_once(self) -> int:
        if self._mode != "mock":
            # Phase 2 仅仿真；真机后续接 asyncua
            raise RuntimeError("当前仅支持 mock 模式，请将 mode 设为 mock")

        db = SessionLocal()
        try:
            points = (
                db.query(ScadaPoint)
                .filter(
                    ScadaPoint.deleted == 0,
                    ScadaPoint.status == 1,
                    ScadaPoint.enabled == 1,
                )
                .all()
            )
            now_ms = int(time.time() * 1000)
            t = time.time()
            samples: list[Sample] = []
            for p in points:
                sample = self._gen_sample(p, t, now_ms)
                samples.append(sample)
            if samples:
                apply_samples(db, samples, write_history=True)
            return len(samples)
        finally:
            db.close()

    def _gen_sample(self, point: ScadaPoint, t: float, ts_ms: int) -> Sample:
        base = float(point.sim_base or 0)
        amp = float(point.sim_amplitude or 0)
        period = max(float(point.sim_period_sec or 60), 0.1)
        phase = (t % period) / period * 2 * math.pi
        wave = base + amp * math.sin(phase)

        if point.value_type == "bool":
            # 慢周期方波
            val_bool = wave >= base
            return Sample(
                point_id=point.id,
                tag_name=point.tag_name,
                node_id=point.node_id,
                value_type="bool",
                value_bool=val_bool,
                value_num=1.0 if val_bool else 0.0,
                ts_ms=ts_ms,
            )
        if point.value_type == "string":
            return Sample(
                point_id=point.id,
                tag_name=point.tag_name,
                node_id=point.node_id,
                value_type="string",
                value_str=f"{wave:.2f}",
                value_num=wave,
                ts_ms=ts_ms,
            )
        # number
        return Sample(
            point_id=point.id,
            tag_name=point.tag_name,
            node_id=point.node_id,
            value_type="number",
            value_num=round(wave, 4),
            ts_ms=ts_ms,
        )

    def inject(
        self,
        point_id: int,
        value: Any,
        value_type: Optional[str] = None,
        write_history: bool = True,
    ) -> Sample:
        """手动注入一个测点值（调试/联调用）。"""
        db = SessionLocal()
        try:
            point = (
                db.query(ScadaPoint)
                .filter(ScadaPoint.id == point_id, ScadaPoint.deleted == 0)
                .first()
            )
            if not point:
                raise ValueError("测点不存在")
            vt = value_type or point.value_type
            ts_ms = int(time.time() * 1000)
            sample = Sample(
                point_id=point.id,
                tag_name=point.tag_name,
                node_id=point.node_id,
                value_type=vt,
                ts_ms=ts_ms,
            )
            if vt == "bool":
                b = bool(value) if not isinstance(value, str) else value.lower() in (
                    "1",
                    "true",
                    "yes",
                    "on",
                )
                sample.value_bool = b
                sample.value_num = 1.0 if b else 0.0
            elif vt == "string":
                sample.value_str = str(value)
            else:
                sample.value_num = float(value)
            apply_samples(db, [sample], write_history=write_history)
            return sample
        finally:
            db.close()


scada_runtime = ScadaRuntime()
