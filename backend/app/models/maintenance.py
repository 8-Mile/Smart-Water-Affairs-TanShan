from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import SoftDeleteModel


class MaintenancePlan(SoftDeleteModel):
    __tablename__ = "maint_plan"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # overhaul / lubrication
    plan_type: Mapped[str] = mapped_column(String(32), nullable=False, default="overhaul")
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    cycle_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    advance_days: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 完成后是否需要验收：0 不需要（默认）/ 1 需要
    need_accept: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 默认执行人（新建计划必选）：手动派发预填、自动派发自动指派
    default_assignee_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    default_assignee_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class MaintenancePlanEquipment(Base):
    __tablename__ = "maint_plan_equipment"
    __table_args__ = (
        UniqueConstraint("plan_id", "equipment_id", name="uq_maint_plan_eq"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    equipment_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)


class MaintenanceRecord(SoftDeleteModel):
    """维保任务/记录。"""

    __tablename__ = "maint_record"

    plan_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    plan_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    equipment_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    equipment_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    equipment_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # overhaul / lubrication
    maintain_type: Mapped[str] = mapped_column(String(32), nullable=False, default="overhaul")
    # pending / pending_accept / done / cancelled
    record_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    operate_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 验收信息（need_accept=1 的记录完成后填写）
    acceptor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    acceptor_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    accept_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accept_comment: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # plan / manual
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="plan")


class MaintActionLog(Base):
    """维保流转留痕（派发 / 创建 / 提交 / 验收 / 转维修）。"""

    __tablename__ = "maint_action_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    plan_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
