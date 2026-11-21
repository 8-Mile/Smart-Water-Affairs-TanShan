"""Mock 数据源：按测点 sim_* 参数生成正弦/方波。"""

from __future__ import annotations

import math
import time

from app.store.models import GwPoint
from app.store.sample import Sample


def generate_mock_samples(points: list[GwPoint], t: float | None = None) -> list[Sample]:
    now = t if t is not None else time.time()
    ts_ms = int(now * 1000)
    samples: list[Sample] = []
    for p in points:
        samples.append(_gen_one(p, now, ts_ms))
    return samples


def _gen_one(point: GwPoint, t: float, ts_ms: int) -> Sample:
    base = float(point.sim_base or 0)
    amp = float(point.sim_amplitude or 0)
    period = max(float(point.sim_period_sec or 60), 0.1)
    phase = (t % period) / period * 2 * math.pi
    wave = base + amp * math.sin(phase)

    if point.value_type == "bool":
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
    return Sample(
        point_id=point.id,
        tag_name=point.tag_name,
        node_id=point.node_id,
        value_type="number",
        value_num=round(wave, 4),
        ts_ms=ts_ms,
    )
