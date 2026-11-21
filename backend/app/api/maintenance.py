from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_

from app.core.crud import get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.equipment import Equipment
from app.models.maintenance import MaintenancePlan, MaintenanceRecord
from app.models.repair import RepairOrder
from app.models.user import User
from app.schemas.maintenance import (
    MaintenancePlanCreate,
    MaintenancePlanDispatch,
    MaintenancePlanUpdate,
    MaintenanceRecordAccept,
    MaintenanceRecordComplete,
    MaintenanceRecordCreate,
)
from app.services import maintenance_service as svc
from app.services import repair_service

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


def _plan_out(db, p: MaintenancePlan) -> dict:
    eq_ids = svc.get_plan_equipment_ids(db, p.id)
    names = []
    if eq_ids:
        rows = (
            db.query(Equipment)
            .filter(Equipment.id.in_(eq_ids), Equipment.deleted == 0)
            .all()
        )
        names = [r.name for r in rows]
    pending_count = (
        db.query(MaintenanceRecord)
        .filter(
            MaintenanceRecord.plan_id == p.id,
            MaintenanceRecord.record_status == "pending",
            MaintenanceRecord.deleted == 0,
        )
        .count()
    )
    accept_count = (
        db.query(MaintenanceRecord)
        .filter(
            MaintenanceRecord.plan_id == p.id,
            MaintenanceRecord.record_status == "pending_accept",
            MaintenanceRecord.deleted == 0,
        )
        .count()
    )
    # 逾期任务：未开始且已过到期日（计划层警示"到了没做/超时"）
    overdue_count = (
        db.query(MaintenanceRecord)
        .filter(
            MaintenanceRecord.plan_id == p.id,
            MaintenanceRecord.record_status == "pending",
            MaintenanceRecord.due_date < date.today(),
            MaintenanceRecord.deleted == 0,
        )
        .count()
    )
    return {
        "id": p.id,
        "name": p.name,
        "plan_type": p.plan_type,
        "start_date": p.start_date,
        "cycle_days": p.cycle_days,
        "advance_days": p.advance_days,
        "equipment_ids": eq_ids,
        "equipment_names": names,
        "enabled": p.enabled,
        "need_accept": p.need_accept,
        "default_assignee_id": p.default_assignee_id or None,
        "default_assignee_name": p.default_assignee_name,
        "last_dispatch_date": p.last_dispatch_date,
        "pending_count": pending_count,
        "accept_count": accept_count,
        "overdue_count": overdue_count,
        "remark": p.remark,
        "status": p.status,
    }


def _record_out(db: DbSession, r: MaintenanceRecord) -> dict:
    # 维保转维修的记录：反查工单号，前端据此显示「关联工单」跳转按钮。
    # 已驳回工单视为作废（与巡检/告警侧驳回解绑语义一致）：反查时排除，保留追溯
    repair = (
        db.query(RepairOrder)
        .filter(
            RepairOrder.maintenance_record_id == r.id,
            RepairOrder.deleted == 0,
            RepairOrder.process_status != "rejected",
        )
        .order_by(RepairOrder.id.desc())
        .first()
    )
    return {
        "id": r.id,
        "plan_id": r.plan_id,
        "plan_name": r.plan_name,
        "equipment_id": r.equipment_id,
        "equipment_name": r.equipment_name,
        "equipment_code": r.equipment_code,
        "maintain_type": r.maintain_type,
        "record_status": r.record_status,
        "due_date": r.due_date,
        "content": r.content,
        "operator_name": r.operator_name,
        "operate_time": r.operate_time,
        "remark": r.remark,
        "acceptor_name": r.acceptor_name,
        "accept_time": r.accept_time,
        "accept_comment": r.accept_comment,
        "source": r.source,
        "repair_order_no": repair.order_no if repair else None,
    }


# ---- plans ----
@router.get("/plans")
def list_plans(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
):
    q = db.query(MaintenancePlan).filter(MaintenancePlan.deleted == 0)
    if keyword:
        q = q.filter(MaintenancePlan.name.like(f"%{keyword}%"))
    q = q.order_by(MaintenancePlan.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_plan_out(db, i) for i in result["items"]]
    return ok(result)


def _assignee_out(db, assignee_id: int) -> User:
    assignee = (
        db.query(User).filter(User.id == assignee_id, User.deleted == 0).first()
    )
    if not assignee:
        raise HTTPException(status_code=400, detail="指派人员不存在")
    return assignee


@router.post("/plans")
def create_plan(body: MaintenancePlanCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("maint:plan:create")),
):
    if not body.equipment_ids:
        raise HTTPException(status_code=400, detail="请至少关联一台设备")
    assignee = _assignee_out(db, body.default_assignee_id)
    obj = MaintenancePlan(
        name=body.name,
        plan_type=body.plan_type,
        start_date=body.start_date,
        cycle_days=body.cycle_days,
        advance_days=body.advance_days,
        enabled=body.enabled,
        need_accept=body.need_accept,
        default_assignee_id=assignee.id,
        default_assignee_name=assignee.display_name,
        remark=body.remark,
        status=1,
        deleted=0,
    )
    db.add(obj)
    db.flush()
    svc.set_plan_equipments(db, obj.id, body.equipment_ids)
    db.commit()
    db.refresh(obj)
    return ok(_plan_out(db, obj))


