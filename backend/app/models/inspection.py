from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import SoftDeleteModel


class InspectionPlan(SoftDeleteModel):
    __tablename__ = "insp_plan"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    team_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    # day / week / month
    frequency: Mapped[str] = mapped_column(String(16), nullable=False, default="day")
    # JSON 数组字符串：["泵温","液位","振动"]
    items_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class InspectionTask(SoftDeleteModel):
    __tablename__ = "insp_task"

    plan_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    plan_name: Mapped[str] = mapped_column(String(128), nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    team_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    task_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # pending / done / overdue
    task_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    items_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # 执行结果 JSON：[{name, result:normal|abnormal, remark, photo, scada_value}]
    results_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 派发指定人员
    assignee_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assignee_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    executor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    executor_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    execute_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # plan / manual
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="plan")


class InspectionRecord(SoftDeleteModel):
    """巡检历史归档（含计划任务完成 + 计划外补录）。"""

    __tablename__ = "insp_record"

    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    plan_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    plan_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    team_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    team_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    record_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    items_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_abnormal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    executor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    executor_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
    results_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class InspectionActionLog(Base):
    """巡检任务流转留痕（派发 / 认领 / 完成提交）。"""

    __tablename__ = "insp_action_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 计划外补录记录（无任务）关联巡检记录
    record_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    plan_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
