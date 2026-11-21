import json
import re
from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_

from app.core.crud import get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.inspection import (
    InspectionActionLog,
    InspectionPlan,
    InspectionRecord,
    InspectionTask,
)
from app.models.org import Team
from app.models.repair import RepairOrder
from app.models.user import User
from app.schemas.inspection import (
    InspectionPlanCreate,
    InspectionPlanUpdate,
    InspectionRecordCreate,
    InspectionTaskComplete,
    InspectionTaskDispatch,
)
from app.services import inspection_service as svc

router = APIRouter(prefix="/inspections", tags=["inspections"])


def _is_manager(user: User) -> bool:
    """超管/领导看全部；操作员按班组+本人收敛数据权限。"""
    return user.role_code in ("super_admin", "admin")


def _plan_out(p: InspectionPlan) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "team_id": p.team_id,
        "team_name": p.team_name,
        "start_date": p.start_date,
        "end_date": p.end_date,
        "frequency": p.frequency,
        "items": svc.parse_items(p.items_json),
        "enabled": p.enabled,
        "last_dispatch_date": p.last_dispatch_date,
        "remark": p.remark,
        "status": p.status,
    }


def _normalize_results(raw_json: str | None) -> list[dict] | None:
    """统一 results 输出结构：历史 name → check_item，缺省 equipment_* 置 None。

    保留完整的 scada_snapshot（list）供前端历史详情渲染；
    旧 inspection_record 无此字段时输出空数组，前端可直接渲染无需判空。
    """
    if not raw_json:
        return None
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    return [
        {
            "equipment_id": x.get("equipment_id"),
            "equipment_name": x.get("equipment_name"),
            "check_item": x.get("check_item") or x.get("name") or "",
            "result": x.get("result") or "normal",
            "remark": x.get("remark") or "",
            "photo": x.get("photo") or "",
            "scada_snapshot": x.get("scada_snapshot") or [],
        }
        for x in data
        if isinstance(x, dict)
    ]


def _task_out(t: InspectionTask) -> dict:
    return {
        "id": t.id,
        "plan_id": t.plan_id,
        "plan_name": t.plan_name,
        "team_id": t.team_id,
        "team_name": t.team_name,
        "task_date": t.task_date,
        "task_status": t.task_status,
        "items": svc.parse_items(t.items_json),
        "results": _normalize_results(t.results_json),
        "assignee_id": t.assignee_id,
        "assignee_name": t.assignee_name,
        "executor_name": t.executor_name,
        "execute_time": t.execute_time,
        "source": t.source,
    }


# 存量摘要按英文结果码拼接（如 "泵1·温度:abnormal"），输出前统一转中文标签
_LEGACY_RESULT_CODE = re.compile(r":\s*(normal|abnormal)\b", re.IGNORECASE)


def _format_items_summary(summary: str | None) -> str | None:
    if not summary:
        return summary
    return _LEGACY_RESULT_CODE.sub(
        lambda m: ":异常" if m.group(1).lower() == "abnormal" else ":正常",
        summary,
    )


def _record_out(db: DbSession, r: InspectionRecord) -> dict:
    # 计划选择的设备集合：巡检异常发起工单时，设备下拉限定为该记录对应巡检计划所选设备
    equipment_ids: list[int] = []
    if r.plan_id:
        plan = (
            db.query(InspectionPlan)
            .filter(InspectionPlan.id == r.plan_id, InspectionPlan.deleted == 0)
            .first()
        )
        for it in svc.parse_items(plan.items_json if plan else None):
            eid = it.get("equipment_id")
            if eid and int(eid) not in equipment_ids:
                equipment_ids.append(int(eid))
    # 已发起维修工单的记录：反查工单号，前端据此把「发起工单」切换为「关联工单」。
    # 已驳回工单视为作废（与告警侧驳回解绑语义一致）：不解除字段关联、保留追溯，
    # 反查时排除，记录页重新显示「发起工单」，新单创建后自然指向最新有效单
    repair = (
        db.query(RepairOrder)
        .filter(
            RepairOrder.inspection_record_id == r.id,
            RepairOrder.deleted == 0,
            RepairOrder.process_status != "rejected",
        )
        .order_by(RepairOrder.id.desc())
        .first()
    )
    # 无有效单但存在被驳回单：返回最近一次的驳回信息，前端重新发起时提示
    rejected = None
    if not repair:
        rejected = (
            db.query(RepairOrder)
            .filter(
                RepairOrder.inspection_record_id == r.id,
                RepairOrder.deleted == 0,
                RepairOrder.process_status == "rejected",
            )
            .order_by(RepairOrder.id.desc())
            .first()
        )
    return {
        "id": r.id,
        "task_id": r.task_id,
        "plan_id": r.plan_id,
        "plan_name": r.plan_name,
        "team_name": r.team_name,
        "record_date": r.record_date,
        "items_summary": _format_items_summary(r.items_summary),
        "has_abnormal": r.has_abnormal,
        "executor_name": r.executor_name,
        "remark": r.remark,
        "results": _normalize_results(r.results_json),
        "equipment_ids": equipment_ids,
        "repair_order_no": repair.order_no if repair else None,
        "rejected_order_no": rejected.order_no if rejected else None,
        "rejected_comment": rejected.approve_comment if rejected else None,
    }


