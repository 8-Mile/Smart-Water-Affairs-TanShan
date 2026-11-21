"""调度指令状态机。"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.dispatch import DispatchActionLog, DispatchInstruction
from app.models.user import User
from app.services import notify

AUDIT_PENDING = "pending"
AUDIT_APPROVED = "approved"
AUDIT_REJECTED = "rejected"

EXEC_PENDING = "pending"
EXEC_DONE = "done"
EXEC_NONE = "none"


def next_code(db: Session) -> str:
    """DIS-YYYYMMDDHHMM + 2 位序号，保证同分钟唯一。"""
    now = datetime.now()
    prefix = f"DIS-{now.strftime('%Y%m%d%H%M')}"
    last = (
        db.query(DispatchInstruction)
        .filter(DispatchInstruction.instruction_code.like(f"{prefix}%"))
        .order_by(DispatchInstruction.id.desc())
        .first()
    )
    seq = 1
    if last and last.instruction_code.startswith(prefix):
        tail = last.instruction_code[len(prefix) :]
        try:
            seq = int(tail) + 1 if tail else 1
        except ValueError:
            seq = 1
    return f"{prefix}{seq:02d}"


def log_action(
    db: Session,
    instruction_id: int,
    action: str,
    user: Optional[User] = None,
    detail: Optional[str] = None,
) -> None:
    db.add(
        DispatchActionLog(
            instruction_id=instruction_id,
            action=action,
            operator_id=user.id if user else None,
            operator_name=user.display_name if user else None,
            detail=detail,
        )
    )


def create_instruction(
    db: Session,
    *,
    instruction_type: str,
    content: str,
    executor: User,
    expected_finish_time: datetime,
    priority: str = "normal",
    publisher: Optional[User] = None,
) -> DispatchInstruction:
    obj = DispatchInstruction(
        instruction_code=next_code(db),
        instruction_type=instruction_type or "internal",
        content=content,
        priority=priority or "normal",
        publisher_id=publisher.id if publisher else None,
        publisher_name=publisher.display_name if publisher else None,
        publish_time=datetime.now(),
        executor_id=executor.id,
        executor_name=executor.display_name,
        expected_finish_time=expected_finish_time,
        audit_status=AUDIT_PENDING,
        execute_status=EXEC_PENDING,
        status=1,
        deleted=0,
    )
    db.add(obj)
    db.flush()
    log_action(db, obj.id, "create", publisher, detail="发起调度指令")
    notify.notify_managers(
        db,
        f"新调度指令待审核：{obj.instruction_code}",
        content=(content or "")[:200],
        ntype="dispatch",
        biz_type="dispatch",
        biz_id=obj.instruction_code,
        path="/dispatch/stats?focus=" + obj.instruction_code,
        exclude_user_ids=[publisher.id] if publisher else (),
    )
    return obj


def update_instruction(
    db: Session,
    obj: DispatchInstruction,
    **fields,
) -> DispatchInstruction:
    if obj.audit_status != AUDIT_PENDING:
        raise ValueError("仅待审批指令可编辑")
    for k, v in fields.items():
        if v is not None and hasattr(obj, k):
            setattr(obj, k, v)
    db.add(obj)
    return obj


def audit_instruction(
    db: Session,
    obj: DispatchInstruction,
    *,
    passed: bool,
    comment: str,
    auditor: User,
) -> DispatchInstruction:
    if obj.audit_status != AUDIT_PENDING:
        raise ValueError("仅待审批指令可审核")
    if not comment or not comment.strip():
        raise ValueError("审核意见必填")

    obj.auditor_id = auditor.id
    obj.auditor_name = auditor.display_name
    obj.audit_time = datetime.now()
    obj.audit_comment = comment.strip()
    if passed:
        obj.audit_status = AUDIT_APPROVED
        obj.execute_status = EXEC_PENDING
        log_action(db, obj.id, "audit_pass", auditor, detail=comment)
        notify.notify_users(
            db,
            [obj.executor_id],
            f"调度指令已审核通过：{obj.instruction_code}",
            content=f"{auditor.display_name}：{comment}，请按期执行",
            ntype="dispatch",
            biz_type="dispatch",
            biz_id=obj.instruction_code,
            path="/dispatch/stats?focus=" + obj.instruction_code,
        )
    else:
        obj.audit_status = AUDIT_REJECTED
        obj.execute_status = EXEC_NONE
        log_action(db, obj.id, "audit_reject", auditor, detail=comment)
        if obj.publisher_id:
            notify.notify_users(
                db,
                [obj.publisher_id],
                f"调度指令审核未通过：{obj.instruction_code}",
                content=f"{auditor.display_name}：{comment}",
                ntype="dispatch",
                biz_type="dispatch",
                biz_id=obj.instruction_code,
                path="/dispatch/stats?focus=" + obj.instruction_code,
            )
    db.add(obj)
    return obj


def complete_instruction(
    db: Session,
    obj: DispatchInstruction,
    *,
    executor: User,
    feedback: Optional[str] = None,
) -> DispatchInstruction:
    if obj.audit_status != AUDIT_APPROVED:
        raise ValueError("仅已审批通过的指令可执行")
    if obj.execute_status != EXEC_PENDING:
        raise ValueError("指令已完成或不可执行")
    # 执行完毕仅被指派执行人或超管（领导不可代执行）
    if obj.executor_id != executor.id and executor.role_code != "super_admin":
        raise PermissionError("仅指派执行人可完成任务")

    obj.execute_status = EXEC_DONE
    obj.execute_time = datetime.now()
    obj.execute_feedback = feedback
    db.add(obj)
    log_action(db, obj.id, "execute_done", executor, detail=feedback)
    notify.notify_managers(
        db,
        f"调度指令已执行完毕：{obj.instruction_code}",
        content=f"{executor.display_name} 已完成执行",
        ntype="dispatch",
        biz_type="dispatch",
        biz_id=obj.instruction_code,
        path="/dispatch/stats?focus=" + obj.instruction_code,
    )
    return obj


def to_dict(obj: DispatchInstruction, logs: list | None = None) -> dict:
    data = {
        "id": obj.id,
        "instruction_code": obj.instruction_code,
        "instruction_type": obj.instruction_type,
        "content": obj.content,
        "priority": obj.priority,
        "publisher_id": obj.publisher_id,
        "publisher_name": obj.publisher_name,
        "publish_time": obj.publish_time,
        "executor_id": obj.executor_id,
        "executor_name": obj.executor_name,
        "expected_finish_time": obj.expected_finish_time,
        "audit_status": obj.audit_status,
        "execute_status": obj.execute_status,
        "auditor_id": obj.auditor_id,
        "auditor_name": obj.auditor_name,
        "audit_time": obj.audit_time,
        "audit_comment": obj.audit_comment,
        "execute_time": obj.execute_time,
        "execute_feedback": obj.execute_feedback,
        "status": obj.status,
        "created_at": obj.created_at,
        "updated_at": obj.updated_at,
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
