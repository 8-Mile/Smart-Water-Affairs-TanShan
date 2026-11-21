from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class MaintenancePlanCreate(BaseModel):
    name: str
    plan_type: str = "overhaul"
    start_date: date
    cycle_days: int = Field(30, ge=1)
    advance_days: int = Field(3, ge=0)
    equipment_ids: List[int] = Field(default_factory=list)
    enabled: int = 1
    need_accept: int = 0
    # 默认执行人：新建必选
    default_assignee_id: int
    remark: Optional[str] = None


class MaintenancePlanUpdate(BaseModel):
    name: Optional[str] = None
    plan_type: Optional[str] = None
    start_date: Optional[date] = None
    cycle_days: Optional[int] = Field(None, ge=1)
    advance_days: Optional[int] = Field(None, ge=0)
    equipment_ids: Optional[List[int]] = None
    enabled: Optional[int] = None
    need_accept: Optional[int] = None
    default_assignee_id: Optional[int] = None
    remark: Optional[str] = None
    status: Optional[int] = None


class MaintenancePlanDispatch(BaseModel):
    """手动派发参数：可指定维保执行人并附派发备注。"""

    assignee_id: Optional[int] = None
    remark: Optional[str] = None


class MaintenancePlanOut(BaseModel):
    id: int
    name: str
    plan_type: str
    start_date: date
    cycle_days: int
    advance_days: int
    equipment_ids: List[int] = Field(default_factory=list)
    equipment_names: List[str] = Field(default_factory=list)
    enabled: int
    last_dispatch_date: Optional[date] = None
    remark: Optional[str] = None
    status: int = 1


class MaintenanceRecordComplete(BaseModel):
    content: Optional[str] = None
    remark: Optional[str] = None
    # 维保执行中发现异常的问题描述；非空时自动转维修工单（source=maintenance）
    issue_found: Optional[str] = None


class MaintenanceRecordAccept(BaseModel):
    """维保验收：通过 → done；驳回 → 退回待执行。"""

    passed: bool
    comment: Optional[str] = None


class MaintenanceRecordCreate(BaseModel):
    equipment_id: int
    maintain_type: str = "overhaul"
    content: str
    remark: Optional[str] = None


class MaintenanceRecordOut(BaseModel):
    id: int
    plan_id: Optional[int] = None
    plan_name: Optional[str] = None
    equipment_id: int
    equipment_name: Optional[str] = None
    equipment_code: Optional[str] = None
    maintain_type: str
    record_status: str
    due_date: Optional[date] = None
    content: Optional[str] = None
    operator_name: Optional[str] = None
    operate_time: Optional[datetime] = None
    remark: Optional[str] = None
    acceptor_name: Optional[str] = None
    accept_time: Optional[datetime] = None
    accept_comment: Optional[str] = None
    source: str


class LedgerItemOut(BaseModel):
    id: int
    equipment_code: Optional[str] = None
    equipment_name: Optional[str] = None
    operate_type: str
    operator_name: Optional[str] = None
    operate_time: Optional[datetime] = None
    content: Optional[str] = None
    remark: Optional[str] = None
    source: str