# ---- plans ----
@router.get("/plans")
def list_plans(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    start_date_from: date_cls | None = None,
    start_date_to: date_cls | None = None,
):
    q = db.query(InspectionPlan).filter(InspectionPlan.deleted == 0)
    # 数据权限：操作员仅可见本班组计划（无班组则结果为空）
    if not _is_manager(current_user):
        q = q.filter(InspectionPlan.team_id == current_user.team_id)
    if keyword:
        q = q.filter(InspectionPlan.name.like(f"%{keyword}%"))
    # 起止时间筛选：与计划周期有交集即命中（所选区间内处于执行期的计划）
    if start_date_from is not None:
        q = q.filter(InspectionPlan.end_date >= start_date_from)
    if start_date_to is not None:
        q = q.filter(InspectionPlan.start_date <= start_date_to)
    q = q.order_by(InspectionPlan.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_plan_out(i) for i in result["items"]]
    return ok(result)


@router.post("/plans")
def create_plan(
    body: InspectionPlanCreate,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("insp:plan:create")),
):
    team = get_or_404(db, Team, body.team_id)
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="结束日期不能早于开始日期")
    obj = InspectionPlan(
        name=body.name,
        team_id=body.team_id,
        team_name=team.name,
        start_date=body.start_date,
        end_date=body.end_date,
        frequency=body.frequency,
        items_json=svc.dump_items(body.items),
        enabled=body.enabled,
        remark=body.remark,
        status=1,
        deleted=0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    # 创建当日若已在执行周期内，立即生成首期任务并通知班组——不等调度器 tick，
    # 班组人员建完计划即可看到待抢单（create_task_from_plan 幂等，不会与调度器重复生成）
    today = date_cls.today()
    if svc.should_dispatch_today(obj, today):
        svc.create_task_from_plan(db, obj, today, source="plan", operator=current_user)
        db.commit()
    return ok(_plan_out(obj))


@router.put("/plans/{item_id}")
def update_plan(
    item_id: int,
    body: InspectionPlanUpdate,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("insp:plan:update")),
):
    obj = get_or_404(db, InspectionPlan, item_id)
    data = body.model_dump(exclude_unset=True)
    items = data.pop("items", None)
    if "team_id" in data:
        team = get_or_404(db, Team, data["team_id"])
        obj.team_name = team.name
    for k, v in data.items():
        setattr(obj, k, v)
    if items is not None:
        obj.items_json = svc.dump_items(items)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_plan_out(obj))


@router.delete("/plans/{item_id}")
def delete_plan(
    item_id: int,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("insp:plan:delete")),
):
    obj = get_or_404(db, InspectionPlan, item_id)
    soft_delete(db, obj)
    return ok(True)


@router.post("/plans/{item_id}/dispatch")
def dispatch_plan(
    item_id: int,
    db: DbSession,
    current_user: CurrentUser,
    body: InspectionTaskDispatch | None = None,
    _perm: None = Depends(require_perm("insp:task:create")),
):
    plan = get_or_404(db, InspectionPlan, item_id)
    assignee = None
    if body and body.assignee_id:
        assignee = get_or_404(db, User, body.assignee_id)
        if assignee.role_code != "operator":
            raise HTTPException(status_code=400, detail="仅可派发给操作员")
    try:
        task = svc.create_task_from_plan(
            db, plan, source="manual", assignee=assignee, operator=current_user
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    db.commit()
    db.refresh(task)
    return ok(_task_out(task), message="已派发巡检任务")


@router.post("/plans/auto-dispatch")
def auto_dispatch(db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("insp:task:create")),
):
    n = svc.dispatch_due_plans(db)
    return ok({"created_plans": n}, message=f"自动派发完成，处理计划 {n} 个")


# ---- tasks ----
@router.get("/tasks")
def list_tasks(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    task_status: str | None = None,
    plan_id: int | None = None,
    keyword: str | None = None,
    task_date: date_cls | None = None,
    team_id: int | None = None,
    unclaimed: int | None = None,
):
    q = db.query(InspectionTask).filter(InspectionTask.deleted == 0)
    # 已完成任务归档至巡检记录（insp_record），任务列表仅保留在办事项
    q = q.filter(InspectionTask.task_status != "done")
    # 数据权限：操作员仅可见本班组任务池 + 直接指派给自己的任务
    if not _is_manager(current_user):
        q = q.filter(
            or_(
                InspectionTask.team_id == current_user.team_id,
                InspectionTask.assignee_id == current_user.id,
            )
        )
    if task_status:
        q = q.filter(InspectionTask.task_status == task_status)
    if plan_id is not None:
        q = q.filter(InspectionTask.plan_id == plan_id)
    if task_date is not None:
        q = q.filter(InspectionTask.task_date == task_date)
    if team_id is not None:
        q = q.filter(InspectionTask.team_id == team_id)
    # 认领状态细分：1=待认领（无人认领） 0=待巡检（已认领未执行）
    if unclaimed == 1:
        q = q.filter(InspectionTask.assignee_id.is_(None))
    elif unclaimed == 0:
        q = q.filter(InspectionTask.assignee_id.isnot(None))
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (InspectionTask.plan_name.like(like))
            | (InspectionTask.team_name.like(like))
        )
    q = q.order_by(InspectionTask.task_date.desc(), InspectionTask.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_task_out(i) for i in result["items"]]
    return ok(result)


