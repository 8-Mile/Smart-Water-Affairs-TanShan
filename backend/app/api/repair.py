from datetime import datetime, timedelta
from pathlib import Path
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func

from app.core.config import get_settings
from app.core.crud import get_or_404, paginate
from app.core.deps import CurrentUser, DbSession, require_perm, is_mine_scope
from app.core.response import ok
from app.models.repair import RepairActionLog, RepairOrder
from app.models.alarm import Alarm
from app.models.user import User
from app.schemas.repair import (
    RepairAcceptRequest,
    RepairCompleteRequest,
    RepairCreate,
    RepairDispatchRequest,
    RepairRejectRequest,
    RepairStatsOut,
)
from app.services import repair_service as svc

router = APIRouter(prefix="/repairs", tags=["repairs"])

_REPAIR_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def _repair_image_dir() -> Path:
    root = Path(get_settings().upload_dir).resolve() / "repair"
    root.mkdir(parents=True, exist_ok=True)
    return root


@router.post("/upload-image")
async def upload_repair_image(
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """维修完工图片上传（通用）：存 uploads/repair/，返回可访问 URL。"""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _REPAIR_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"仅支持图片格式：{'/'.join(sorted(_REPAIR_IMAGE_EXTS))}")
    content = await file.read()
    max_bytes = (get_settings().upload_max_mb or 50) * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail="图片大小超限")
    fname = f"{uuid.uuid4().hex}{ext}"
    ( _repair_image_dir() / fname ).write_bytes(content)
    return ok({"url": f"/api/v1/repairs/images/{fname}"})


@router.get("/images/{filename}")
def get_repair_image(filename: str):
    """维修完工图片访问。"""
    safe = os.path.basename(filename)
    path = _repair_image_dir() / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(path)


def _equipment_blockers(db, orders: list) -> dict[int, str]:
    """同设备在修互斥：待派单工单若同设备已有其它未归档工单，返回阻塞单号映射。"""
    eq_ids = {o.equipment_id for o in orders if o.equipment_id}
    if not eq_ids:
        return {}
    active = (
        db.query(
            RepairOrder.id,
            RepairOrder.order_no,
            RepairOrder.equipment_id,
            RepairOrder.process_status,
        )
        .filter(
            RepairOrder.deleted == 0,
            RepairOrder.equipment_id.in_(eq_ids),
            RepairOrder.process_status.in_(svc.ACTIVE_STATUSES),
        )
        .order_by(RepairOrder.id.asc())
        .all()
    )
    by_eq: dict[int, list] = {}
    for rid, order_no, eq_id, st in active:
        by_eq.setdefault(eq_id, []).append((rid, order_no, st))
    blockers: dict[int, str] = {}
    for order in orders:
        if order.process_status != svc.STATUS_PENDING or not order.equipment_id:
            continue
        others = [x for x in by_eq.get(order.equipment_id, []) if x[0] != order.id]
        if not others:
            continue
        # 优先展示已进入维修/待验收的单，其次才是更早的待派单
        others.sort(key=lambda x: (x[2] == svc.STATUS_PENDING, x[0]))
        blockers[order.id] = others[0][1]
    return blockers


def _out(db, order: RepairOrder, with_logs: bool = False) -> dict:
    logs = None
    if with_logs:
        logs = (
            db.query(RepairActionLog)
            .filter(RepairActionLog.repair_id == order.id)
            .order_by(RepairActionLog.id.asc())
            .all()
        )
    data = svc.repair_to_dict(order, logs)
    # 关联告警级别（主键单查）：前端据此控制驳回按钮显隐——一/二类紧急告警不允许驳回
    if order.alarm_id:
        data["alarm_level"] = (
            db.query(Alarm.alarm_level)
            .filter(Alarm.id == order.alarm_id, Alarm.deleted == 0)
            .scalar()
        )
    # 指派人员：补充账号名，前端维修人列展示账号名；
    # 不过滤 deleted——已归档工单的维修人即使账号被停用，仍需可辨认
    if order.worker_id:
        w = db.query(User).filter(User.id == order.worker_id).first()
        if w:
            data["worker_username"] = w.username
    # 申请人：同上补充账号名（前端申请人字段展示账号名）
    if order.applicant_id:
        a = db.query(User).filter(User.id == order.applicant_id).first()
        if a:
            data["applicant_username"] = a.username
    # 同设备已有未归档工单：前端据此禁用派单按钮并提示阻塞单号
    blocker = _equipment_blockers(db, [order]).get(order.id)
    if blocker:
        data["equipment_blocker"] = blocker
    return data


