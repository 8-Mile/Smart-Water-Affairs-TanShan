from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class RepairCreate(BaseModel):
    equipment_id: int
    description: str = Field(..., min_length=1)
    repair_type: str = "overhaul"
    fault_category: Optional[str] = None
    fault_time: Optional[datetime] = None
    worker_id: Optional[int] = None
    apply_images: Optional[str] = None
    # 工单来源：alarm（告警关联）/ inspection（巡检关联）/ manual（人工创建）
    source: str = "manual"
    # 巡检来源工单：关联巡检记录 id；携带时来源强制为 inspection
    inspection_record_id: Optional[int] = None


class RepairDispatchRequest(BaseModel):
    worker_id: int
    comment: Optional[str] = None


class RepairRejectRequest(BaseModel):
    # 驳回理由必填：驳回是终态决策，必须留痕可追溯
    comment: str = Field(..., min_length=1, max_length=255)


class RepairCompleteRequest(BaseModel):
    feedback: str = Field(..., min_length=1)
    images: Optional[str] = None


class RepairAcceptRequest(BaseModel):
    pass_accept: bool = True
    comment: Optional[str] = None


class RepairOut(BaseModel):
    id: int
    order_no: str
    name: str
    equipment_id: Optional[int] = None
    equipment_name: Optional[str] = None
    equipment_code: Optional[str] = None
    alarm_id: Optional[int] = None
    process_status: str
    description: Optional[str] = None
    source: str
    repair_type: str
    fault_category: Optional[str] = None
    fault_time: Optional[datetime] = None
    applicant_name: Optional[str] = None
    apply_time: Optional[datetime] = None
    apply_images: Optional[str] = None
    approver_name: Optional[str] = None
    approve_time: Optional[datetime] = None
    approve_comment: Optional[str] = None
    worker_id: Optional[int] = None
    worker_name: Optional[str] = None
    process_start_time: Optional[datetime] = None
    process_end_time: Optional[datetime] = None
    process_feedback: Optional[str] = None
    process_images: Optional[str] = None
    acceptor_name: Optional[str] = None
    accept_time: Optional[datetime] = None
    accept_comment: Optional[str] = None
    status: int = 1
    logs: Optional[List[dict]] = None

    model_config = {"from_attributes": True}


class RepairStatsOut(BaseModel):
    pending_dispatch: int
    processing: int
    pending_accept: int
    archived: int
    rejected: int
    total: int
