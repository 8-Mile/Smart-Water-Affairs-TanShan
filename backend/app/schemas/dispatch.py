from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class DispatchCreate(BaseModel):
    instruction_type: str = "internal"
    content: str = Field(..., min_length=1)
    executor_id: int
    expected_finish_time: datetime
    priority: str = "normal"


class DispatchUpdate(BaseModel):
    instruction_type: Optional[str] = None
    content: Optional[str] = None
    executor_id: Optional[int] = None
    expected_finish_time: Optional[datetime] = None
    priority: Optional[str] = None


class DispatchAuditRequest(BaseModel):
    passed: bool
    comment: str = Field(..., min_length=1)


class DispatchCompleteRequest(BaseModel):
    feedback: Optional[str] = None


class DispatchOut(BaseModel):
    id: int
    instruction_code: str
    instruction_type: str
    content: str
    priority: str
    publisher_name: Optional[str] = None
    publish_time: Optional[datetime] = None
    executor_id: int
    executor_name: Optional[str] = None
    expected_finish_time: datetime
    audit_status: str
    execute_status: str
    auditor_name: Optional[str] = None
    audit_time: Optional[datetime] = None
    audit_comment: Optional[str] = None
    execute_time: Optional[datetime] = None
    execute_feedback: Optional[str] = None
    logs: Optional[List[dict]] = None


class DispatchStatsOut(BaseModel):
    today_count: int
    today_vs_yesterday: float
    pending_execute: int
    pending_audit: int
    completion_rate: float
    total: int
    approved: int
    rejected: int
    done: int
