from typing import Any, Optional

from pydantic import BaseModel, Field


class PointCreate(BaseModel):
    tag_name: str
    node_id: str
    value_type: str = "number"
    unit: str | None = None
    description: str | None = None
    source: str = "mock"
    sim_base: float = 0
    sim_amplitude: float = 1
    sim_period_sec: float = 60
    enabled: int = 1


class PointUpdate(BaseModel):
    tag_name: str | None = None
    node_id: str | None = None
    value_type: str | None = None
    unit: str | None = None
    description: str | None = None
    source: str | None = None
    sim_base: float | None = None
    sim_amplitude: float | None = None
    sim_period_sec: float | None = None
    enabled: int | None = None


class RuntimeControl(BaseModel):
    mode: str = "mock"
    interval_sec: float | None = Field(default=None, ge=0.1, le=60)


class InjectRequest(BaseModel):
    point_id: int | None = None
    tag_name: str | None = None
    value: Any
    value_type: str | None = None
    write_history: bool = True
