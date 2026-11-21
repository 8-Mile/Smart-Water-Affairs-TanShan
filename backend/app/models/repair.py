"""维修工单（Phase 4 全流程）。"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import SoftDeleteModel


class RepairOrder(SoftDeleteModel):
    __tablename__ = "repair_order"

    order_no: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    equipment_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    equipment_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    equipment_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    alarm_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 巡检来源工单：关联的巡检记录 id（记录页据此反查工单号展示「关联工单」）
    inspection_record_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )
    # 维保来源工单：关联的维保记录 id（维保记录页据此反查工单号展示「关联工单」）
    maintenance_record_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )
    # pending_dispatch / processing / pending_accept / archived / rejected
    process_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending_dispatch", index=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # alarm / manual
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="alarm")
    # overhaul / lubrication
    repair_type: Mapped[str] = mapped_column(String(32), nullable=False, default="overhaul")
    fault_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fault_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    applicant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    applicant_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    apply_time: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    apply_images: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 审批派单
    approver_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approver_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approve_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approve_comment: Mapped[str | None] = mapped_column(String(255), nullable=True)
    worker_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    worker_name: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # 处理
    process_start_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    process_end_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    process_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    process_images: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 验收
    acceptor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    acceptor_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    accept_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accept_comment: Mapped[str | None] = mapped_column(String(255), nullable=True)


class RepairActionLog(Base):
    __tablename__ = "repair_action_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repair_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
