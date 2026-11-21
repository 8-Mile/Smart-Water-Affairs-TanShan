from datetime import datetime
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class PageParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=200)


class PageResult(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int


class OrmBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class IdName(OrmBase):
    id: int
    name: str


class SoftEntity(OrmBase):
    id: int
    status: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
