"""告警规则引擎：基于 SCADA 最新值评估规则并生成告警。"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.alarm_engine.ws_hub import alarm_ws_hub
from app.models.alarm import Alarm, AlarmActionLog, AlarmPendingState, AlarmRule, AlarmType
from app.models.equipment import Equipment
from app.models.org import Location
from app.models.repair import RepairOrder
from app.models.scada import ScadaPoint, ScadaPointLatest

ACTIVE_STATUSES = ("pending", "processing", "pending_accept")


def _parse_threshold(raw: str) -> Any:
    s = (raw or "").strip()
    low = s.lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        if "." in s:
            return float(s)
        return int(s)
    except ValueError:
        return s


def _to_number(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def compare(op: str, left: Any, right: Any) -> bool:
    op = (op or "gt").lower()
    # bool / string equality first
    if op in ("eq", "="):
        if isinstance(right, bool) or isinstance(left, bool):
            return bool(left) == bool(right)
        ln, rn = _to_number(left), _to_number(right)
        if ln is not None and rn is not None:
            return ln == rn
        return str(left) == str(right)
    if op in ("neq", "ne", "!="):
        return not compare("eq", left, right)

    ln, rn = _to_number(left), _to_number(right)
    if ln is None or rn is None:
        return False
    if op in ("gt", ">"):
        return ln > rn
    if op in ("gte", ">="):
        return ln >= rn
    if op in ("lt", "<"):
        return ln < rn
    if op in ("lte", "<="):
        return ln <= rn
    return False


def resolve_point_latest(db: Session, token: str) -> Optional[tuple[ScadaPoint, ScadaPointLatest, Any]]:
    token = token.strip()
    if not token:
        return None
    point: Optional[ScadaPoint] = None
    if token.isdigit():
        point = (
            db.query(ScadaPoint)
            .filter(ScadaPoint.deleted == 0, ScadaPoint.id == int(token))
            .first()
        )
        if not point:
            point = (
                db.query(ScadaPoint)
                .filter(ScadaPoint.deleted == 0, ScadaPoint.tag_name == token)
                .first()
            )
        if not point:
            point = (
                db.query(ScadaPoint)
                .filter(ScadaPoint.deleted == 0, ScadaPoint.node_id.like(f"%i={token}"))
                .first()
            )
    else:
        point = (
            db.query(ScadaPoint)
            .filter(ScadaPoint.deleted == 0, ScadaPoint.tag_name == token)
            .first()
        )
    if not point:
        return None
    latest = (
        db.query(ScadaPointLatest)
        .filter(ScadaPointLatest.point_id == point.id)
        .first()
    )
    if not latest:
        return None
    if point.value_type == "bool":
        val: Any = latest.value_bool
    elif point.value_type == "string":
        val = latest.value_str
    else:
        val = float(latest.value_num) if latest.value_num is not None else None
    return point, latest, val


def create_repair_from_alarm(
    db: Session,
    alarm: Alarm,
    applicant_id: Optional[int] = None,
    applicant_name: Optional[str] = None,
) -> RepairOrder:
    from app.services.repair_service import ensure_equipment_free, log_repair, next_order_no

    # 设备级互斥：同一设备已有未归档工单时不再重复生成工单（告警本身照常记录）
    ensure_equipment_free(db, alarm.equipment_id, alarm.equipment_name)

    level_map = {1: "紧急", 2: "重要", 3: "一般"}
    level_txt = level_map.get(alarm.alarm_level, "一般")
    desc = (
        f"【{level_txt}】{alarm.rule_name}"
        f"（变量{alarm.point_refs}={alarm.trigger_value}，{alarm.trigger_detail or ''}）"
    )
    # 恢复关联场景（驳回重开）：标注来源，避免与历史驳回单雷同难辨
    prev = (
        db.query(RepairOrder)
        .filter(RepairOrder.alarm_id == alarm.id, RepairOrder.deleted == 0)
        .order_by(RepairOrder.id.desc())
        .first()
    )
    if prev:
        prev_reason = f"，驳回原因：{prev.approve_comment}" if prev.approve_comment else ""
        desc += f"（恢复关联单；上次工单 {prev.order_no}{prev_reason}）"
    order = RepairOrder(
        order_no=next_order_no(db),
        name=alarm.rule_name,
        equipment_id=alarm.equipment_id,
        equipment_name=alarm.equipment_name,
        equipment_code=alarm.equipment_code,
        alarm_id=alarm.id,
        process_status="pending_dispatch",
        description=desc,
        source="alarm",
        repair_type="overhaul",
        fault_time=alarm.alarm_time,
        applicant_id=applicant_id,
        applicant_name=applicant_name or "系统",
        status=1,
        deleted=0,
    )
    db.add(order)
    db.flush()
    alarm.repair_id = order.id
    db.add(alarm)
    log_repair(
        db,
        order.id,
        "create_from_alarm",
        detail=f"alarm_id={alarm.id}",
    )
    return order


def _log(
    db: Session,
    alarm_id: int,
    action: str,
    operator_id: Optional[int] = None,
    operator_name: Optional[str] = None,
    detail: Optional[str] = None,
) -> None:
    db.add(
        AlarmActionLog(
            alarm_id=alarm_id,
            action=action,
            operator_id=operator_id,
            operator_name=operator_name,
            detail=detail,
        )
    )


def _has_active_alarm(db: Session, rule_id: int, equipment_id: int) -> Optional[Alarm]:
    return (
        db.query(Alarm)
        .filter(
            Alarm.deleted == 0,
            Alarm.rule_id == rule_id,
            Alarm.equipment_id == equipment_id,
            Alarm.alarm_status.in_(ACTIVE_STATUSES),
        )
        .order_by(Alarm.id.desc())
        .first()
    )


def evaluate_rule(db: Session, rule: AlarmRule) -> Optional[Alarm]:
    if rule.enabled != 1 or rule.status != 1 or rule.deleted != 0:
        return None

    eq = (
        db.query(Equipment)
        .filter(Equipment.id == rule.equipment_id, Equipment.deleted == 0)
        .first()
    )
    if not eq:
        return None

    tokens = [t.strip() for t in rule.point_refs.replace(";", ",").split(",") if t.strip()]
    if not tokens:
        return None

    hits: list[str] = []
    values: list[str] = []
    threshold = _parse_threshold(rule.threshold)
    for token in tokens:
        resolved = resolve_point_latest(db, token)
        if not resolved:
            continue
        point, _latest, val = resolved
        ok = compare(rule.compare_op, val, threshold)
        values.append(f"{point.tag_name}={val}")
        if ok:
            hits.append(f"{point.tag_name}={val}")

    if rule.trigger_logic == "all":
        matched = len(hits) == len(tokens) and len(tokens) > 0
    else:
        matched = len(hits) > 0

    pending = (
        db.query(AlarmPendingState)
        .filter(AlarmPendingState.rule_id == rule.id)
        .first()
    )
    now = time.time()

    if not matched:
        if pending:
            db.delete(pending)
            db.commit()
        return None

    # delay
    if rule.delay_sec and rule.delay_sec > 0:
        if not pending:
            db.add(
                AlarmPendingState(
                    rule_id=rule.id,
                    first_hit_ts=now,
                    last_value=",".join(hits),
                )
            )
            db.commit()
            return None
        if now - pending.first_hit_ts < rule.delay_sec:
            pending.last_value = ",".join(hits)
            db.add(pending)
            db.commit()
            return None
        # delay satisfied
        db.delete(pending)
        db.commit()
    elif pending:
        db.delete(pending)
        db.commit()

    active = _has_active_alarm(db, rule.id, rule.equipment_id)
    if active:
        # 抖动抑制 / 去重：存在活跃告警则不再新建
        return None

    type_row = (
        db.query(AlarmType)
        .filter(AlarmType.code == rule.alarm_type_code, AlarmType.deleted == 0)
        .first()
    )
    loc_name = None
    if eq.location_id:
        loc = (
            db.query(Location)
            .filter(Location.id == eq.location_id, Location.deleted == 0)
            .first()
        )
        loc_name = loc.name if loc else None

    detail = (
        f"触发条件：{rule.compare_op} {rule.threshold}；"
        f"逻辑={rule.trigger_logic}；命中={','.join(hits)}"
    )
    alarm = Alarm(
        rule_id=rule.id,
        rule_name=rule.name,
        equipment_id=eq.id,
        equipment_name=eq.name,
        equipment_code=eq.code,
        location_name=loc_name,
        alarm_type_code=rule.alarm_type_code,
        alarm_type_name=type_row.name if type_row else rule.alarm_type_code,
        alarm_level=rule.alarm_level,
        alarm_status="pending",
        point_refs=rule.point_refs,
        trigger_value=",".join(hits) if hits else ",".join(values),
        trigger_detail=detail,
        alarm_time=datetime.now(),
        status=1,
        deleted=0,
    )
    db.add(alarm)
    db.flush()
    _log(db, alarm.id, "created", detail="规则引擎自动生成")

    # 一类紧急：自动生成维修工单
    if rule.alarm_level == 1:
        try:
            create_repair_from_alarm(db, alarm, applicant_name="系统(一类自动)")
            _log(db, alarm.id, "auto_repair", detail=f"repair_id={alarm.repair_id}")
        except ValueError as e:
            # 同设备已有在修工单：告警照常记录，工单不重复生成
            _log(db, alarm.id, "auto_repair_skipped", detail=str(e))

    db.commit()
    db.refresh(alarm)

    payload = {
        "id": alarm.id,
        "rule_name": alarm.rule_name,
        "equipment_id": alarm.equipment_id,
        "equipment_name": alarm.equipment_name,
        "alarm_level": alarm.alarm_level,
        "alarm_status": alarm.alarm_status,
        "trigger_value": alarm.trigger_value,
        "alarm_time": alarm.alarm_time.isoformat(),
    }
    alarm_ws_hub.broadcast_threadsafe("alarm.created", payload)
    return alarm


def evaluate_alarms_for_tags(db: Session, tag_names: Optional[set[str]] = None) -> int:
    """评估启用规则。tag_names 非空时可作粗过滤（当前全量评估启用规则，逻辑简单可靠）。"""
    _ = tag_names
    rules = (
        db.query(AlarmRule)
        .filter(
            AlarmRule.deleted == 0,
            AlarmRule.status == 1,
            AlarmRule.enabled == 1,
        )
        .all()
    )
    created = 0
    for rule in rules:
        try:
            alarm = evaluate_rule(db, rule)
            if alarm:
                created += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            continue
    return created
