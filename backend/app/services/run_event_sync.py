"""由 SCADA 变位自动生成启停事件。

规则：
- 仅处理「布尔 + 已关联设备 + 信号名以“电机断路器合位”结尾」的点位。
- 与上一条最新值比较，0→1 写 start，1→0 写 stop；首条样本只记状态，不造事件。
- 同一设备/类型/事件时间已存在则跳过，保证重复推送幂等。
- 坏值、时间倒退的样本不参与判定；断线期间不生成事件。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.equipment import Equipment, EquipmentRunEvent
from app.models.scada import ScadaPoint
from app.services.point_mapping import RUN_SIGNAL_TAG_SUFFIX


def is_run_signal_point(point: ScadaPoint) -> bool:
    return bool(
        point
        and point.value_type == "bool"
        and point.equipment_id is not None
        and (point.tag_name or "").endswith(RUN_SIGNAL_TAG_SUFFIX)
    )


def _is_good(sample: Any) -> bool:
    if sample.status_code != 0:
        return False
    return (sample.status_name or "").strip().lower() in ("good", "ok", "")


def sync_run_events(
    db: Session,
    samples: list[Any],
    prev_states: dict[int, tuple[bool | None, int]],
) -> int:
    """按样本批次生成启停事件，返回新增条数。

    `prev_states`: point_id -> (上一值, 上一时间戳ms)，必须在写入 latest 之前采集。
    """
    if not samples:
        return 0

    point_ids = {s.point_id for s in samples}
    points = (
        db.query(ScadaPoint).filter(ScadaPoint.id.in_(point_ids)).all()
        if point_ids else []
    )
    point_map = {p.id: p for p in points}
    signal_eq_ids = {
        p.equipment_id for p in points if is_run_signal_point(p)
    }
    eq_names = (
        dict(
            db.query(Equipment.id, Equipment.name)
            .filter(Equipment.id.in_(signal_eq_ids))
            .all()
        )
        if signal_eq_ids else {}
    )

    created = 0
    rolling = dict(prev_states)
    for sample in samples:
        point = point_map.get(sample.point_id)
        prev = rolling.get(sample.point_id)
        if prev is None:
            # 首条样本：只建立基线，不补事件
            rolling[sample.point_id] = (sample.value_bool, sample.ts_ms)
            continue

        prev_value, prev_ts = prev
        # 先滚动更新，保证同批次内多次变位都能被识别
        rolling[sample.point_id] = (sample.value_bool, sample.ts_ms)
        if not is_run_signal_point(point):
            continue
        if not _is_good(sample) or sample.value_bool is None:
            continue
        if prev_value is None or prev_ts <= 0 or sample.ts_ms <= prev_ts:
            continue
        if bool(prev_value) == bool(sample.value_bool):
            continue

        event_type = "start" if bool(sample.value_bool) else "stop"
        event_time = datetime.fromtimestamp(sample.ts_ms / 1000)
        exists = (
            db.query(EquipmentRunEvent.id)
            .filter(
                EquipmentRunEvent.deleted == 0,
                EquipmentRunEvent.equipment_id == point.equipment_id,
                EquipmentRunEvent.event_type == event_type,
                EquipmentRunEvent.event_time == event_time,
            )
            .first()
        )
        if exists:
            continue

        db.add(
            EquipmentRunEvent(
                equipment_id=point.equipment_id,
                equipment_name=eq_names.get(point.equipment_id),
                event_type=event_type,
                event_time=event_time,
                source="auto",
                remark=f"SCADA变位：{point.tag_name}",
                status=1,
                deleted=0,
            )
        )
        equipment = db.get(Equipment, point.equipment_id)
        if equipment:
            equipment.running_status = "running" if event_type == "start" else "stopped"
        created += 1

    if created:
        db.flush()
    return created
