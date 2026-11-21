from datetime import date, datetime, timedelta

from fastapi import Depends, APIRouter, HTTPException, Query
from sqlalchemy import func

from app.core.crud import get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.dispatch import DispatchActionLog, DispatchInstruction
from app.models.user import User
from app.schemas.dispatch import (
    DispatchAuditRequest,
    DispatchCompleteRequest,
    DispatchCreate,
    DispatchStatsOut,
    DispatchUpdate,
)
from app.services import dispatch_service as svc

router = APIRouter(prefix="/dispatches", tags=["dispatches"])


def _out(db, obj: DispatchInstruction, with_logs: bool = False) -> dict:
    logs = None
    if with_logs:
        logs = (
            db.query(DispatchActionLog)
            .filter(DispatchActionLog.instruction_id == obj.id)
            .order_by(DispatchActionLog.id.asc())
            .all()
        )
    return svc.to_dict(obj, logs)


@router.get("/stats")
def stats(db: DbSession, _: CurrentUser):
    today = date.today()
    yesterday = today - timedelta(days=1)
    today_start = datetime.combine(today, datetime.min.time())
    yday_start = datetime.combine(yesterday, datetime.min.time())
    tomorrow = today_start + timedelta(days=1)

    today_count = (
        db.query(func.count(DispatchInstruction.id))
        .filter(
            DispatchInstruction.deleted == 0,
            DispatchInstruction.publish_time >= today_start,
            DispatchInstruction.publish_time < tomorrow,
        )
        .scalar()
        or 0
    )
    yday_count = (
        db.query(func.count(DispatchInstruction.id))
        .filter(
            DispatchInstruction.deleted == 0,
            DispatchInstruction.publish_time >= yday_start,
            DispatchInstruction.publish_time < today_start,
        )
        .scalar()
        or 0
    )
    if yday_count == 0:
        vs = 100.0 if today_count > 0 else 0.0
    else:
        vs = round((today_count - yday_count) / yday_count * 100, 1)

    pending_execute = (
        db.query(func.count(DispatchInstruction.id))
        .filter(
            DispatchInstruction.deleted == 0,
            DispatchInstruction.audit_status == svc.AUDIT_APPROVED,
            DispatchInstruction.execute_status == svc.EXEC_PENDING,
        )
        .scalar()
        or 0
    )
    pending_audit = (
        db.query(func.count(DispatchInstruction.id))
        .filter(
            DispatchInstruction.deleted == 0,
            DispatchInstruction.audit_status == svc.AUDIT_PENDING,
        )
        .scalar()
        or 0
    )
    total = (
        db.query(func.count(DispatchInstruction.id))
        .filter(DispatchInstruction.deleted == 0)
        .scalar()
        or 0
    )
    done = (
        db.query(func.count(DispatchInstruction.id))
        .filter(
            DispatchInstruction.deleted == 0,
            DispatchInstruction.execute_status == svc.EXEC_DONE,
        )
        .scalar()
        or 0
    )
    approved = (
        db.query(func.count(DispatchInstruction.id))
        .filter(
            DispatchInstruction.deleted == 0,
            DispatchInstruction.audit_status == svc.AUDIT_APPROVED,
        )
        .scalar()
        or 0
    )
    rejected = (
        db.query(func.count(DispatchInstruction.id))
        .filter(
            DispatchInstruction.deleted == 0,
            DispatchInstruction.audit_status == svc.AUDIT_REJECTED,
        )
        .scalar()
        or 0
    )
    rate = round(done / total * 100, 1) if total else 0.0

    return ok(
        DispatchStatsOut(
            today_count=today_count,
            today_vs_yesterday=vs,
            pending_execute=pending_execute,
            pending_audit=pending_audit,
            completion_rate=rate,
            total=total,
            approved=approved,
            rejected=rejected,
            done=done,
        ).model_dump()
    )