@router.put("/plans/{item_id}")
def update_plan(
    item_id: int, body: MaintenancePlanUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("maint:plan:update")),
):
    obj = get_or_404(db, MaintenancePlan, item_id)
    data = body.model_dump(exclude_unset=True)
    eq_ids = data.pop("equipment_ids", None)
    new_assignee_id = data.pop("default_assignee_id", None)
    for k, v in data.items():
        setattr(obj, k, v)
    if new_assignee_id is not None:
        assignee = _assignee_out(db, new_assignee_id)
        obj.default_assignee_id = assignee.id
        obj.default_assignee_name = assignee.display_name
    if eq_ids is not None:
        if not eq_ids:
            raise HTTPException(status_code=400, detail="请至少关联一台设备")
        svc.set_plan_equipments(db, obj.id, eq_ids)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_plan_out(db, obj))


@router.delete("/plans/{item_id}")
def delete_plan(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("maint:plan:delete")),
):
    obj = get_or_404(db, MaintenancePlan, item_id)
    soft_delete(db, obj)
    return ok(True)


@router.post("/plans/{item_id}/dispatch")
def dispatch_plan(
    item_id: int,
    db: DbSession,
    current_user: CurrentUser,
    body: MaintenancePlanDispatch | None = None,
    _perm: None = Depends(require_perm("maint:plan:dispatch")),
):
    plan = get_or_404(db, MaintenancePlan, item_id)
    assignee = None
    if body and body.assignee_id:
        assignee = _assignee_out(db, body.assignee_id)
    created = svc.dispatch_plan(
        db,
        plan,
        source="manual",
        assignee=assignee,
        remark=body.remark if body else None,
        operator=current_user,
    )
    db.commit()
    return ok(
        {"count": len(created), "items": [_record_out(db, r) for r in created]},
        message=f"已派发 {len(created)} 条维保任务",
    )


@router.post("/plans/auto-dispatch")
def auto_dispatch(db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("maint:plan:dispatch")),
):
    n = svc.dispatch_due_plans(db)
    return ok({"created_records": n}, message=f"自动派发完成，生成 {n} 条任务")


# ---- records ----
@router.get("/records")
def list_records(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    maintain_type: str | None = None,
    record_status: str | None = None,
    keyword: str | None = None,
    mine: int = Query(0),
):
    q = db.query(MaintenanceRecord).filter(MaintenanceRecord.deleted == 0)
    # 只看我的：操作员默认视角，仅看指派给自己的维保任务
    if mine:
        q = q.filter(MaintenanceRecord.operator_id == current_user.id)
    if maintain_type:
        q = q.filter(MaintenanceRecord.maintain_type == maintain_type)
    if record_status:
        q = q.filter(MaintenanceRecord.record_status == record_status)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (MaintenanceRecord.equipment_name.like(like))
            | (MaintenanceRecord.equipment_code.like(like))
            | (MaintenanceRecord.plan_name.like(like))
        )
    q = q.order_by(MaintenanceRecord.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_record_out(db, i) for i in result["items"]]
    return ok(result)


@router.post("/records")
def create_record(
    body: MaintenanceRecordCreate, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("maint:record:create")),
):
    try:
        rec = svc.create_manual_record(
            db,
            equipment_id=body.equipment_id,
            maintain_type=body.maintain_type,
            content=body.content,
            operator=current_user,
            remark=body.remark,
        )
        db.commit()
        db.refresh(rec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_record_out(db, rec))