def _out_many(db, orders: list) -> list:
    """列表批量序列化（M2 优化）：告警级别/账号名预取映射，替代逐条单查的 N+1。"""
    if not orders:
        return []
    alarm_ids = {o.alarm_id for o in orders if o.alarm_id}
    user_ids = {o.worker_id for o in orders if o.worker_id} | {
        o.applicant_id for o in orders if o.applicant_id
    }
    alarm_levels: dict[int, int] = (
        dict(db.query(Alarm.id, Alarm.alarm_level).filter(Alarm.id.in_(alarm_ids), Alarm.deleted == 0).all())
        if alarm_ids
        else {}
    )
    usernames: dict[int, str] = (
        {u.id: u.username for u in db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()}
        if user_ids
        else {}
    )
    items = []
    blockers = _equipment_blockers(db, orders)
    for order in orders:
        data = svc.repair_to_dict(order, None)
        if order.alarm_id:
            data["alarm_level"] = alarm_levels.get(order.alarm_id)
        if order.worker_id and order.worker_id in usernames:
            data["worker_username"] = usernames[order.worker_id]
        if order.applicant_id and order.applicant_id in usernames:
            data["applicant_username"] = usernames[order.applicant_id]
        if blockers.get(order.id):
            data["equipment_blocker"] = blockers[order.id]
        items.append(data)
    return items


@router.get("/stats")
def repair_stats(db: DbSession, current_user: CurrentUser):
    def cnt(s: str) -> int:
        return scoped().filter(RepairOrder.process_status == s).scalar() or 0

    def scoped():
        q = db.query(func.count(RepairOrder.id)).filter(RepairOrder.deleted == 0)
        # 数据权限收敛：mine 数据范围（操作员）仅统计分配给自己的工单
        if is_mine_scope(db, current_user):
            q = q.filter(RepairOrder.worker_id == current_user.id)
        return q

    total = scoped().scalar() or 0
    return ok(
        RepairStatsOut(
            pending_dispatch=cnt(svc.STATUS_PENDING),
            processing=cnt(svc.STATUS_PROCESSING),
            pending_accept=cnt(svc.STATUS_PENDING_ACCEPT),
            archived=cnt(svc.STATUS_ARCHIVED),
            rejected=cnt(svc.STATUS_REJECTED),
            total=total,
        ).model_dump()
    )


