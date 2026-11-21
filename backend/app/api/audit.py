"""操作日志查询：系统操作日志 + 业务流转日志。"""

import re
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from sqlalchemy import or_

from app.core.crud import paginate
from app.core.deps import DbSession, require_perm
from app.core.middleware import MODULE_PREFIXES, resolve_module
from app.core.response import ok
from app.models.alarm import Alarm, AlarmActionLog, AlarmRule, AlarmType
from app.models.archive import Archive, ArchiveCategory, OperationLog
from app.models.equipment import Equipment, EquipmentType, MaintenanceVendor, Manufacturer
from app.models.inspection import (
    InspectionActionLog,
    InspectionPlan,
    InspectionRecord,
    InspectionTask,
)
from app.models.maintenance import MaintActionLog, MaintenancePlan, MaintenanceRecord
from app.models.notification import Notification
from app.models.org import Department, Location, Team, Unit
from app.models.rbac import Menu, Role
from app.models.repair import RepairActionLog, RepairOrder
from app.models.user import User

router = APIRouter(prefix="/audit", tags=["audit"])

_LOG_PERM = "sys:log:list"

# 历史日志 detail 形如 `模块 · 动作 · #164`，查询时去掉无意义的内部 ID
_ID_SUFFIX = re.compile(r"\s*·\s*#\d+$")

# 路径 → 业务对象：[(prefix, 资源段) ...] → (模型, 展示字段, 对象名)
# 资源段为 None 表示该模块下的一级资源（如 /repairs/{id}）
_TARGET_RULES: dict[tuple[str, str | None], tuple[type, tuple[str, ...], str]] = {
    ("repairs", None): (RepairOrder, ("order_no", "name"), "维修工单"),
    ("alarms", "types"): (AlarmType, ("name",), "告警类型"),
    ("alarms", "rules"): (AlarmRule, ("name",), "告警规则"),
    ("alarms", None): (Alarm, ("equipment_name", "alarm_type_name"), "告警"),
    ("equipment", "equipment"): (Equipment, ("name", "code"), "设备"),
    ("equipment", "equipment-types"): (EquipmentType, ("name",), "设备类型"),
    ("equipment", "manufacturers"): (Manufacturer, ("name",), "生产厂商"),
    ("equipment", "maintenance-vendors"): (MaintenanceVendor, ("name",), "维保厂商"),
    ("maintenance", "plans"): (MaintenancePlan, ("name",), "维保计划"),
    ("maintenance", "records"): (
        MaintenanceRecord,
        ("equipment_name", "plan_name"),
        "维保记录",
    ),
    ("inspections", "plans"): (InspectionPlan, ("name",), "巡检计划"),
    ("inspections", "tasks"): (InspectionTask, ("plan_name", "task_date"), "巡检任务"),
    ("inspections", "records"): (
        InspectionRecord,
        ("plan_name", "record_date"),
        "巡检记录",
    ),
    ("archives", "categories"): (ArchiveCategory, ("name",), "档案分类"),
    ("archives", None): (Archive, ("name", "archive_no"), "档案"),
    ("notifications", None): (Notification, ("title",), "消息"),
    ("system", "users"): (User, ("display_name", "username"), "用户"),
    ("system", "roles"): (Role, ("name",), "角色"),
    ("system", "menus"): (Menu, ("name",), "菜单"),
    ("system", "departments"): (Department, ("name",), "部门"),
    ("system", "teams"): (Team, ("name",), "班组"),
    ("system", "locations"): (Location, ("name",), "位置"),
    ("system", "units"): (Unit, ("name",), "机组"),
}


def _parse_boundary(value: str, end: bool = False) -> datetime:
    """把 `YYYY-MM-DD` 或 ISO 时间解析为查询边界；仅日期时 end 取当日 23:59:59。"""
    text = value.strip()
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        dt = datetime.strptime(text, "%Y-%m-%d")
    if end and len(text) == 10:
        dt = dt.replace(hour=23, minute=59, second=59)
    return dt


def _path_segments(path: str) -> list[str]:
    return [s for s in path.split("?")[0].split("/") if s and s not in ("api", "v1")]


def _resolve_target(
    db: DbSession, path: str, cache: dict[tuple[str, int], str | None]
) -> str | None:
    """按请求路径中的对象 ID 反查业务对象名称，供「操作内容」展示。"""
    segments = _path_segments(path)
    if len(segments) < 2:
        return None
    prefix = segments[0]
    rest = segments[1:]
    resource = rest[0] if rest and not rest[0].isdigit() else None
    obj_id = next((int(s) for s in rest if s.isdigit()), None)
    if obj_id is None:
        return None
    rule = _TARGET_RULES.get((prefix, resource)) or _TARGET_RULES.get((prefix, None))
    if not rule:
        return None
    model, fields, _label = rule
    key = (model.__tablename__, obj_id)
    if key in cache:
        return cache[key]
    obj = db.get(model, obj_id)
    name = None
    if obj is not None:
        parts = [str(v) for v in (getattr(obj, f, None) for f in fields) if v]
        name = " · ".join(parts) or None
    cache[key] = name
    return name


