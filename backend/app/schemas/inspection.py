from datetime import date, datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class InspectionItem(BaseModel):
    """巡检项 = 设备 + 检查内容。

    equipment_id/equipment_name 可空：兼容历史纯文本数据（仅 check_item）。
    """

    equipment_id: Optional[int] = None
    equipment_name: Optional[str] = None
    check_item: str


class InspectionResult(BaseModel):
    """任务执行结果项。result: normal / abnormal"""

    equipment_id: Optional[int] = None
    equipment_name: Optional[str] = None
    check_item: str
    result: str = "normal"
    remark: Optional[str] = None
    photo: Optional[str] = None


class InspectionPlanCreate(BaseModel):
    name: str
    team_id: int
    start_date: date
    end_date: date
    frequency: str = "day"
    items: List[InspectionItem] = Field(default_factory=list)
    enabled: int = 1
    remark: Optional[str] = None


class InspectionPlanUpdate(BaseModel):
    name: Optional[str] = None
    team_id: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    frequency: Optional[str] = None
    items: Optional[List[InspectionItem]] = None
    enabled: Optional[int] = None
    remark: Optional[str] = None
    status: Optional[int] = None


class InspectionPlanOut(BaseModel):
    id: int
    name: str
    team_id: int
    team_name: Optional[str] = None
    start_date: date
    end_date: date
    frequency: str
    items: List[InspectionItem] = Field(default_factory=list)
    enabled: int
    last_dispatch_date: Optional[date] = None
    remark: Optional[str] = None
    status: int = 1


class InspectionTaskComplete(BaseModel):
    results: List[InspectionResult] = Field(default_factory=list)
    remark: Optional[str] = None


class InspectionTaskDispatch(BaseModel):
    assignee_id: Optional[int] = None


class InspectionTaskOut(BaseModel):
    id: int
    plan_id: int
    plan_name: str
    team_id: int
    team_name: Optional[str] = None
    task_date: date
    task_status: str
    items: List[InspectionItem] = Field(default_factory=list)
    results: Optional[List[InspectionResult]] = None
    executor_name: Optional[str] = None
    execute_time: Optional[datetime] = None
    source: str


class InspectionRecordOut(BaseModel):
    id: int
    task_id: Optional[int] = None
    plan_id: Optional[int] = None
    plan_name: Optional[str] = None
    team_name: Optional[str] = None
    record_date: date
    items_summary: Optional[str] = None
    has_abnormal: int
    executor_name: Optional[str] = None
    remark: Optional[str] = None
    results: Optional[List[InspectionResult]] = None


class InspectionRecordCreate(BaseModel):
    plan_name: Optional[str] = "计划外巡检"
    team_id: Optional[int] = None
    record_date: Optional[date] = None
    results: List[InspectionResult] = Field(default_factory=list)
    remark: Optional[str] = None