@router.get("/history-stats")
def repair_history_stats(
    db: DbSession,
    current_user: CurrentUser,
    start_date: str = Query(..., description="起始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
):
    """按日期范围统计工单：总数 / 完成率 / 平均处理时长 / 类型分布。

    过滤字段为 created_at（工单创建时间），区间 [start_date 00:00:00, end_date 23:59:59]。
    完成口径：process_status = archived。
    平均处理时长：archived 工单的 (process_end_time - created_at) 均值，单位小时。
    类型分布按 source（alarm=告警转单 / manual=手动报修）+ repair_type 聚合。
    """
    try:
        s = datetime.strptime(start_date, "%Y-%m-%d")
        e = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")

    q = db.query(RepairOrder).filter(
        RepairOrder.deleted == 0,
        RepairOrder.created_at >= s,
        RepairOrder.created_at < e,
    )
    if is_mine_scope(db, current_user):
        q = q.filter(RepairOrder.worker_id == current_user.id)

    total = q.count()
    completed = q.filter(RepairOrder.process_status == svc.STATUS_ARCHIVED).count()
    completion_rate = round(completed / total * 100, 1) if total else 0.0

    # 平均处理时长（小时）
    durations = (
        q.filter(
            RepairOrder.process_status == svc.STATUS_ARCHIVED,
            RepairOrder.process_end_time.isnot(None),
        )
        .with_entities(
            func.strftime("%s", RepairOrder.process_end_time),
            func.strftime("%s", RepairOrder.created_at),
        )
        .all()
    )
    if durations:
        hours = [float(end) - float(st) for end, st in durations if end and st]
        avg_duration = round(sum(hours) / len(hours) / 3600, 1) if hours else 0.0
    else:
        avg_duration = 0.0

    # 类型分布：source + repair_type
    type_rows = (
        q.with_entities(RepairOrder.source, RepairOrder.repair_type, func.count(RepairOrder.id))
        .group_by(RepairOrder.source, RepairOrder.repair_type)
        .all()
    )
    type_label = {"alarm": "告警转单", "manual": "手动报修"}
    repair_label = {"overhaul": "大修", "lubrication": "润滑"}
    by_type = [
        {
            "type": f"{type_label.get(src, src)}/{repair_label.get(rt, rt)}",
            "count": int(cnt),
        }
        for src, rt, cnt in type_rows
    ]
    by_type.sort(key=lambda x: x["count"], reverse=True)

    return ok(
        {
            "total": total,
            "completed": completed,
            "completion_rate": completion_rate,
            "avg_duration_hours": avg_duration,
            "by_type": by_type,
        }
    )


@router.get("")
def list_repairs(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    process_status: str | None = None,
    order_no: str | None = None,
    equipment_name: str | None = None,
    source: str | None = None,
    mine: bool = Query(False, description="仅我的维修任务"),
    stage: str | None = Query(
        None, description="approve|process|accept 快捷过滤"
    ),
    locate_order_no: str | None = Query(
        None, description="跨页定位：按工单号计算所在页码，响应附 located_page"
    ),
):
    q = db.query(RepairOrder).filter(RepairOrder.deleted == 0)
    # 数据权限收敛：mine 数据范围（操作员）仅可见分配给自己的工单
    mine_scope = is_mine_scope(db, current_user)
    if mine_scope:
        q = q.filter(RepairOrder.worker_id == current_user.id)
    if process_status:
        q = q.filter(RepairOrder.process_status == process_status)
    if stage == "approve":
        q = q.filter(RepairOrder.process_status == svc.STATUS_PENDING)
    elif stage == "process":
        q = q.filter(RepairOrder.process_status == svc.STATUS_PROCESSING)
        if mine_scope or mine:
            q = q.filter(RepairOrder.worker_id == current_user.id)
    elif stage == "accept":
        q = q.filter(RepairOrder.process_status == svc.STATUS_PENDING_ACCEPT)
    if order_no:
        q = q.filter(RepairOrder.order_no == order_no)
    if equipment_name:
        q = q.filter(RepairOrder.equipment_name.like(f"%{equipment_name}%"))
    if source:
        q = q.filter(RepairOrder.source == source)
    if mine and stage != "process":
        q = q.filter(
            (RepairOrder.worker_id == current_user.id)
            | (RepairOrder.applicant_id == current_user.id)
        )
    q = q.order_by(RepairOrder.id.desc())
    # 跨页定位：按同一过滤+排序计算目标工单所在页码（1-based），前端据此跳页高亮
    located_page: int | None = None
    if locate_order_no:
        target = q.filter(RepairOrder.order_no == locate_order_no).first()
        if target:
            pos = q.filter(RepairOrder.id >= target.id).count()
            located_page = (pos - 1) // page_size + 1
    result = paginate(q, page, page_size)
    result["items"] = _out_many(db, result["items"])
    result["located_page"] = located_page
    return ok(result)


@router.get("/{repair_id}")
def get_repair(repair_id: int, db: DbSession, current_user: CurrentUser):
    order = get_or_404(db, RepairOrder, repair_id)
    # 与列表口径一致：mine 数据范围仅可见自己指派或自己报修的工单
    if is_mine_scope(db, current_user) and (
        order.worker_id != current_user.id
        and order.applicant_id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看该维修工单",
        )
    return ok(_out(db, order, with_logs=True))


@router.post("")
def create_repair(body: RepairCreate, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("repair:create")),
):
    worker_name = None
    if body.worker_id:
        w = (
            db.query(User)
            .filter(User.id == body.worker_id, User.deleted == 0)
            .first()
        )
        if not w:
            raise HTTPException(status_code=400, detail="维修人员不存在")
        worker_name = w.display_name
    try:
        order = svc.create_manual_repair(
            db,
            equipment_id=body.equipment_id,
            description=body.description,
            repair_type=body.repair_type,
            fault_category=body.fault_category,
            fault_time=body.fault_time,
            worker_id=body.worker_id,
            worker_name=worker_name,
            apply_images=body.apply_images,
            applicant=current_user,
            # 携带巡检记录 id 的创建请求一律视为巡检来源，保证「来源」列准确
            source="inspection"
            if body.inspection_record_id
            else body.source
            if body.source in ("alarm", "inspection", "manual", "maintenance")
            else "manual",
            inspection_record_id=body.inspection_record_id,
        )
        db.commit()
        db.refresh(order)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, order))


@router.post("/{repair_id}/dispatch")
def dispatch(
    repair_id: int,
    body: RepairDispatchRequest,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("repair:dispatch")),
):
    order = get_or_404(db, RepairOrder, repair_id)
    worker = (
        db.query(User)
        .filter(User.id == body.worker_id, User.deleted == 0, User.status == 1)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=400, detail="维修人员不存在")
    try:
        svc.dispatch_repair(
            db, order, worker=worker, approver=current_user, comment=body.comment
        )
        db.commit()
        db.refresh(order)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, order, with_logs=True))


@router.post("/{repair_id}/reject")
def reject(
    repair_id: int,
    body: RepairRejectRequest,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("repair:reject")),
):
    order = get_or_404(db, RepairOrder, repair_id)
    try:
        svc.reject_dispatch(db, order, approver=current_user, comment=body.comment)
        db.commit()
        db.refresh(order)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, order, with_logs=True))


@router.post("/{repair_id}/complete")
def complete(
    repair_id: int,
    body: RepairCompleteRequest,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("repair:process")),
):
    order = get_or_404(db, RepairOrder, repair_id)
    try:
        svc.complete_repair(
            db,
            order,
            worker=current_user,
            feedback=body.feedback,
            images=body.images,
        )
        db.commit()
        db.refresh(order)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, order, with_logs=True))


@router.post("/{repair_id}/accept")
def accept(
    repair_id: int,
    body: RepairAcceptRequest,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("repair:accept")),
):
    order = get_or_404(db, RepairOrder, repair_id)
    try:
        svc.accept_repair(
            db,
            order,
            acceptor=current_user,
            passed=body.pass_accept,
            comment=body.comment,
        )
        db.commit()
        db.refresh(order)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, order, with_logs=True))
