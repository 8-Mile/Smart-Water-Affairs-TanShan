from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import SoftDeleteModel


class DispatchInstruction(SoftDeleteModel):
    """调度指令。"""

    __tablename__ = "dispatch_instruction"

    instruction_code: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True
    )
    # superior / internal
    instruction_type: Mapped[str] = mapped_column(String(32), nullable=False, default="internal")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # normal / important / urgent
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")

    publisher_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    publisher_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    publish_time: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )

    executor_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    executor_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expected_finish_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    # pending / approved / rejected
    audit_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )
    # pending / done / none（驳回后 none）
    execute_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )

    auditor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    auditor_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    audit_comment: Mapped[str | None] = mapped_column(String(512), nullable=True)

    execute_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    execute_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)


class DispatchActionLog(Base):
    __tablename__ = "dispatch_action_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    instruction_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
