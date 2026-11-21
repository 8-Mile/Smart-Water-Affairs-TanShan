from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import SoftEntity


class AlarmTypeCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    status: int = 1


class AlarmTypeUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    status: Optional[int] = None


class AlarmTypeOut(SoftEntity):
    name: str
    code: str
    description: Optional[str] = None


class AlarmRuleCreate(BaseModel):
    name: str
    equipment_id: int
    point_refs: str
    alarm_type_code: str
    alarm_level: int = Field(3, ge=1, le=3)
    trigger_logic: str = "any"
    compare_op: str = "gt"
    threshold: str
    delay_sec: int = 0
    debounce_sec: int = 60
    suppress_push_sec: int = 300
    enabled: int = 1
    status: int = 1
    remark: Optional[str] = None


class AlarmRuleUpdate(BaseModel):
    name: Optional[str] = None
    equipment_id: Optional[int] = None
    point_refs: Optional[str] = None
    alarm_type_code: Optional[str] = None
    alarm_level: Optional[int] = Field(None, ge=1, le=3)
    trigger_logic: Optional[str] = None
    compare_op: Optional[str] = None
    threshold: Optional[str] = None
    delay_sec: Optional[int] = None
    debounce_sec: Optional[int] = None
    suppress_push_sec: Optional[int] = None
    enabled: Optional[int] = None
    status: Optional[int] = None
    remark: Optional[str] = None


class AlarmRuleOut(SoftEntity):
    name: str
    equipment_id: int
    equipment_name: Optional[str] = None
    point_refs: str
    alarm_type_code: str
    alarm_level: int
    trigger_logic: str
    compare_op: str
    threshold: str
    delay_sec: int
    debounce_sec: int
    suppress_push_sec: int
    enabled: int
    remark: Optional[str] = None


class AlarmOut(SoftEntity):
    rule_id: int
    rule_name: str
    equipment_id: int
    equipment_name: str
    equipment_code: Optional[str] = None
    location_name: Optional[str] = None
    alarm_type_code: str
    alarm_type_name: Optional[str] = None
    alarm_level: int
    alarm_status: str
    point_refs: Optional[str] = None
    trigger_value: Optional[str] = None
    trigger_detail: Optional[str] = None
    alarm_time: datetime
    end_time: Optional[datetime] = None
    handler_id: Optional[int] = None
    handler_name: Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None
    handle_time: Optional[datetime] = None
    reject_reason: Optional[str] = None
    repair_id: Optional[int] = None
    accept_comment: Optional[str] = None
    handle_content: Optional[str] = None
    duration_sec: Optional[int] = None


class AlarmActionLogOut(BaseModel):
    id: int
    action: str
    operator_name: Optional[str] = None
    detail: Optional[str] = None
    created_at: Optional[datetime] = None


class AlarmStatsOut(BaseModel):
    pending: int
    processing: int
    pending_accept: int
    closed: int
    rejected: int
    # 待指派：未闭环且未生成关联工单的告警数（实时页「待指派」卡口径）
    unassigned: int = 0
    # 互斥划分：未处理=pending且已派工、处理中=processing且已派工（无工单部分归入待指派）
    pending_assigned: int = 0
    processing_assigned: int = 0
    by_type: List[dict]
    by_level: List[dict]
    top_equipment: List[dict]
    # 近 14 天各状态（按当前状态归属）新增告警每日序列 + 环比上一周期百分比
    status_trend: List[dict] = []
    # 近 14 天各等级每日新增告警序列（历史告警 KPI 卡迷你柱状图）
    level_trend: List[dict] = []
