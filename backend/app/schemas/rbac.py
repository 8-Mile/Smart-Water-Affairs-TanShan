from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import SoftEntity


class RoleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=1, max_length=64)
    remark: Optional[str] = None
    status: int = 1
    menu_ids: List[int] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    remark: Optional[str] = None
    status: Optional[int] = None
    menu_ids: Optional[List[int]] = None


class RoleOut(SoftEntity):
    name: str
    code: str
    remark: Optional[str] = None
    menu_ids: List[int] = Field(default_factory=list)


class MenuCreate(BaseModel):
    name: str
    path: Optional[str] = None
    component: Optional[str] = None
    icon: Optional[str] = None
    parent_id: int = 0
    sort: int = 0
    menu_type: str = "menu"
    perms: Optional[str] = None
    visible: int = 1
    status: int = 1


class MenuUpdate(BaseModel):
    name: Optional[str] = None
    path: Optional[str] = None
    component: Optional[str] = None
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    sort: Optional[int] = None
    menu_type: Optional[str] = None
    perms: Optional[str] = None
    visible: Optional[int] = None
    status: Optional[int] = None


class MenuOut(SoftEntity):
    name: str
    path: Optional[str] = None
    component: Optional[str] = None
    icon: Optional[str] = None
    parent_id: int
    sort: int
    menu_type: str
    perms: Optional[str] = None
    visible: int
    children: List["MenuOut"] = Field(default_factory=list)


class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=64)
    phone: Optional[str] = None
    department_id: Optional[int] = None
    team_id: Optional[int] = None
    role_code: str
    role_ids: List[int] = Field(default_factory=list)
    status: int = 1


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    phone: Optional[str] = None
    department_id: Optional[int] = None
    team_id: Optional[int] = None
    role_code: Optional[str] = None
    role_ids: Optional[List[int]] = None
    status: Optional[int] = None
    password: Optional[str] = Field(None, min_length=6, max_length=128)
    temp_expire_at: Optional[datetime] = None


class UserOut(SoftEntity):
    username: str
    display_name: str
    phone: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    role_code: str
    role_ids: List[int] = Field(default_factory=list)
    status: int = 1
    temp_expire_at: Optional[datetime] = None