def _decorate_detail(
    db: DbSession, log: OperationLog, cache: dict[tuple[str, int], str | None]
) -> str | None:
    """把历史 `#ID` 后缀去掉，并追加业务对象名称。"""
    base = _ID_SUFFIX.sub("", log.detail or "").strip()
    if not base:
        base = resolve_module(log.path) or ""
    name = _resolve_target(db, log.path, cache)
    if name:
        return f"{base} · {name}" if base else name
    return base or None


@router.get("/options")
def audit_options(_: User = Depends(require_perm(_LOG_PERM))):
    """筛选下拉选项：模块与 HTTP 方法。"""
    return ok(
        {
            "modules": [name for _, name in MODULE_PREFIXES],
            "methods": ["POST", "PUT", "PATCH", "DELETE"],
        }
    )


@router.get("/operation-logs")
def list_logs(
    db: DbSession,
    _: User = Depends(require_perm(_LOG_PERM)),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    username: str | None = None,
    path: str | None = None,
    method: str | None = None,
    module: str | None = None,
    result: str | None = Query(None, pattern="^(success|failed)$"),
    date_from: str | None = None,
    date_to: str | None = None,
):
    q = db.query(OperationLog)
    if username:
        q = q.filter(OperationLog.username.like(f"%{username}%"))
    if path:
        q = q.filter(OperationLog.path.like(f"%{path}%"))
    if method:
        q = q.filter(OperationLog.method == method.upper())
    if module:
        prefixes = [p for p, name in MODULE_PREFIXES if name == module]
        if prefixes:
            q = q.filter(or_(*[OperationLog.path.startswith(p) for p in prefixes]))
        else:
            q = q.filter(OperationLog.id == -1)
    if result == "success":
        q = q.filter(OperationLog.status_code < 400)
    elif result == "failed":
        q = q.filter(OperationLog.status_code >= 400)
    if date_from:
        q = q.filter(OperationLog.created_at >= _parse_boundary(date_from))
    if date_to:
        q = q.filter(OperationLog.created_at <= _parse_boundary(date_to, end=True))

    q = q.order_by(OperationLog.id.desc())
    data = paginate(q, page, page_size)
    cache: dict[tuple[str, int], str | None] = {}
    data["items"] = [
        {
            "id": i.id,
            "user_id": i.user_id,
            "username": i.username,
            "module": resolve_module(i.path),
            "method": i.method,
            "path": i.path,
            "status_code": i.status_code,
            "ip": i.ip,
            "user_agent": i.user_agent,
            "duration_ms": i.duration_ms,
            "detail": _decorate_detail(db, i, cache),
            "created_at": i.created_at,
        }
        for i in data["items"]
    ]
    return ok(data)


def _biz_rows_inspection(db: DbSession, operator, date_from, date_to) -> list[dict]:
    q = db.query(InspectionActionLog)
    if operator:
        q = q.filter(InspectionActionLog.operator_name.like(f"%{operator}%"))
    if date_from:
        q = q.filter(InspectionActionLog.created_at >= _parse_boundary(date_from))
    if date_to:
        q = q.filter(InspectionActionLog.created_at <= _parse_boundary(date_to, end=True))
    logs = q.all()
    if not logs:
        return []

    task_ids = {x.task_id for x in logs if x.task_id}
    record_ids = {x.record_id for x in logs if x.record_id}
    tasks = (
        {t.id: t for t in db.query(InspectionTask).filter(InspectionTask.id.in_(task_ids)).all()}
        if task_ids
        else {}
    )
    records = (
        {
            r.id: r
            for r in db.query(InspectionRecord)
            .filter(InspectionRecord.id.in_(record_ids))
            .all()
        }
        if record_ids
        else {}
    )

    rows: list[dict] = []
    for log in logs:
        task = tasks.get(log.task_id) if log.task_id else None
        record = records.get(log.record_id) if log.record_id else None
        if task:
            biz_no = f"XJ-{task.id}"
            title = " · ".join(x for x in (task.plan_name, str(task.task_date)) if x)
        elif record:
            biz_no = f"XJ-{record.id}"
            title = " · ".join(x for x in (record.plan_name, str(record.record_date)) if x)
        else:
            biz_no = f"XJ-{log.task_id or log.record_id or log.id}"
            title = None
        rows.append(
            {
                "id": log.id,
                "biz_type": "inspection",
                "biz_id": log.task_id or log.record_id,
                "biz_no": biz_no,
                "biz_title": title,
                "action": log.action,
                "operator_name": log.operator_name,
                "detail": log.detail,
                "created_at": log.created_at,
            }
        )
    return rows


