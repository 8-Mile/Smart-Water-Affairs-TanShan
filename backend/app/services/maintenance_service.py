"""维保计划派发与记录完成。"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.equipment import Equipment
from app.models.maintenance import (
    MaintActionLog,
    MaintenancePlan,
    MaintenancePlanEquipment,
    MaintenanceRecord,
)
from app.models.archive import Archive, ArchiveCategory
from app.models.user import User
from app.services import notify

# 维保记录归档的分类码（与档案分类树种子保持一致）
MAINT_ARCHIVE_CATEGORY_CODE = "DOC-ORDER-MAINTENANCE"


def set_plan_equipments(db: Session, plan_id: int, equipment_ids: list[int]) -> None:
    db.query(MaintenancePlanEquipment).filter(
        MaintenancePlanEquipment.plan_id == plan_id
    ).delete()
    for eid in equipment_ids:
        db.add(MaintenancePlanEquipment(plan_id=plan_id, equipment_id=eid))


def get_plan_equipment_ids(db: Session, plan_id: int) -> list[int]:
    rows = (
        db.query(MaintenancePlanEquipment)
        .filter(MaintenancePlanEquipment.plan_id == plan_id)
        .all()
    )
    return [r.equipment_id for r in rows]


def _should_dispatch(plan: MaintenancePlan, today: date) -> bool:
    if plan.enabled != 1 or plan.status != 1:
        return False
    if today < plan.start_date:
        return False
    # 首次：到达开始日（考虑提前通知）
    first_due = plan.start_date
    advance = plan.advance_days or 0
    if plan.last_dispatch_date is None:
        return today >= first_due - timedelta(days=advance)
    # 下次：上次派发 + 周期 - 提前
    next_due = plan.last_dispatch_date + timedelta(days=plan.cycle_days)
    return today >= next_due - timedelta(days=advance)


def dispatch_plan(
    db: Session,
    plan: MaintenancePlan,
    due_date: Optional[date] = None,
    source: str = "plan",
    assignee: Optional[User] = None,
    remark: Optional[str] = None,
    operator: Optional[User] = None,
) -> list[MaintenanceRecord]:
    due_date = due_date or date.today()
    # 未显式指派（自动派发）时回退到计划的默认执行人
    if assignee is None and plan.default_assignee_id:
        assignee = (
            db.query(User)
            .filter(User.id == plan.default_assignee_id, User.deleted == 0)
            .first()
        )
    eq_ids = get_plan_equipment_ids(db, plan.id)
    created: list[MaintenanceRecord] = []
    for eid in eq_ids:
        # 避免重复：同计划同设备同 due_date pending
        exists = (
            db.query(MaintenanceRecord)
            .filter(
                MaintenanceRecord.deleted == 0,
                MaintenanceRecord.plan_id == plan.id,
                MaintenanceRecord.equipment_id == eid,
                MaintenanceRecord.due_date == due_date,
                MaintenanceRecord.record_status == "pending",
            )
            .first()
        )
        if exists:
            continue
        eq = (
            db.query(Equipment)
            .filter(Equipment.id == eid, Equipment.deleted == 0)
            .first()
        )
        if not eq:
            continue
        rec = MaintenanceRecord(
            plan_id=plan.id,
            plan_name=plan.name,
            equipment_id=eq.id,
            equipment_name=eq.name,
            equipment_code=eq.code,
            maintain_type=plan.plan_type,
            record_status="pending",
            due_date=due_date,
            content=f"【{plan.name}】周期维保任务",
            # 指派人即预定执行人，完成后按实际操作人覆盖
            operator_id=assignee.id if assignee else None,
            operator_name=assignee.display_name if assignee else None,
            remark=remark,
            source=source,
            status=1,
            deleted=0,
        )
        db.add(rec)
        created.append(rec)
    if created:
        plan.last_dispatch_date = due_date
        db.add(plan)
        db.add(
            MaintActionLog(
                plan_id=plan.id,
                action="dispatch",
                operator_id=operator.id if operator else None,
                operator_name=operator.display_name if operator else "系统",
                detail=(
                    f"{plan.name} · 到期日 {due_date} · 生成 {len(created)} 条记录"
                    + (f" · 指派 {assignee.display_name}" if assignee else "")
                ),
            )
        )
        # 派发通知：逐条告知被指派人（无指派人则不发，任务仍可在记录列表查看）
        if assignee:
            for rec in created:
                notify.notify_users(
                    db,
                    [assignee.id],
                    f"您有新的维保任务：{plan.name}",
                    content=f"设备：{rec.equipment_name}，到期日 {due_date.isoformat()}",
                    ntype="maintenance",
                    biz_type="maintenance_record",
                    biz_id=rec.id,
                    path=f"/maintenance/plans?tab=records&focus={rec.id}",
                )
    db.flush()
    return created


def dispatch_due_plans(db: Session, today: Optional[date] = None) -> int:
    today = today or date.today()
    plans = (
        db.query(MaintenancePlan)
        .filter(MaintenancePlan.deleted == 0, MaintenancePlan.enabled == 1)
        .all()
    )
    total = 0
    for plan in plans:
        if _should_dispatch(plan, today):
            created = dispatch_plan(db, plan, due_date=today, source="plan")
            total += len(created)
    db.commit()
    return total


def complete_record(
    db: Session,
    record: MaintenanceRecord,
    *,
    operator: User,
    content: Optional[str] = None,
    remark: Optional[str] = None,
) -> MaintenanceRecord:
    if record.record_status in ("done", "pending_accept"):
        raise ValueError("记录已提交完成")
    if content:
        record.content = content
    record.remark = remark
    record.operator_id = operator.id
    record.operator_name = operator.display_name
    record.operate_time = datetime.now()
    # 计划开启"需验收"时进入待验收，验收通过才算完成；否则直接完成
    need_accept = False
    if record.plan_id:
        plan = (
            db.query(MaintenancePlan)
            .filter(MaintenancePlan.id == record.plan_id, MaintenancePlan.deleted == 0)
            .first()
        )
        need_accept = bool(plan and plan.need_accept == 1)
    record.record_status = "pending_accept" if need_accept else "done"
    db.add(
        MaintActionLog(
            record_id=record.id,
            plan_id=record.plan_id,
            action="submit",
            operator_id=operator.id,
            operator_name=operator.display_name,
            detail=(
                f"{record.plan_name or '临时维保'} · {record.equipment_name}"
                + (" · 提交验收" if need_accept else " · 完成")
            ),
        )
    )
    if not need_accept:
        # 直接完成时清掉上一轮驳回残留
        record.acceptor_id = None
        record.acceptor_name = None
        record.accept_time = None
        # 无需验收即完成：直接归档到档案资料-维保关联工单
        archive_maint_record(db, record)
        record.accept_comment = None
    db.add(record)
    # 提交验收时通知管理员处理（验收通过/驳回由 accept_record 再通知执行人）
    if need_accept:
        notify.notify_managers(
            db,
            f"维保任务待验收：{record.plan_name or '临时维保'}",
            content=f"设备：{record.equipment_name}，执行人：{record.operator_name or '—'}",
            ntype="maintenance",
            biz_type="maintenance_record",
            biz_id=record.id,
            path=f"/maintenance/plans?tab=records&focus={record.id}",
        )
    db.flush()
    return record


def archive_maint_record(db: Session, record: MaintenanceRecord) -> None:
    """维保记录完成/验收通过后自动归档到「档案资料-运维记录-维保关联工单」（幂等）。"""
    related = f"MT-{record.id:06d}"
    exists = (
        db.query(Archive)
        .filter(Archive.deleted == 0, Archive.related_order == related)
        .first()
    )
    if exists:
        return
    cat = (
        db.query(ArchiveCategory)
        .filter(
            ArchiveCategory.deleted == 0,
            ArchiveCategory.code == MAINT_ARCHIVE_CATEGORY_CODE,
        )
        .first()
    )
    category_name = cat.name if cat else "维保关联工单"
    day = datetime.now().strftime("%Y%m%d")
    seq = (
        db.query(Archive.id)
        .filter(Archive.upload_time >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))
        .count()
        + 1
    )
    # 归档描述：融合维保内容与验收意见，便于后续 AI 文档喂养检索
    desc_parts = [record.content or ""]
    if record.remark:
        desc_parts.append(f"备注：{record.remark}")
    if record.accept_comment:
        desc_parts.append(f"验收意见：{record.accept_comment}")
    archive = Archive(
        name=f"{record.plan_name or '临时维保'}·{record.equipment_name or ''}维保档案",
        category_code=MAINT_ARCHIVE_CATEGORY_CODE,
        category_name=category_name,
        file_path="",  # 维保档案暂无实体文件，仅承载元数据与流转记录
        file_name=f"{related}.pdf",
        file_size=0,
        file_format="pdf",
        uploader_name=record.acceptor_name or record.operator_name or "系统",
        description="\n".join(p for p in desc_parts if p),
        download_count=0,
        status=1,
        deleted=0,
        archive_no=f"DA{day}{seq:03d}",
        source="自动关联",
        related_order=related,
        related_equipment=record.equipment_name,
        related_matter=f"维保记录归档（{related}）",
    )
    db.add(archive)
    db.flush()


def accept_record(
    db: Session,
    record: MaintenanceRecord,
    *,
    acceptor: User,
    passed: bool,
    comment: Optional[str] = None,
) -> MaintenanceRecord:
    """维保验收：通过 → done（计入台账）；驳回 → 退回待执行重做。"""
    if record.record_status != "pending_accept":
        raise ValueError("记录不在待验收状态")
    record.acceptor_id = acceptor.id
    record.acceptor_name = acceptor.display_name
    record.accept_time = datetime.now()
    record.accept_comment = comment
    record.record_status = "done" if passed else "pending"
    db.add(
        MaintActionLog(
            record_id=record.id,
            plan_id=record.plan_id,
            action="accept_pass" if passed else "accept_reject",
            operator_id=acceptor.id,
            operator_name=acceptor.display_name,
            detail=f"{record.plan_name or '临时维保'} · {record.equipment_name}"
            + (f" · 意见：{comment}" if comment else ""),
        )
    )
    if passed:
        # 验收通过即完成：归档到档案资料-运维记录-维保关联工单
        archive_maint_record(db, record)
    if not passed and comment:
        # 驳回理由拼进备注，操作员重做时可见
        record.remark = f"{record.remark or ''}｜驳回：{comment}".strip("｜")
    db.add(record)
    # 验收结果通知执行人：通过 → 已完成；驳回 → 退回重做（附验收意见）
    if record.operator_id:
        notify.notify_users(
            db,
            [record.operator_id],
            f"维保任务{'验收通过' if passed else '被驳回，请重新执行'}：{record.plan_name or '临时维保'}",
            content=(
                f"设备：{record.equipment_name}"
                + (f"，验收意见：{comment}" if comment and not passed else "")
            ),
            ntype="maintenance",
            biz_type="maintenance_record",
            biz_id=record.id,
            path=f"/maintenance/plans?tab=records&focus={record.id}",
        )
    db.flush()
    return record


def create_manual_record(
    db: Session,
    *,
    equipment_id: int,
    maintain_type: str,
    content: str,
    operator: User,
    remark: Optional[str] = None,
) -> MaintenanceRecord:
    eq = (
        db.query(Equipment)
        .filter(Equipment.id == equipment_id, Equipment.deleted == 0)
        .first()
    )
    if not eq:
        raise ValueError("设备不存在")
    rec = MaintenanceRecord(
        plan_id=None,
        plan_name=None,
        equipment_id=eq.id,
        equipment_name=eq.name,
        equipment_code=eq.code,
        maintain_type=maintain_type or "overhaul",
        record_status="done",
        due_date=date.today(),
        content=content,
        operator_id=operator.id,
        operator_name=operator.display_name,
        operate_time=datetime.now(),
        remark=remark,
        source="manual",
        status=1,
        deleted=0,
    )
    db.add(rec)
    db.flush()
    log_action(
        db,
        rec,
        "create",
        operator,
        f"临时维保 · {rec.equipment_name} · {rec.maintain_type}",
    )
    return rec


def log_action(
    db: Session,
    record: MaintenanceRecord,
    action: str,
    operator: Optional[User],
    detail: Optional[str] = None,
) -> MaintActionLog:
    """写入维保流转留痕（供服务层与 API 层共用）。"""
    log = MaintActionLog(
        record_id=record.id,
        plan_id=record.plan_id,
        action=action,
        operator_id=operator.id if operator else None,
        operator_name=operator.display_name if operator else "系统",
        detail=detail,
    )
    db.add(log)
    return log
