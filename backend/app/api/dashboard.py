"""工作台聚合接口。"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Query
from sqlalchemy import func

from app.core.deps import CurrentUser, DbSession, is_mine_scope
from app.core.response import ok
from app.models.alarm import Alarm
from app.models.equipment import Equipment
from app.models.inspection import InspectionTask
from app.models.maintenance import MaintenanceRecord
from app.models.repair import RepairOrder
from app.models.analytics import EnergyEfficiencyDaily
from app.models.scada import ScadaPoint, ScadaPointLatest, ScadaTagData
from app.models.user import User
from app.scada.simulator import scada_runtime
from app.services.scheduler import ops_scheduler

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _energy_tags(db) -> list[str]:
    """电流类测点 tag 列表（能耗）。"""
    points = (
        db.query(ScadaPoint)
        .filter(
            ScadaPoint.deleted == 0,
            ScadaPoint.status == 1,
            ScadaPoint.unit == "A",
        )
        .all()
    )
    return [p.tag_name for p in points]


def _agg_series(
    db,
    tags: list[str],
    start_ms: int,
    end_ms: int,
    bucket_expr,
) -> dict[tuple[str, str], float]:
    """SQL 端按桶聚合均值，返回 (tag, bucket) -> avg。"""
    if not tags:
        return {}
    rows = (
        db.query(
            ScadaTagData.tag_name,
            bucket_expr.label("bucket"),
            func.avg(ScadaTagData.value_num).label("avg_val"),
        )
        .filter(
            ScadaTagData.tag_name.in_(tags),
            ScadaTagData.ts_ms >= start_ms,
            ScadaTagData.ts_ms < end_ms,
            ScadaTagData.value_num.isnot(None),
        )
        .group_by(ScadaTagData.tag_name, bucket_expr)
        .all()
    )
    return {
        (r.tag_name, r.bucket): float(r.avg_val) for r in rows if r.avg_val is not None
    }


def _energy_trend_by_range(db, range_name: str) -> dict[str, Any]:
    """能耗趋势：day=近24h按小时 / week=近7天按天 / month=近30天按天。"""
    tags = _energy_tags(db)
    now = datetime.now()
    if range_name == "day":
        start = (now - timedelta(hours=23)).replace(minute=0, second=0, microsecond=0)
        bucket_expr = func.concat(
            func.date(func.datetime(ScadaTagData.ts_ms / 1000, "unixepoch", "localtime")),
            " ",
            func.strftime("%H", func.datetime(ScadaTagData.ts_ms / 1000, "unixepoch", "localtime")),
        )
        keys = [
            f"{(start + timedelta(hours=i)).date().isoformat()} {(start + timedelta(hours=i)).strftime('%H')}"
            for i in range(24)
        ]
        labels = [(start + timedelta(hours=i)).strftime("%H:00") for i in range(24)]
    else:
        n = 7 if range_name == "week" else 30
        start_d = date.today() - timedelta(days=n - 1)
        start = datetime.combine(start_d, datetime.min.time())
        bucket_expr = func.date(func.datetime(ScadaTagData.ts_ms / 1000, "unixepoch", "localtime"))
        keys = [(start_d + timedelta(days=i)).isoformat() for i in range(n)]
        labels = [(start_d + timedelta(days=i)).strftime("%m-%d") for i in range(n)]
    end_ms = _ms(now + timedelta(minutes=1))
    agg = _agg_series(db, tags, _ms(start), end_ms, bucket_expr)
    # 多测点求和（总能耗电流）
    data: list[Optional[float]] = []
    for k in keys:
        vals = [agg[(t, k)] for t in tags if (t, k) in agg]
        data.append(round(sum(vals), 1) if vals else None)
    return {
        "labels": labels,
        "data": data,
        "unit": "A",
        "title": "能耗趋势",
        "granularity": range_name,
        "tag_count": len(tags),
    }


def _pump_status(db) -> list[dict[str, Any]]:
    """所有机组（type_id=1 且 unit_no 非空）的运行状态。"""
    rows = (
        db.query(Equipment)
        .filter(
            Equipment.deleted == 0,
            Equipment.status == 1,
            Equipment.type_id == 1,
            Equipment.unit_no.isnot(None),
        )
        .order_by(Equipment.unit_no.asc())
        .all()
    )
    return [
        {
            "label": e.name,
            "name": e.name,
            "equipment_id": e.id,
            "running": e.running_status == "running",
        }
        for e in rows
    ]


def _flow_today(db) -> dict[str, float]:
    """今日累计供水量 / 运行时长 => 平均流量（m³/h）。

    现场无实时流量测点，用能效日表的今日数据推算平均流量。
    进水≈出水（泵站无调蓄），统一返回同一值。
    """
    today = date.today().isoformat()
    row = (
        db.query(
            func.sum(EnergyEfficiencyDaily.water_m3).label("water"),
            func.sum(EnergyEfficiencyDaily.run_hours).label("hours"),
        )
        .filter(
            EnergyEfficiencyDaily.deleted == 0,
            EnergyEfficiencyDaily.stat_date == today,
        )
        .first()
    )
    water = float(row.water or 0)
    hours = float(row.hours or 0)
    flow = round(water / hours, 1) if hours > 0 else 0.0
    return {"inflow": flow, "outflow": flow}


def _water_level_trend_24h(db) -> dict[str, Any]:
    """近 24 小时前池/后池水位双线（按小时均值）。"""
    inflow_tag, outflow_tag = "FJ前池水位", "FJ后池水位"
    now = datetime.now()
    start = (now - timedelta(hours=23)).replace(minute=0, second=0, microsecond=0)
    start_ms, end_ms = _ms(start), _ms(now + timedelta(minutes=1))
    day_expr = func.date(func.datetime(ScadaTagData.ts_ms / 1000, "unixepoch", "localtime"))
    hour_expr = func.strftime("%H", func.datetime(ScadaTagData.ts_ms / 1000, "unixepoch", "localtime"))
    agg = _agg_series(db, [inflow_tag, outflow_tag], start_ms, end_ms, func.concat(day_expr, " ", hour_expr))

    labels: list[str] = []
    inflow: list[Optional[float]] = []
    outflow: list[Optional[float]] = []
    for i in range(24):
        t = start + timedelta(hours=i)
        key = f"{t.date().isoformat()} {t.strftime('%H')}"
        labels.append(t.strftime("%H:00"))
        inflow.append(round(agg[(inflow_tag, key)], 2) if (inflow_tag, key) in agg else None)
        outflow.append(round(agg[(outflow_tag, key)], 2) if (outflow_tag, key) in agg else None)
    return {
        "labels": labels,
        "series": [
            {"name": "前池水位", "data": inflow},
            {"name": "后池水位", "data": outflow},
        ],
        "unit": "m",
        "title": "前后池水位趋势（24小时）",
    }


def _inspection_rate(db) -> dict[str, Any]:
    """巡检任务完成率统计。"""
    rows = (
        db.query(InspectionTask.task_status, func.count(InspectionTask.id))
        .filter(InspectionTask.deleted == 0)
        .group_by(InspectionTask.task_status)
        .all()
    )
    stat = {r[0]: int(r[1]) for r in rows}
    done = stat.get("done", 0)
    doing = stat.get("pending", 0)
    todo = stat.get("overdue", 0)
    total = done + doing + todo
    return {
        "done": done,
        "doing": doing,
        "todo": todo,
        "rate": round(done / total * 100) if total else 0,
    }


@router.get("/overview")
def overview(
    db: DbSession,
    current_user: CurrentUser,
):
    # 角色界面矩阵（2026-10-20 终版）：scope 两态——
    # mine=仅本人数据（操作员，由角色 data_scope 驱动）；all=全局总览（领导/超管同一视图）
    is_op = is_mine_scope(db, current_user)
    scope = "mine" if is_op else "all"
    my_id = current_user.id

    # 活跃告警：告警数 / 涉及设备数
    active_alarm_q = db.query(Alarm).filter(
        Alarm.deleted == 0,
        Alarm.alarm_status.in_(["pending", "processing", "pending_accept"]),
    )
    if is_op:
        active_alarm_q = active_alarm_q.filter(Alarm.assignee_id == my_id)
    active_alarms = active_alarm_q.count()

    pending_repairs_q = db.query(func.count(RepairOrder.id)).filter(
        RepairOrder.deleted == 0,
        RepairOrder.process_status.in_(["pending_dispatch", "processing", "pending_accept"]),
    )
    if is_op:
        pending_repairs_q = pending_repairs_q.filter(RepairOrder.worker_id == my_id)
    pending_repairs = pending_repairs_q.scalar() or 0

    # 待检修设备：未闭环维修工单涉及的去重设备台数（与设备台账"检修状态"派生口径一致）
    repair_equip_q = db.query(RepairOrder.equipment_id).filter(
        RepairOrder.deleted == 0,
        RepairOrder.status == 1,
        RepairOrder.process_status.in_(
            ["pending_dispatch", "dispatched", "processing", "pending_accept"]
        ),
        RepairOrder.equipment_id.isnot(None),
    )
    if is_op:
        repair_equip_q = repair_equip_q.filter(RepairOrder.worker_id == my_id)
    pending_repair_equipments = repair_equip_q.distinct().count()

    pending_insp_q = db.query(func.count(InspectionTask.id)).filter(
        InspectionTask.deleted == 0,
        InspectionTask.task_status.in_(["pending", "overdue"]),
    )
    if is_op:
        pending_insp_q = pending_insp_q.filter(InspectionTask.assignee_id == my_id)
    pending_insp = pending_insp_q.scalar() or 0

    # 我的待办维保：操作员 KPI 卡计数（pending=待执行）
    pending_maint = 0
    if is_op:
        pending_maint = (
            db.query(func.count(MaintenanceRecord.id))
            .filter(
                MaintenanceRecord.deleted == 0,
                MaintenanceRecord.record_status == "pending",
                MaintenanceRecord.operator_id == my_id,
            )
            .scalar()
            or 0
        )

    # 待办列表
    repair_todos_q = db.query(RepairOrder).filter(
        RepairOrder.deleted == 0,
        RepairOrder.process_status.in_(
            ["pending_dispatch", "processing", "pending_accept"]
        ),
    )
    if is_op:
        repair_todos_q = repair_todos_q.filter(RepairOrder.worker_id == my_id)
    repair_todos = repair_todos_q.order_by(RepairOrder.id.desc()).limit(8).all()

    alarm_todos_q = db.query(Alarm).filter(
        Alarm.deleted == 0,
        Alarm.alarm_status.in_(["pending", "processing", "pending_accept"]),
    )
    if is_op:
        alarm_todos_q = alarm_todos_q.filter(Alarm.assignee_id == my_id)
    alarm_todos = alarm_todos_q.order_by(Alarm.alarm_time.desc()).limit(8).all()

    insp_todos_q = db.query(InspectionTask).filter(
        InspectionTask.deleted == 0,
        InspectionTask.task_status.in_(["pending", "overdue"]),
    )
    if is_op:
        insp_todos_q = insp_todos_q.filter(InspectionTask.assignee_id == my_id)
    insp_todos = insp_todos_q.order_by(InspectionTask.task_date.asc()).limit(8).all()

    # 我的待办维保列表（仅操作员；全局视图无维保面板）
    maint_todos = []
    if is_op:
        maint_todos = (
            db.query(MaintenanceRecord)
            .filter(
                MaintenanceRecord.deleted == 0,
                MaintenanceRecord.record_status == "pending",
                MaintenanceRecord.operator_id == my_id,
            )
            .order_by(MaintenanceRecord.id.desc())
            .limit(8)
            .all()
        )

    me = db.query(User).filter(User.deleted == 0).count()

    # 首页效果图新增：泵状态 / 实时流量 / 今日告警 / 24h流量 / 巡检率 / 值班
    pumps = _pump_status(db)
    flow_now = _flow_today(db)
    today_str = date.today().isoformat()
    today_alarm_count = (
        db.query(func.count(Alarm.id))
        .filter(Alarm.deleted == 0, Alarm.alarm_time >= today_str)
        .scalar()
        or 0
    )
    return ok(
        {
            "scope": scope,
            "pumps": pumps,
            "flow_now": {
                "inflow": flow_now["inflow"],
                "outflow": flow_now["outflow"],
                "unit": "m³/h",
            },
            "today_alarm_count": today_alarm_count,
            "flow_trend_24h": _water_level_trend_24h(db),
            "energy_trend": _energy_trend_by_range(db, "day"),
            "inspection_rate": _inspection_rate(db),
            "todos": {
                "repairs": [
                    {
                        "id": r.id,
                        "order_no": r.order_no,
                        "name": r.name,
                        "equipment_name": r.equipment_name,
                        "process_status": r.process_status,
                        "worker_name": r.worker_name,
                        "apply_time": r.apply_time,
                        "source": r.source,
                        "repair_type": r.repair_type,
                    }
                    for r in repair_todos
                ],
                "alarms": [
                    {
                        "id": a.id,
                        "rule_name": a.rule_name,
                        "equipment_name": a.equipment_name,
                        "alarm_level": a.alarm_level,
                        "alarm_status": a.alarm_status,
                        "alarm_time": a.alarm_time,
                        "trigger_value": a.trigger_value,
                    }
                    for a in alarm_todos
                ],
                "inspections": [
                    {
                        "id": t.id,
                        "plan_name": t.plan_name,
                        "team_name": t.team_name,
                        "task_date": t.task_date,
                        "task_status": t.task_status,
                    }
                    for t in insp_todos
                ],
                "maintenances": [
                    {
                        "id": m.id,
                        "plan_name": m.plan_name,
                        "equipment_name": m.equipment_name,
                        "maintain_type": m.maintain_type,
                        "due_date": m.due_date,
                        "operator_name": m.operator_name,
                    }
                    for m in maint_todos
                ],
            },
            "counts": {
                "pending_repairs": pending_repairs,
                "pending_repair_equipments": pending_repair_equipments,
                "pending_inspections": pending_insp,
                "pending_maintenances": pending_maint,
                "active_alarms": active_alarms,
            },
            "system": {
                "scada": scada_runtime.status(),
                "scheduler": ops_scheduler.status(),
                "user_count": me,
            },
        }
    )


@router.get("/equipment-ops")
def equipment_ops_profile(
    db: DbSession,
    _: CurrentUser,
    equipment_id: int = Query(..., ge=1),
):
    """设备运维画像（工作台机组卡弹窗第三段）：未闭环工单/告警计数 + 维保日程。

    巡检模型无 equipment_id（任务/记录均挂在计划-班组维度），无法按设备反查，不纳入画像。
    告警/工单已挂到子设备，统计时需包含子设备。
    """
    child_ids = [
        r[0]
        for r in db.query(Equipment.id).filter(
            Equipment.parent_id == equipment_id, Equipment.deleted == 0
        ).all()
    ]
    eq_ids = [equipment_id] + child_ids

    open_repairs = (
        db.query(func.count(RepairOrder.id))
        .filter(
            RepairOrder.deleted == 0,
            RepairOrder.equipment_id.in_(eq_ids),
            RepairOrder.process_status.in_(
                ["pending_dispatch", "processing", "pending_accept"]
            ),
        )
        .scalar()
        or 0
    )
    open_alarms = (
        db.query(func.count(Alarm.id))
        .filter(
            Alarm.deleted == 0,
            Alarm.equipment_id.in_(eq_ids),
            Alarm.alarm_status.in_(
                ["pending", "processing", "pending_accept", "reopened"]
            ),
        )
        .scalar()
        or 0
    )
    next_maint = (
        db.query(func.min(MaintenanceRecord.due_date))
        .filter(
            MaintenanceRecord.deleted == 0,
            MaintenanceRecord.equipment_id == equipment_id,
            MaintenanceRecord.record_status.in_(["pending", "pending_accept"]),
            MaintenanceRecord.due_date.isnot(None),
        )
        .scalar()
    )
    last_maint = (
        db.query(func.max(MaintenanceRecord.operate_time))
        .filter(
            MaintenanceRecord.deleted == 0,
            MaintenanceRecord.equipment_id == equipment_id,
            MaintenanceRecord.record_status.in_(["pending_accept", "done"]),
            MaintenanceRecord.operate_time.isnot(None),
        )
        .scalar()
    )
    return ok(
        {
            "open_repairs": open_repairs,
            "open_alarms": open_alarms,
            "next_maintenance_date": next_maint,
            "last_maintenance_at": last_maint,
        }
    )


@router.get("/energy-trend")
def energy_trend_api(
    db: DbSession,
    _: CurrentUser,
    range_name: str = Query("day", alias="range", pattern="^(day|week|month)$"),
):
    """能耗趋势：day=24h按小时 / week=7天按天 / month=30天按天。"""
    return ok(_energy_trend_by_range(db, range_name))
