"""接收 Gateway 采样并镜像到主站 SCADA 表，触发告警。"""

from __future__ import annotations

import time
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.equipment import Equipment
from app.models.scada import ScadaPoint
from app.scada.writer import Sample, apply_samples
from app.services.point_mapping import equipment_code_for_tag, unit_code_for_tag

# 进程内按 tag 记录最近一次写历史的毫秒时间戳，用于 his_rec_interval 降采样。
# 重启服务后从 0 开始，下一批样本会写历史，不影响正确性。
_LAST_HISTORY_MS: dict[str, int] = {}


def _as_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    return float(v)


def resolve_or_create_point(
    db: Session,
    *,
    tag_name: str,
    node_id: str = "",
    value_type: str = "number",
    unit: str | None = None,
    description: str | None = None,
) -> ScadaPoint:
    point = (
        db.query(ScadaPoint)
        .filter(ScadaPoint.tag_name == tag_name, ScadaPoint.deleted == 0)
        .first()
    )
    if point:
        # 轻量同步 node_id / value_type
        dirty = False
        if node_id and point.node_id != node_id:
            point.node_id = node_id
            dirty = True
        if value_type and point.value_type != value_type:
            point.value_type = value_type
            dirty = True
        if dirty:
            db.add(point)
            db.flush()
        return point

    point = ScadaPoint(
        tag_name=tag_name,
        node_id=node_id or f"gw:{tag_name}",
        value_type=value_type or "number",
        unit=unit,
        description=description or f"从 Gateway 同步: {tag_name}",
        sim_base=0,
        sim_amplitude=0,
        sim_period_sec=60,
        enabled=1,
        status=1,
        deleted=0,
    )
    db.add(point)
    db.flush()
    return point


def _equipment_code_map(db: Session) -> dict[str, int]:
    """设备编码 → id，用于点位自动归属（每次 ingest 批量构建一次）。"""
    rows = (
        db.query(Equipment.id, Equipment.code)
        .filter(Equipment.deleted == 0, Equipment.status == 1)
        .all()
    )
    return {str(code): int(eq_id) for eq_id, code in rows if code}


def _auto_bind_equipment(db: Session, point: ScadaPoint, code_map: dict[str, int]) -> bool:
    """未绑定设备的点位，按 tag 命名规则（point_mapping.equipment_code_for_tag）自动归属。

    子设备编码不存在时（如新机组未建子台账）回退到机组层；仅在 equipment_id 为空时生效，
    不覆盖人工绑定。
    """
    if point.equipment_id is not None:
        return False
    eq_id = code_map.get(equipment_code_for_tag(point.tag_name) or "")
    if not eq_id:
        eq_id = code_map.get(unit_code_for_tag(point.tag_name) or "")
    if not eq_id:
        return False
    point.equipment_id = eq_id
    db.add(point)
    return True


def _is_good_sample(sample: Sample) -> bool:
    """判断样本质量是否可入历史 / 参与告警。

    OPC UA 状态码：0x00000000 为 Good；高位为 1（如 0x80000000）为 Bad，
    0x40000000 段为 Uncertain。网关也可能直接传 status_name。
    """
    if sample.status_code != 0:
        return False
    name = (sample.status_name or "").strip().lower()
    return name in ("good", "ok", "")


def _should_write_history(
    db: Session,
    point: ScadaPoint,
    sample: Sample,
    interval_override: Optional[int] = None,
) -> bool:
    """按点表 his_rec_interval（秒）降采样，决定是否落 scada_tag_data。

    - interval_override 优先级最高（如 ingest 显式关闭时传 0 表示不写）
    - 点位无 his_rec_interval 或 <=0 时，默认每 60 秒写一次历史
    - latest 表不受节流影响，每次都会更新
    - 坏值（status 非 Good）不写历史
    """
    if not _is_good_sample(sample):
        return False
    if interval_override is not None:
        if interval_override <= 0:
            return False
        interval_ms = interval_override * 1000
    else:
        interval_sec = point.his_rec_interval or 60
        if interval_sec <= 0:
            interval_sec = 60
        interval_ms = interval_sec * 1000

    last = _LAST_HISTORY_MS.get(point.tag_name, 0)
    if sample.ts_ms - last >= interval_ms:
        _LAST_HISTORY_MS[point.tag_name] = sample.ts_ms
        return True
    return False


def ingest_samples(
    db: Session,
    raw_samples: list[dict[str, Any]],
    *,
    write_history: bool = True,
) -> dict[str, Any]:
    """
    raw_samples 项字段（Gateway Sample.to_dict）：
    tag_name, node_id, value_type, value_num, value_bool, value_str,
    status_code, status_name, ts_ms
    注意：Gateway 的 point_id 与主站不同，必须以 tag_name 映射。

    write_history=False 时完全禁止写历史；write_history=True 时按点位 his_rec_interval 降采样。
    """
    samples: list[Sample] = []
    history_samples: list[Sample] = []
    code_map: dict[str, int] | None = None
    bound = 0
    for item in raw_samples:
        tag = item.get("tag_name")
        if not tag:
            continue
        point = resolve_or_create_point(
            db,
            tag_name=str(tag),
            node_id=str(item.get("node_id") or ""),
            value_type=str(item.get("value_type") or "number"),
        )
        # 首次接入的点位按命名规则自动归属设备（已人工绑定的不覆盖）
        if code_map is None:
            code_map = _equipment_code_map(db)
        if _auto_bind_equipment(db, point, code_map):
            bound += 1
        sample = Sample(
            point_id=point.id,
            tag_name=point.tag_name,
            node_id=point.node_id,
            value_type=point.value_type,
            value_num=_as_float(item.get("value_num")),
            value_bool=item.get("value_bool"),
            value_str=item.get("value_str"),
            status_code=int(item.get("status_code") or 0),
            status_name=str(item.get("status_name") or "Good"),
            ts_ms=int(item.get("ts_ms") or 0),
        )
        samples.append(sample)
        if write_history and _should_write_history(db, point, sample):
            history_samples.append(sample)

    if not samples:
        return {"accepted": 0, "tags": []}

    # latest 全量更新；历史按节流后的子集写入
    apply_samples(db, samples, write_history=False)
    if history_samples:
        apply_samples(db, history_samples, write_history=True)

    return {
        "accepted": len(samples),
        "history_written": len(history_samples),
        "auto_bound": bound,
        "tags": sorted({s.tag_name for s in samples}),
    }
