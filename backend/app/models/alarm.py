from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import SoftDeleteModel


class AlarmType(SoftDeleteModel):
    __tablename__ = "alarm_type"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class AlarmRule(SoftDeleteModel):
    __tablename__ = "alarm_rule"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    equipment_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # 关联测点：tag_name 或数字 ID，逗号分隔
    point_refs: Mapped[str] = mapped_column(String(512), nullable=False)
    alarm_type_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # 1一类紧急 2二类重要 3三类一般
    alarm_level: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    # any / all
    trigger_logic: Mapped[str] = mapped_column(String(16), nullable=False, default="any")
    # gt gte lt lte eq neq
    compare_op: Mapped[str] = mapped_column(String(16), nullable=False, default="gt")
    threshold: Mapped[str] = mapped_column(String(64), nullable=False, default="0")
    # 秒：持续越限才触发
    delay_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 秒：存在未关闭同类告警时抑制新告警（去重窗口）
    debounce_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    # 秒：重复推送限制（预留）
    suppress_push_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    # 是否启用 1/0（status 也表示禁用）
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Alarm(SoftDeleteModel):
    """告警单。status 字段复用 SoftDeleteModel.status 不合适，用 alarm_status。"""

    __tablename__ = "alarm"

    # SoftDeleteModel 的 status 作记录启用，alarm_status 作业务状态
    rule_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    rule_name: Mapped[str] = mapped_column(String(128), nullable=False)
    equipment_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    equipment_name: Mapped[str] = mapped_column(String(128), nullable=False)
    equipment_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    alarm_type_code: Mapped[str] = mapped_column(String(64), nullable=False)
    alarm_type_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    alarm_level: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    # pending / processing / pending_accept / closed / rejected（驳回：可恢复关联）/ reopened（驳回重开后的吸收态，留在历史告警域跟踪，不回实时告警）
    alarm_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    point_refs: Mapped[str | None] = mapped_column(String(512), nullable=True)
    trigger_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    trigger_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    alarm_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    handler_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    handler_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assignee_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    handle_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # 高频过滤字段：stats 轮询按 派工/待指派、列表互斥筛选均依赖它（有索引）
    repair_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    accept_comment: Mapped[str | None] = mapped_column(String(255), nullable=True)
    handle_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # L2 复合索引：实时页 状态+时间范围 组合筛选（含闭环/驳回的历史域过滤）
        Index("ix_alarm_status_time", "alarm_status", "alarm_time"),
    )


class AlarmActionLog(Base):
    __tablename__ = "alarm_action_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alarm_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    operator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class AlarmPendingState(Base):
    """规则延时触发的内存外持久化：首次越限时间。"""

    __tablename__ = "alarm_pending_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    first_hit_ts: Mapped[float] = mapped_column(Float, nullable=False)
    last_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
