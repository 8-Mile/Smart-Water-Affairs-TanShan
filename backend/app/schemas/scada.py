from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.common import SoftEntity


class ScadaConfigIn(BaseModel):
    """SCADA 接入配置入参（保存/测试共用）。"""

    mode: Literal["mock", "gateway", "opcua"] = "mock"
    gateway_url: str = ""
    gateway_api_prefix: str = "/api/v1"
    # 为空表示沿用已保存的令牌
    gateway_token: Optional[str] = None
    ingest_token: Optional[str] = None
    data_source: Literal["mirror", "gateway"] = "mirror"
    opcua_endpoint: str = ""
    opcua_security_policy: str = "None"
    opcua_auth_mode: Literal["anonymous", "username"] = "anonymous"
    opcua_username: str = ""
    opcua_password: Optional[str] = None
    sim_interval_sec: float = Field(default=1.0, ge=0.1, le=60)
    auto_start: bool = True


class ScadaConfigTestIn(ScadaConfigIn):
    """连接测试入参，可指定一个测点做取数验证。"""

    sample_tag: Optional[str] = None


class ScadaPointCreate(BaseModel):
    tag_name: str = Field(..., min_length=1, max_length=128)
    node_id: str = Field(..., min_length=1, max_length=128)
    value_type: str = "number"
    unit: Optional[str] = None
    description: Optional[str] = None
    sim_base: float = 0
    sim_amplitude: float = 1
    sim_period_sec: float = 60
    enabled: int = 1
    status: int = 1


class ScadaPointUpdate(BaseModel):
    tag_name: Optional[str] = None
    node_id: Optional[str] = None
    value_type: Optional[str] = None
    unit: Optional[str] = None
    description: Optional[str] = None
    sim_base: Optional[float] = None
    sim_amplitude: Optional[float] = None
    sim_period_sec: Optional[float] = None
    enabled: Optional[int] = None
    status: Optional[int] = None


class ScadaPointOut(SoftEntity):
    tag_name: str
    node_id: str
    value_type: str
    unit: Optional[str] = None
    description: Optional[str] = None
    sim_base: float
    sim_amplitude: float
    sim_period_sec: float
    enabled: int
    # 现场点表映射字段
    tag_id: Optional[int] = None
    equipment_id: Optional[int] = None
    point_category: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    hi: Optional[float] = None
    lo: Optional[float] = None
    hihi: Optional[float] = None
    lolo: Optional[float] = None
    alarm_group: Optional[str] = None
    his_rec_interval: Optional[int] = None
    io_access: Optional[str] = None
    latest_value: Optional[Any] = None
    latest_ts_ms: Optional[int] = None
    status_name: Optional[str] = None


class ScadaLatestOut(BaseModel):
    point_id: int
    tag_name: str
    node_id: str
    value_type: str
    value_num: Optional[float] = None
    value_bool: Optional[bool] = None
    value_str: Optional[str] = None
    display_value: Optional[Any] = None
    status_code: int
    status_name: str
    ts_ms: int
    updated_at: Optional[datetime] = None
    unit: Optional[str] = None
    description: Optional[str] = None


class ScadaHistoryOut(BaseModel):
    id: int
    tag_name: str
    node_id: str
    value_type: str
    value_num: Optional[float] = None
    value_bool: Optional[bool] = None
    value_str: Optional[str] = None
    status_name: str
    ts_ms: int
    created_at: Optional[datetime] = None


class ScadaRuntimeControl(BaseModel):
    mode: str = "mock"
    interval_sec: Optional[float] = Field(None, ge=0.2, le=60)


class ScadaInjectRequest(BaseModel):
    point_id: Optional[int] = None
    tag_name: Optional[str] = None
    value: Any
    value_type: Optional[str] = None
    write_history: bool = True


class EquipmentPointValue(BaseModel):
    equipment_id: int
    equipment_name: str
    equipment_code: str
    point_id_raw: str
    tag_name: Optional[str] = None
    display_value: Optional[Any] = None
    value_type: Optional[str] = None
    unit: Optional[str] = None
    ts_ms: Optional[int] = None
    point_category: Optional[str] = None
    description: Optional[str] = None
    found: bool = False