@router.post("/tasks/{task_id}/claim")
def claim_task(
    task_id: int,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("insp:task:claim")),
):
    """班组成员认领任务（原子条件更新，防止并发重复认领）。"""
    task = get_or_404(db, InspectionTask, task_id)
    try:
        svc.claim_task(db, task, current_user)
        db.commit()
        db.refresh(task)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_task_out(task), message="认领成功")


@router.post("/tasks/{task_id}/complete")
def complete_task(
    task_id: int,
    body: InspectionTaskComplete,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("insp:record:submit")),
):
    task = get_or_404(db, InspectionTask, task_id)
    try:
        record = svc.complete_task(
            db,
            task,
            results=body.results,
            executor=current_user,
            remark=body.remark,
        )
        db.commit()
        db.refresh(record)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(_record_out(db, record), message="巡检完成")


@router.get("/tasks/{task_id}/scada-snapshot")
def task_scada_snapshot(
    task_id: int,
    db: DbSession,
    _: CurrentUser,
):
    """拉取一个巡检任务的 SCADA 实时值快照。

    执行人在认领/开始执行任务时调用此接口，把每个检查项关联设备的所有测点
    实时值一次性返回给前端作为辅助参考；支持每 30s 轮询刷新。
    即使测点全离线或无关联设备也返回正常结构，不阻断巡检流程。
    """
    task = get_or_404(db, InspectionTask, task_id)
    data = svc.build_scada_snapshot(db, task)
    return ok(data)


# ---- records ----
@router.get("/records")
def list_records(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    has_abnormal: int | None = None,
):
    q = db.query(InspectionRecord).filter(InspectionRecord.deleted == 0)
    # 数据权限：操作员仅可见本班组记录 + 本人执行/补录的记录
    if not _is_manager(current_user):
        q = q.filter(
            or_(
                InspectionRecord.team_id == current_user.team_id,
                InspectionRecord.executor_id == current_user.id,
            )
        )
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (InspectionRecord.plan_name.like(like))
            | (InspectionRecord.executor_name.like(like))
        )
    if has_abnormal is not None:
        q = q.filter(InspectionRecord.has_abnormal == has_abnormal)
    q = q.order_by(InspectionRecord.record_date.desc(), InspectionRecord.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_record_out(db, i) for i in result["items"]]
    return ok(result)


@router.post("/records")
def create_ad_hoc_record(
    body: InspectionRecordCreate,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("insp:record:submit")),
):
    has_abnormal = any(
        (r.result or "").lower() in ("abnormal", "异常") for r in body.results
    )
    # 摘要直接写中文结果标签，避免列表/详情展示 normal/abnormal 原始码
    result_labels = {"normal": "正常", "abnormal": "异常"}
    summary = "; ".join(
        f"{(r.equipment_name + '·') if r.equipment_name else ''}{r.check_item}:"
        f"{result_labels.get((r.result or '').lower(), r.result)}"
        for r in body.results
    )
    team_name = None
    if body.team_id:
        team = (
            db.query(Team)
            .filter(Team.id == body.team_id, Team.deleted == 0)
            .first()
        )
        team_name = team.name if team else None
    rec = InspectionRecord(
        task_id=None,
        plan_id=None,
        plan_name=body.plan_name or "计划外巡检",
        team_id=body.team_id,
        team_name=team_name,
        record_date=body.record_date or date_cls.today(),
        items_summary=summary,
        has_abnormal=1 if has_abnormal else 0,
        executor_id=current_user.id,
        executor_name=current_user.display_name,
        remark=body.remark,
        results_json=json.dumps([r.model_dump() for r in body.results], ensure_ascii=False),
        status=1,
        deleted=0,
    )
    db.add(rec)
    db.flush()
    db.add(
        InspectionActionLog(
            task_id=None,
            record_id=rec.id,
            plan_id=None,
            action="create",
            operator_id=current_user.id,
            operator_name=current_user.display_name,
            detail=f"{rec.plan_name} · {rec.record_date} · 补录 {len(body.results)} 项",
        )
    )
    db.commit()
    db.refresh(rec)
    return ok(_record_out(db, rec))
