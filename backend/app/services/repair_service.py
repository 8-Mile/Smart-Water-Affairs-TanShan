"""维修工单状态机 + 告警联动。"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.alarm_engine.ws_hub import alarm_ws_hub
from app.models.alarm import Alarm, AlarmActionLog
from app.models.archive import Archive, ArchiveCategory
from app.models.equipment import Equipment
from app.models.org import Location
from app.models.repair import RepairActionLog, RepairOrder
from app.models.user import User
from app.services import notify

# 工单状态
STATUS_PENDING = "pending_dispatch"  # 待派单
STATUS_PROCESSING = "processing"  # 维修中
STATUS_PENDING_ACCEPT = "pending_accept"  # 待验收
STATUS_ARCHIVED = "archived"  # 已归档
STATUS_REJECTED = "rejected"  # 审批驳回（终态）

# 在修状态：同一设备同一时间只允许存在一张未归档工单（归档/驳回均为终态，不占位）
ACTIVE_STATUSES = (STATUS_PENDING, STATUS_PROCESSING, STATUS_PENDING_ACCEPT)

# 告警状态 → 中文，写入流转日志时避免展示英文枚举
ALARM_STATUS_ZH = {
    "pending": "未处理",
    "processing": "处理中",
    "pending_accept": "待验收",
    "closed": "已关闭",
    "rejected": "已驳回",
    "reopened": "重新处理中",
}


def next_order_no(db: Session) -> str:
    day = datetime.now().strftime("%Y%m%d")
    prefix = f"RP-{day}-"
    last = (
        db.query(RepairOrder)
        .filter(RepairOrder.order_no.like(f"{prefix}%"))
        .order_by(RepairOrder.id.desc())
        .first()
    )
    seq = 1
    if last and last.order_no.startswith(prefix):
        try:
            seq = int(last.order_no.split("-")[-1]) + 1
        except ValueError:
            seq = 1
    return f"{prefix}{seq:03d}"


def log_repair(
    db: Session,
    repair_id: int,
    action: str,
    user: Optional[User] = None,
    detail: Optional[str] = None,
) -> None:
    db.add(
        RepairActionLog(
            repair_id=repair_id,
            action=action,
            operator_id=user.id if user else None,
            operator_name=user.display_name if user else None,
            detail=detail,
        )
    )


def log_alarm(
    db: Session,
    alarm_id: int,
    action: str,
    user: Optional[User] = None,
    detail: Optional[str] = None,
) -> None:
    db.add(
        AlarmActionLog(
            alarm_id=alarm_id,
            action=action,
            operator_id=user.id if user else None,
            operator_name=user.display_name if user else None,
            detail=detail,
        )
    )


def sync_alarm_from_repair(
    db: Session,
    repair: RepairOrder,
    user: Optional[User] = None,
) -> None:
    """工单状态变更时回写关联告警。"""
    if not repair.alarm_id:
        return
    alarm = (
        db.query(Alarm)
        .filter(Alarm.id == repair.alarm_id, Alarm.deleted == 0)
        .first()
    )
    if not alarm:
        return

    mapping = {
        STATUS_PENDING: "processing",
        STATUS_PROCESSING: "processing",
        STATUS_PENDING_ACCEPT: "pending_accept",
        STATUS_ARCHIVED: "closed",
        STATUS_REJECTED: "rejected",
    }
    new_status = mapping.get(repair.process_status)
    if not new_status:
        return
    # reopened 吸收态：驳回重开的告警，工单中间态回写不回实时告警域，
    # 仅终态（验收关闭 / 再次驳回）才迁出
    if alarm.alarm_status == "reopened" and new_status not in ("closed", "rejected"):
        new_status = "reopened"

    old = alarm.alarm_status
    # 派单/返工时把维修人回写为告警责任人，告警中心指派列随之更新
    if repair.worker_id and (
        alarm.assignee_id != repair.worker_id
        or alarm.assignee_name != repair.worker_name
    ):
        alarm.assignee_id = repair.worker_id
        alarm.assignee_name = repair.worker_name
        assignee_changed = True
    else:
        assignee_changed = False

    # 状态未变且责任人未变时无需回写（工单归档除外，需补 end_time）
    if old == new_status and repair.process_status != STATUS_ARCHIVED and not assignee_changed:
        return

    alarm.alarm_status = new_status
    if new_status == "closed":
        alarm.end_time = datetime.now()
        alarm.accept_comment = repair.accept_comment
    if new_status == "processing" and old == "pending_accept":
        # 验收驳回回退
        alarm.end_time = None
    db.add(alarm)
    log_alarm(
        db,
        alarm.id,
        f"repair_{repair.process_status}",
        user,
        detail=f"工单 {repair.order_no} → 告警状态「{ALARM_STATUS_ZH.get(new_status, new_status)}」",
    )
    db.flush()
    # 告警状态已变，失效 KPI 统计缓存（避免 services 层循环依赖，按模块名惰性导入）
    from app.api.alarm import _invalidate_stats_cache

    _invalidate_stats_cache()
    alarm_ws_hub.broadcast_threadsafe(
        "alarm.updated",
        {
            "id": alarm.id,
            "alarm_status": alarm.alarm_status,
            "repair_id": repair.id,
            "order_no": repair.order_no,
        },
    )


def fill_equipment_snapshot(db: Session, order: RepairOrder, equipment_id: int) -> None:
    eq = (
        db.query(Equipment)
        .filter(Equipment.id == equipment_id, Equipment.deleted == 0)
        .first()
    )
    if not eq:
        raise ValueError("设备不存在")
    order.equipment_id = eq.id
    order.equipment_name = eq.name
    order.equipment_code = eq.code
    if not order.name:
        order.name = f"{eq.name}维修"


def find_active_order_for_equipment(
    db: Session,
    equipment_id: Optional[int],
    exclude_order_id: Optional[int] = None,
) -> Optional[RepairOrder]:
    """查询占用该设备的在修工单（排除自身），用于设备级互斥校验。"""
    if not equipment_id:
        return None
    q = db.query(RepairOrder).filter(
        RepairOrder.deleted == 0,
        RepairOrder.equipment_id == equipment_id,
        RepairOrder.process_status.in_(ACTIVE_STATUSES),
    )
    if exclude_order_id:
        q = q.filter(RepairOrder.id != exclude_order_id)
    return q.order_by(RepairOrder.id.asc()).first()


def ensure_equipment_free(
    db: Session,
    equipment_id: Optional[int],
    equipment_name: Optional[str] = None,
    exclude_order_id: Optional[int] = None,
) -> None:
    """设备级互斥：已有未归档工单时禁止新建/派单，避免同一设备并行多张工单。"""
    busy = find_active_order_for_equipment(db, equipment_id, exclude_order_id)
    if busy:
        raise ValueError(
            f"设备「{equipment_name or busy.equipment_name or equipment_id}」"
            f"已有未归档工单 {busy.order_no}，请先完成该工单验收归档"
        )


def create_manual_repair(
    db: Session,
    *,
    equipment_id: int,
    description: str,
    repair_type: str = "overhaul",
    fault_category: Optional[str] = None,
    fault_time: Optional[datetime] = None,
    worker_id: Optional[int] = None,
    worker_name: Optional[str] = None,
    apply_images: Optional[str] = None,
    applicant: Optional[User] = None,
    source: str = "manual",
    inspection_record_id: Optional[int] = None,
    maintenance_record_id: Optional[int] = None,
) -> RepairOrder:
    order = RepairOrder(
        order_no=next_order_no(db),
        name="",
        process_status=STATUS_PENDING,
        description=description,
        source=source,
        inspection_record_id=inspection_record_id,
        maintenance_record_id=maintenance_record_id,
        repair_type=repair_type or "overhaul",
        fault_category=fault_category,
        fault_time=fault_time or datetime.now(),
        applicant_id=applicant.id if applicant else None,
        applicant_name=applicant.display_name if applicant else None,
        worker_id=worker_id,
        worker_name=worker_name,
        apply_images=apply_images,
        status=1,
        deleted=0,
    )
    fill_equipment_snapshot(db, order, equipment_id)
    # 设备级互斥：同一设备已有未归档工单时禁止重复报修（人工/巡检/维保来源统一拦截）
    ensure_equipment_free(db, order.equipment_id, order.equipment_name)
    db.add(order)
    db.flush()
    # 根据来源记录不同的创建日志，便于档案业务流程还原
    create_detail = {
        "manual": "人工报修",
        "inspection": "巡检发现问题，创建维修工单",
        "alarm": "告警触发生成工单",
        "maintenance": "维保执行发现问题，转维修工单",
    }.get(source, "人工报修")
    log_repair(db, order.id, "create", applicant, detail=create_detail)
    # 通知管理员派单（申请人自己若是管理员则不重复提醒）
    notify.notify_managers(
        db,
        f"新报修工单待派单：{order.order_no}",
        content=description,
        ntype="repair",
        biz_type="repair",
        biz_id=order.order_no,
        path=f"/repair/list?focus={order.order_no}",
        exclude_user_ids=[applicant.id] if applicant else (),
    )
    return order


def dispatch_repair(
    db: Session,
    order: RepairOrder,
    *,
    worker: User,
    approver: User,
    comment: Optional[str] = None,
) -> RepairOrder:
    if order.process_status != STATUS_PENDING:
        raise ValueError("仅待派单工单可审批派单")
    if worker.role_code != "operator":
        raise ValueError("仅可派发给操作员")
    # 设备级互斥：同设备已有其它在修工单时不允许并行派单
    ensure_equipment_free(db, order.equipment_id, order.equipment_name, exclude_order_id=order.id)
    order.process_status = STATUS_PROCESSING
    order.worker_id = worker.id
    order.worker_name = worker.display_name
    order.approver_id = approver.id
    order.approver_name = approver.display_name
    order.approve_time = datetime.now()
    order.approve_comment = comment
    order.process_start_time = datetime.now()
    db.add(order)
    log_repair(
        db,
        order.id,
        "dispatch",
        approver,
        # 备注并入日志详情：流转日志需完整呈现每一步的备注信息
        detail=f"派给 {worker.display_name}" + (f"（备注：{comment}）" if comment else ""),
    )
    sync_alarm_from_repair(db, order, approver)
    notify.notify_users(
        db,
        [worker.id],
        f"您有新的维修工单：{order.order_no}",
        content=f"{approver.display_name} 已派单：{order.name}",
        ntype="repair",
        biz_type="repair",
        biz_id=order.order_no,
        path=f"/repair/list?focus={order.order_no}",
    )
    return order


def reject_dispatch(
    db: Session,
    order: RepairOrder,
    *,
    approver: User,
    comment: Optional[str] = None,
) -> RepairOrder:
    if order.process_status != STATUS_PENDING:
        raise ValueError("仅待派单工单可驳回")
    # 一类（紧急）/二类（重要）告警不允许驳回：紧急告警必须完成处置闭环，驳回权仅留给三类（一般）
    alarm = None
    if order.alarm_id:
        alarm = (
            db.query(Alarm)
            .filter(Alarm.id == order.alarm_id, Alarm.deleted == 0)
            .first()
        )
        if alarm and alarm.alarm_level in (1, 2):
            raise ValueError(
                f"{'一类' if alarm.alarm_level == 1 else '二类'}告警属于紧急告警，不允许驳回，须完成维修处置闭环"
            )
    order.process_status = STATUS_REJECTED
    order.approver_id = approver.id
    order.approver_name = approver.display_name
    order.approve_time = datetime.now()
    order.approve_comment = comment
    db.add(order)
    log_repair(db, order.id, "reject_dispatch", approver, detail=comment)
    # 驳回后告警置「已驳回」终态（进历史、计处理率），解除绑定允许重新发起维修处理（生成新工单）
    if alarm:
        alarm.alarm_status = "rejected"
        alarm.reject_reason = comment
        alarm.end_time = datetime.now()
        alarm.repair_id = None
        db.add(alarm)
        log_alarm(db, alarm.id, "repair_rejected", approver, detail=order.order_no)
    if order.applicant_id:
        notify.notify_users(
            db,
            [order.applicant_id],
            f"报修工单已驳回：{order.order_no}",
            content=order.approve_comment or "管理员驳回了该报修申请",
            ntype="repair",
            biz_type="repair",
            biz_id=order.order_no,
            path=f"/repair/list?focus={order.order_no}",
        )
    return order


def complete_repair(
    db: Session,
    order: RepairOrder,
    *,
    worker: User,
    feedback: str,
    images: Optional[str] = None,
) -> RepairOrder:
    if order.process_status != STATUS_PROCESSING:
        raise ValueError("仅维修中工单可提交完成")
    if order.worker_id and order.worker_id != worker.id:
        raise PermissionError("仅指派维修人员可提交完工")
    order.process_status = STATUS_PENDING_ACCEPT
    order.process_feedback = feedback
    order.process_images = images
    order.process_end_time = datetime.now()
    db.add(order)
    log_repair(db, order.id, "complete", worker, detail=feedback[:200] if feedback else None)
    sync_alarm_from_repair(db, order, worker)
    notify.notify_managers(
        db,
        f"工单已完工待验收：{order.order_no}",
        content=f"{worker.display_name} 提交了完工反馈",
        ntype="repair",
        biz_type="repair",
        biz_id=order.order_no,
        path=f"/repair/list?focus={order.order_no}",
        exclude_user_ids=[worker.id] if worker.role_code in ("super_admin", "admin") else (),
    )
    return order


def accept_repair(
    db: Session,
    order: RepairOrder,
    *,
    acceptor: User,
    passed: bool,
    comment: Optional[str] = None,
) -> RepairOrder:
    if order.process_status != STATUS_PENDING_ACCEPT:
        raise ValueError("仅待验收工单可验收")
    # 验收权限由接口层 require_perm("repair:accept") 统一管控，service 不再按角色硬检

    order.acceptor_id = acceptor.id
    order.acceptor_name = acceptor.display_name
    order.accept_time = datetime.now()
    order.accept_comment = comment
    if passed:
        order.process_status = STATUS_ARCHIVED
        log_repair(db, order.id, "accept_pass", acceptor, detail=comment)
        # 验收通过后自动生成工单档案，按来源归入对应子分类
        _create_archive_from_repair(db, order)
    else:
        order.process_status = STATUS_PROCESSING
        order.process_end_time = None
        log_repair(db, order.id, "accept_reject", acceptor, detail=comment)
    db.add(order)
    sync_alarm_from_repair(db, order, acceptor)
    if order.worker_id:
        notify.notify_users(
            db,
            [order.worker_id],
            f"工单验收{'通过，已归档' if passed else '驳回，请返工'}：{order.order_no}",
            content=comment or None,
            ntype="repair",
            biz_type="repair",
            biz_id=order.order_no,
            path=f"/repair/list?focus={order.order_no}",
        )
    return order


# 工单来源 → 档案子分类码映射
REPAIR_SOURCE_TO_ARCHIVE_CODE = {
    "alarm": "DOC-ORDER-ALARM",
    "inspection": "DOC-ORDER-INSPECTION",
    "manual": "DOC-ORDER-MANUAL",
    "maintenance": "DOC-ORDER-MAINTENANCE",
}


def _create_archive_from_repair(db: Session, order: RepairOrder) -> None:
    """工单验收通过后自动生成工单档案，按来源归入告警/巡检/人工三个子分类。"""
    # 已归档的工单不重复建档案（幂等）
    exists = (
        db.query(Archive)
        .filter(Archive.deleted == 0, Archive.related_order == order.order_no)
        .first()
    )
    if exists:
        return
    category_code = REPAIR_SOURCE_TO_ARCHIVE_CODE.get(order.source, "DOC-ORDER-MANUAL")
    cat = (
        db.query(ArchiveCategory)
        .filter(ArchiveCategory.deleted == 0, ArchiveCategory.code == category_code)
        .first()
    )
    category_name = cat.name if cat else "工单档案"
    day = datetime.now().strftime("%Y%m%d")
    seq = (
        db.query(Archive.id)
        .filter(Archive.upload_time >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))
        .count()
        + 1
    )
    archive_no = f"DA{day}{seq:03d}"
    # 归档描述：融合工单信息，便于后续 AI 文档喂养检索
    desc_parts = [order.description or ""]
    if order.process_feedback:
        desc_parts.append(f"维修反馈：{order.process_feedback}")
    if order.accept_comment:
        desc_parts.append(f"验收意见：{order.accept_comment}")
    description = "\n".join(p for p in desc_parts if p)

    archive = Archive(
        name=order.name or f"{order.equipment_name or ''}维修档案",
        category_code=category_code,
        category_name=category_name,
        file_path="",  # 工单档案暂无实体文件，仅承载元数据与流转记录
        file_name=f"{order.order_no}.pdf",
        file_size=0,
        file_format="pdf",
        uploader_name=order.acceptor_name or "系统",
        description=description,
        download_count=0,
        status=1,
        deleted=0,
        archive_no=archive_no,
        source="自动关联",
        related_order=order.order_no,
        related_equipment=order.equipment_name,
        related_matter=f"工单验收归档（{order.order_no}）",
    )
    db.add(archive)
    db.flush()


def repair_to_dict(order: RepairOrder, logs: list | None = None) -> dict:
    data = {
        "id": order.id,
        "order_no": order.order_no,
        "name": order.name,
        "equipment_id": order.equipment_id,
        "equipment_name": order.equipment_name,
        "equipment_code": order.equipment_code,
        "alarm_id": order.alarm_id,
        "process_status": order.process_status,
        "description": order.description,
        "source": order.source,
        "repair_type": order.repair_type,
        "fault_category": order.fault_category,
        "fault_time": order.fault_time,
        "applicant_id": order.applicant_id,
        "applicant_name": order.applicant_name,
        "apply_time": order.apply_time,
        "apply_images": order.apply_images,
        "approver_id": order.approver_id,
        "approver_name": order.approver_name,
        "approve_time": order.approve_time,
        "approve_comment": order.approve_comment,
        "worker_id": order.worker_id,
        "worker_name": order.worker_name,
        "process_start_time": order.process_start_time,
        "process_end_time": order.process_end_time,
        "process_feedback": order.process_feedback,
        "process_images": order.process_images,
        "acceptor_id": order.acceptor_id,
        "acceptor_name": order.acceptor_name,
        "accept_time": order.accept_time,
        "accept_comment": order.accept_comment,
        "status": order.status,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }
    if logs is not None:
        data["logs"] = [
            {
                "id": l.id,
                "action": l.action,
                "operator_name": l.operator_name,
                "detail": l.detail,
                "created_at": l.created_at,
            }
            for l in logs
        ]
    return data