def _biz_rows_maintenance(db: DbSession, operator, date_from, date_to) -> list[dict]:
    q = db.query(MaintActionLog)
    if operator:
        q = q.filter(MaintActionLog.operator_name.like(f"%{operator}%"))
    if date_from:
        q = q.filter(MaintActionLog.created_at >= _parse_boundary(date_from))
    if date_to:
        q = q.filter(MaintActionLog.created_at <= _parse_boundary(date_to, end=True))
    logs = q.all()
    if not logs:
        return []

    record_ids = {x.record_id for x in logs if x.record_id}
    plan_ids = {x.plan_id for x in logs if x.plan_id}
    records = (
        {
            r.id: r
            for r in db.query(MaintenanceRecord)
            .filter(MaintenanceRecord.id.in_(record_ids))
            .all()
        }
        if record_ids
        else {}
    )
    plans = (
        {p.id: p for p in db.query(MaintenancePlan).filter(MaintenancePlan.id.in_(plan_ids)).all()}
        if plan_ids
        else {}
    )

    rows: list[dict] = []
    for log in logs:
        record = records.get(log.record_id) if log.record_id else None
        plan = plans.get(log.plan_id) if log.plan_id else None
        if record:
            biz_no = f"WB-{record.id}"
            title = " · ".join(
                x for x in (record.equipment_name, record.plan_name) if x
            )
        elif plan:
            biz_no = f"WB-P{plan.id}"
            title = plan.name
        else:
            biz_no = f"WB-{log.record_id or log.id}"
            title = None
        rows.append(
            {
                "id": log.id,
                "biz_type": "maintenance",
                "biz_id": log.record_id or log.plan_id,
                "biz_no": biz_no,
                "biz_title": title,
                "action": log.action,
                "operator_name": log.operator_name,
                "detail": log.detail,
                "created_at": log.created_at,
            }
        )
    return rows


@router.get("/business-logs")
def list_business_logs(
    db: DbSession,
    _: User = Depends(require_perm(_LOG_PERM)),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    biz_type: str = Query(
        "all", pattern="^(all|alarm|repair|inspection|maintenance)$"
    ),
    operator: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    """告警 / 维修 / 巡检 / 维保的业务流转动作聚合（按时间倒序合并分页）。"""
    rows: list[dict] = []

    if biz_type in ("all", "alarm"):
        q = db.query(AlarmActionLog, Alarm).join(
            Alarm, Alarm.id == AlarmActionLog.alarm_id, isouter=True
        )
        if operator:
            q = q.filter(AlarmActionLog.operator_name.like(f"%{operator}%"))
        if date_from:
            q = q.filter(AlarmActionLog.created_at >= _parse_boundary(date_from))
        if date_to:
            q = q.filter(AlarmActionLog.created_at <= _parse_boundary(date_to, end=True))
        for log, alarm in q.all():
            rows.append(
                {
                    "id": log.id,
                    "biz_type": "alarm",
                    "biz_id": log.alarm_id,
                    "biz_no": f"AL-{log.alarm_id}",
                    "biz_title": " / ".join(
                        x for x in (alarm.equipment_name, alarm.alarm_type_name) if x
                    )
                    if alarm
                    else None,
                    "action": log.action,
                    "operator_name": log.operator_name,
                    "detail": log.detail,
                    "created_at": log.created_at,
                }
            )

    if biz_type in ("all", "repair"):
        q = db.query(RepairActionLog, RepairOrder).join(
            RepairOrder, RepairOrder.id == RepairActionLog.repair_id, isouter=True
        )
        if operator:
            q = q.filter(RepairActionLog.operator_name.like(f"%{operator}%"))
        if date_from:
            q = q.filter(RepairActionLog.created_at >= _parse_boundary(date_from))
        if date_to:
            q = q.filter(RepairActionLog.created_at <= _parse_boundary(date_to, end=True))
        for log, order in q.all():
            rows.append(
                {
                    "id": log.id,
                    "biz_type": "repair",
                    "biz_id": log.repair_id,
                    "biz_no": order.order_no if order else f"RP-{log.repair_id}",
                    "biz_title": order.name if order else None,
                    "action": log.action,
                    "operator_name": log.operator_name,
                    "detail": log.detail,
                    "created_at": log.created_at,
                }
            )

    if biz_type in ("all", "inspection"):
        rows.extend(_biz_rows_inspection(db, operator, date_from, date_to))

    if biz_type in ("all", "maintenance"):
        rows.extend(_biz_rows_maintenance(db, operator, date_from, date_to))

    rows.sort(key=lambda r: (r["created_at"], r["id"]), reverse=True)
    total = len(rows)
    start = (page - 1) * page_size
    return ok(
        {
            "items": rows[start : start + page_size],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    )