@router.get("")
def list_dispatches(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    audit_status: str | None = None,
    execute_status: str | None = None,
    instruction_type: str | None = None,
    instruction_code: str | None = None,
    keyword: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    stage: str | None = Query(None, description="stats|audit|task"),
    mine: bool = False,
):
    q = db.query(DispatchInstruction).filter(DispatchInstruction.deleted == 0)

    if stage == "audit":
        q = q.filter(DispatchInstruction.audit_status == svc.AUDIT_PENDING)
    elif stage == "task":
        q = q.filter(
            DispatchInstruction.audit_status == svc.AUDIT_APPROVED,
            DispatchInstruction.execute_status.in_([svc.EXEC_PENDING, svc.EXEC_DONE]),
        )
        if mine or current_user.role_code == "operator":
            q = q.filter(DispatchInstruction.executor_id == current_user.id)

    if audit_status:
        q = q.filter(DispatchInstruction.audit_status == audit_status)
    if execute_status:
        q = q.filter(DispatchInstruction.execute_status == execute_status)
    if instruction_type:
        q = q.filter(DispatchInstruction.instruction_type == instruction_type)
    if instruction_code:
        q = q.filter(DispatchInstruction.instruction_code == instruction_code)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (DispatchInstruction.content.like(like))
            | (DispatchInstruction.instruction_code.like(like))
            | (DispatchInstruction.executor_name.like(like))
        )
    if start_date:
        q = q.filter(
            DispatchInstruction.publish_time
            >= datetime.combine(start_date, datetime.min.time())
        )
    if end_date:
        q = q.filter(
            DispatchInstruction.publish_time
            < datetime.combine(end_date + timedelta(days=1), datetime.min.time())
        )
    if mine and stage != "task":
        q = q.filter(
            (DispatchInstruction.executor_id == current_user.id)
            | (DispatchInstruction.publisher_id == current_user.id)
        )

    q = q.order_by(DispatchInstruction.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_out(db, i) for i in result["items"]]
    return ok(result)


@router.get("/{item_id}")
def get_one(item_id: int, db: DbSession, _: CurrentUser):
    obj = get_or_404(db, DispatchInstruction, item_id)
    return ok(_out(db, obj, with_logs=True))


@router.post("")
def create(body: DispatchCreate, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("dispatch:create")),
):
    executor = (
        db.query(User)
        .filter(User.id == body.executor_id, User.deleted == 0, User.status == 1)
        .first()
    )
    if not executor:
        raise HTTPException(status_code=400, detail="执行人不存在")
    obj = svc.create_instruction(
        db,
        instruction_type=body.instruction_type,
        content=body.content,
        executor=executor,
        expected_finish_time=body.expected_finish_time,
        priority=body.priority,
        publisher=current_user,
    )
    db.commit()
    db.refresh(obj)
    return ok(_out(db, obj, with_logs=True))


@router.put("/{item_id}")
def update(item_id: int, body: DispatchUpdate, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("dispatch:update")),
):
    obj = get_or_404(db, DispatchInstruction, item_id)
    data = body.model_dump(exclude_unset=True)
    if "executor_id" in data:
        executor = (
            db.query(User)
            .filter(User.id == data["executor_id"], User.deleted == 0)
            .first()
        )
        if not executor:
            raise HTTPException(status_code=400, detail="执行人不存在")
        data["executor_name"] = executor.display_name
    try:
        svc.update_instruction(db, obj, **data)
        svc.log_action(db, obj.id, "update", current_user)
        db.commit()
        db.refresh(obj)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, obj, with_logs=True))


@router.delete("/{item_id}")
def delete(item_id: int, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("dispatch:delete")),
):
    obj = get_or_404(db, DispatchInstruction, item_id)
    if obj.audit_status != svc.AUDIT_PENDING:
        raise HTTPException(status_code=400, detail="仅待审批指令可删除")
    soft_delete(db, obj)
    return ok(True)


@router.post("/{item_id}/audit")
def audit(
    item_id: int,
    body: DispatchAuditRequest,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("dispatch:audit")),
):
    obj = get_or_404(db, DispatchInstruction, item_id)
    try:
        svc.audit_instruction(
            db,
            obj,
            passed=body.passed,
            comment=body.comment,
            auditor=current_user,
        )
        db.commit()
        db.refresh(obj)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, obj, with_logs=True))


@router.post("/{item_id}/complete")
def complete(
    item_id: int,
    body: DispatchCompleteRequest,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("dispatch:execute")),
):
    obj = get_or_404(db, DispatchInstruction, item_id)
    try:
        svc.complete_instruction(
            db,
            obj,
            executor=current_user,
            feedback=body.feedback,
        )
        db.commit()
        db.refresh(obj)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_out(db, obj, with_logs=True))
