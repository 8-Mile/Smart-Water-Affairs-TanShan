from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import SoftEntity


class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=1, max_length=64)
    remark: Optional[str] = None
    status: int = 1


class DepartmentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    code: Optional[str] = Field(None, min_length=1, max_length=64)
    remark: Optional[str] = None
    status: Optional[int] = None


class DepartmentOut(SoftEntity):
    name: str
    code: str
    remark: Optional[str] = None


class TeamCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=1, max_length=64)
    department_id: Optional[int] = None
    leader: Optional[str] = None
    # 班组成员用户 ID 集合：保存时反向同步 sys_user.team_id
    member_ids: Optional[List[int]] = None
    remark: Optional[str] = None
    status: int = 1


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    department_id: Optional[int] = None
    leader: Optional[str] = None
    member_ids: Optional[List[int]] = None
    remark: Optional[str] = None
    status: Optional[int] = None


class TeamOut(SoftEntity):
    name: str
    code: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    leader: Optional[str] = None
    member_ids: List[int] = Field(default_factory=list)
    member_names: List[str] = Field(default_factory=list)
    remark: Optional[str] = None


class LocationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    code: str = Field(..., min_length=1, max_length=64)
    parent_id: Optional[int] = None
    remark: Optional[str] = None
    status: int = 1


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    parent_id: Optional[int] = None
    remark: Optional[str] = None
    status: Optional[int] = None


class LocationOut(SoftEntity):
    name: str
    code: str
    parent_id: Optional[int] = None
    remark: Optional[str] = None


class UnitCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=1, max_length=64)
    location_id: Optional[int] = None
    remark: Optional[str] = None
    status: int = 1


class UnitUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    location_id: Optional[int] = None
    remark: Optional[str] = None
    status: Optional[int] = None


class UnitOut(SoftEntity):
    name: str
    code: str
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    remark: Optional[str] = None