@router.post("/records/{item_id}/complete")
def complete_record(
    item_id: int,
    body: MaintenanceRecordComplete,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("maint:record:complete")),
):
    rec = get_or_404(db, MaintenanceRecord, item_id)
    try:
        # 维保执行中发现异常：自动转维修工单（source=maintenance，maintenance_record_id 建立记录↔工单关联），
        # 单号写入备注，维修单走独立派单/处理/验收闭环
        issue = (body.issue_found or "").strip()
        if issue:
            try:
                order = repair_service.create_manual_repair(
                    db,
                    equipment_id=rec.equipment_id,
                    description=f"【维保转维修】计划：{rec.plan_name or '维保任务'}\n发现问题：{issue}",
                    applicant=current_user,
                    source="maintenance",
                    maintenance_record_id=rec.id,
                )
            except ValueError as e:
                # 设备级互斥：同设备已有在修工单时不重复建单，维保记录照常完成
                order = None
                svc.log_action(
                    db, rec, "to_repair", current_user, detail=f"发现问题：{issue} · {e}"
                )
            if order:
                body.remark = (
                    f"{(body.remark or '').strip()}｜发现异常，已转维修工单 {order.order_no}".strip("｜")
                )
                svc.log_action(
                    db,
                    rec,
                    "to_repair",
                    current_user,
                    detail=f"发现问题：{issue} · 生成维修工单 {order.order_no}",
                )
        svc.complete_record(
            db,
            rec,
            operator=current_user,
            content=body.content,
            remark=body.remark,
        )
        db.commit()
        db.refresh(rec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    # _record_out 反查已能取到刚创建的工单号（驳回单排除语义不影响新单）
    return ok(_record_out(db, rec))


@router.post("/records/{item_id}/accept")
def accept_record(
    item_id: int,
    body: MaintenanceRecordAccept,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("maint:record:accept")),
):
    rec = get_or_404(db, MaintenanceRecord, item_id)
    try:
        svc.accept_record(
            db,
            rec,
            acceptor=current_user,
            passed=body.passed,
            comment=body.comment,
        )
        db.commit()
        db.refresh(rec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_record_out(db, rec), message="验收通过" if body.passed else "已驳回，退回待执行")


@router.delete("/records/{item_id}")
def delete_record(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("maint:record:delete")),
):
    rec = get_or_404(db, MaintenanceRecord, item_id)
    soft_delete(db, rec)
    return ok(True)


# ---- ledger 台账汇总 ----
@router.get("/ledger")
def ledger(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    operate_type: str | None = None,
    keyword: str | None = None,
):
    """聚合维保完成记录 + 已归档维修工单。"""
    items: list[dict] = []

    # 列投影：只取台账所需字段，避免拉取全量 ORM 实体（content/remark 大文本 IO 减半以上）
    mq_rows = (
        db.query(
            MaintenanceRecord.id,
            MaintenanceRecord.equipment_code,
            MaintenanceRecord.equipment_name,
            MaintenanceRecord.maintain_type,
            MaintenanceRecord.operator_name,
            MaintenanceRecord.operate_time,
            MaintenanceRecord.content,
            MaintenanceRecord.remark,
        )
        .filter(
            MaintenanceRecord.deleted == 0,
            MaintenanceRecord.record_status == "done",
        )
    )
    if operate_type in ("overhaul", "lubrication", "检修", "润滑"):
        t = "overhaul" if operate_type in ("overhaul", "检修") else "lubrication"
        mq_rows = mq_rows.filter(MaintenanceRecord.maintain_type == t)
    if keyword:
        like = f"%{keyword}%"
        mq_rows = mq_rows.filter(
            (MaintenanceRecord.equipment_name.like(like))
            | (MaintenanceRecord.equipment_code.like(like))
        )
    for r in mq_rows.order_by(MaintenanceRecord.operate_time.desc()).limit(500).all():
        items.append(
            {
                "id": r.id,
                "equipment_code": r.equipment_code,
                "equipment_name": r.equipment_name,
                "operate_type": "检修" if r.maintain_type == "overhaul" else "润滑",
                "operator_name": r.operator_name,
                "operate_time": r.operate_time,
                "content": r.content,
                "remark": r.remark,
                "source": "maintenance",
            }
        )

    if operate_type in (None, "", "repair", "维修"):
        rq = db.query(
            RepairOrder.id,
            RepairOrder.equipment_code,
            RepairOrder.equipment_name,
            RepairOrder.worker_name,
            RepairOrder.acceptor_name,
            RepairOrder.accept_time,
            RepairOrder.process_end_time,
            RepairOrder.process_feedback,
            RepairOrder.description,
            RepairOrder.accept_comment,
        ).filter(
            RepairOrder.deleted == 0,
            RepairOrder.process_status == "archived",
        )
        if keyword:
            like = f"%{keyword}%"
            rq = rq.filter(
                (RepairOrder.equipment_name.like(like))
                | (RepairOrder.equipment_code.like(like))
            )
        for r in rq.order_by(RepairOrder.accept_time.desc()).limit(500).all():
            items.append(
                {
                    "id": 1000000 + r.id,
                    "equipment_code": r.equipment_code,
                    "equipment_name": r.equipment_name,
                    # 口径：维修来源固定"维修完工"，维保来源取检修/润滑
                    "operate_type": "维修完工",
                    "operator_name": r.worker_name or r.acceptor_name,
                    "operate_time": r.accept_time or r.process_end_time,
                    "content": r.process_feedback or r.description,
                    "remark": r.accept_comment,
                    "source": "repair",
                }
            )

    def sort_key(x: dict):
        t = x.get("operate_time")
        if t is None:
            return datetime.min
        return t

    items.sort(key=sort_key, reverse=True)
    total = len(items)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    start = (page - 1) * page_size
    slice_items = items[start : start + page_size]
    return ok(
        {
            "items": slice_items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    )
