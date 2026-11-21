"""测点最新值 + 历史批量写入。"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.scada import ScadaPointLatest, ScadaTagData

logger = logging.getLogger(__name__)


@dataclass
class Sample:
    point_id: int
    tag_name: str
    node_id: str
    value_type: str
    value_num: Optional[float] = None
    value_bool: Optional[bool] = None
    value_str: Optional[str] = None
    status_code: int = 0
    status_name: str = "Good"
    ts_ms: int = 0


def apply_sample(db: Session, sample: Sample, write_history: bool = True) -> None:
    latest = (
        db.query(ScadaPointLatest)
        .filter(ScadaPointLatest.point_id == sample.point_id)
        .first()
    )
    value_num = (
        Decimal(str(sample.value_num)) if sample.value_num is not None else None
    )
    if not latest:
        latest = ScadaPointLatest(
            point_id=sample.point_id,
            tag_name=sample.tag_name,
            node_id=sample.node_id,
            value_type=sample.value_type,
            value_num=value_num,
            value_bool=sample.value_bool,
            value_str=sample.value_str,
            status_code=sample.status_code,
            status_name=sample.status_name,
            ts_ms=sample.ts_ms,
        )
        db.add(latest)
    else:
        latest.tag_name = sample.tag_name
        latest.node_id = sample.node_id
        latest.value_type = sample.value_type
        latest.value_num = value_num
        latest.value_bool = sample.value_bool
        latest.value_str = sample.value_str
        latest.status_code = sample.status_code
        latest.status_name = sample.status_name
        latest.ts_ms = sample.ts_ms
        db.add(latest)
    # 立即 flush，保证同一批次后续样本查询 latest 时能看到已写入的记录
    db.flush()

    if write_history:
        db.add(
            ScadaTagData(
                tag_name=sample.tag_name,
                node_id=sample.node_id,
                value_type=sample.value_type,
                value_num=value_num,
                value_bool=sample.value_bool,
                value_str=sample.value_str,
                status_code=sample.status_code,
                status_name=sample.status_name,
                ts_ms=sample.ts_ms,
            )
        )


def apply_samples(db: Session, samples: list[Sample], write_history: bool = True) -> int:
    # 先取出写入前的状态，供启停边沿判定（latest 更新后旧值即丢失）
    prev_states: dict[int, tuple[bool | None, int]] = {}
    if samples:
        point_ids = {s.point_id for s in samples}
        rows = (
            db.query(
                ScadaPointLatest.point_id,
                ScadaPointLatest.value_bool,
                ScadaPointLatest.ts_ms,
            )
            .filter(ScadaPointLatest.point_id.in_(point_ids))
            .all()
        )
        prev_states = {
            pid: (bool(value) if value is not None else None, ts or 0)
            for pid, value, ts in rows
        }

    for s in samples:
        apply_sample(db, s, write_history=write_history)

    # 变位 → 启停事件。用 SAVEPOINT 隔离，事件生成失败不影响采样入库
    try:
        from app.services.run_event_sync import sync_run_events

        with db.begin_nested():
            sync_run_events(db, samples, prev_states)
    except Exception:  # noqa: BLE001
        logger.exception("生成启停事件失败，样本已正常入库")

    db.commit()
    # 写库后触发告警引擎；坏值样本不参与告警判定
    try:
        from app.alarm_engine.engine import evaluate_alarms_for_tags

        good_tags = {
            s.tag_name
            for s in samples
            if s.status_code == 0 and (s.status_name or "").strip().lower() in ("good", "ok", "")
        }
        if good_tags:
            evaluate_alarms_for_tags(db, good_tags)
    except Exception:  # noqa: BLE001
        # 引擎失败不影响采集
        pass
    return len(samples)


def sample_to_dict(sample: Sample) -> dict[str, Any]:
    return {
        "point_id": sample.point_id,
        "tag_name": sample.tag_name,
        "node_id": sample.node_id,
        "value_type": sample.value_type,
        "value_num": sample.value_num,
        "value_bool": sample.value_bool,
        "value_str": sample.value_str,
        "status_code": sample.status_code,
        "status_name": sample.status_name,
        "ts_ms": sample.ts_ms,
    }
