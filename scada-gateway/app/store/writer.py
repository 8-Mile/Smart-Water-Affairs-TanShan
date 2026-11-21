"""最新值 + 历史写入。"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.store.models import GwPointLatest, GwTagData
from app.store.sample import Sample


def apply_sample(db: Session, sample: Sample, write_history: bool = True) -> None:
    value_num = (
        Decimal(str(sample.value_num)) if sample.value_num is not None else None
    )
    latest = (
        db.query(GwPointLatest)
        .filter(GwPointLatest.point_id == sample.point_id)
        .first()
    )
    if not latest:
        db.add(
            GwPointLatest(
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
        )
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

    if write_history:
        db.add(
            GwTagData(
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
    for s in samples:
        apply_sample(db, s, write_history=write_history)
    db.commit()
    return len(samples)
