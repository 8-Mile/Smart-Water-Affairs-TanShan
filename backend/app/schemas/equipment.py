from datetime import date
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import SoftEntity


class EquipmentTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=1, max_length=64)
    description: Optional[str] = None
    status: int = 1


class EquipmentTypeUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    status: Optional[int] = None


class EquipmentTypeOut(SoftEntity):
    name: str
    code: str
    description: Optional[str] = None


class VendorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    enterprise_code: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    remark: Optional[str] = None
    status: int = 1


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    enterprise_code: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    remark: Optional[str] = None
    status: Optional[int] = None


class VendorOut(SoftEntity):
    name: str
    enterprise_code: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    remark: Optional[str] = None


class EquipmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    code: str = Field(..., min_length=1, max_length=64)
    type_id: int
    parent_id: Optional[int] = None
    scada_point_ids: Optional[str] = None
    health_point_id: Optional[str] = None
    fire_point_id: Optional[str] = None
    security_point_id: Optional[str] = None
    manufacturer_id: Optional[int] = None
    department_id: Optional[int] = None
    location_id: Optional[int] = None
    production_date: Optional[date] = None
    purchase_date: Optional[date] = None
    first_run_date: Optional[date] = None
    maintainer_id: Optional[int] = None
    maintain_term_days: Optional[int] = None
    running_status: str = "stopped"
    maintain_status: str = "normal"
    continuous_run_hours: float = 0
    continuous_stop_hours: float = 0
    remark: Optional[str] = None
    rated_params: Optional[str] = None
    status: int = 1


class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    type_id: Optional[int] = None
    parent_id: Optional[int] = None
    scada_point_ids: Optional[str] = None
    health_point_id: Optional[str] = None
    fire_point_id: Optional[str] = None
    security_point_id: Optional[str] = None
    manufacturer_id: Optional[int] = None
    department_id: Optional[int] = None
    location_id: Optional[int] = None
    production_date: Optional[date] = None
    purchase_date: Optional[date] = None
    first_run_date: Optional[date] = None
    maintainer_id: Optional[int] = None
    maintain_term_days: Optional[int] = None
    running_status: Optional[str] = None
    maintain_status: Optional[str] = None
    continuous_run_hours: Optional[float] = None
    continuous_stop_hours: Optional[float] = None
    remark: Optional[str] = None
    rated_params: Optional[str] = None
    status: Optional[int] = None


class EquipmentOut(SoftEntity):
    name: str
    code: str
    type_id: int
    type_name: Optional[str] = None
    parent_id: Optional[int] = None
    children: Optional[list["EquipmentOut"]] = None
    rated_params: Optional[str] = None
    scada_point_ids: Optional[str] = None
    health_point_id: Optional[str] = None
    fire_point_id: Optional[str] = None
    security_point_id: Optional[str] = None
    manufacturer_id: Optional[int] = None
    manufacturer_name: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    production_date: Optional[date] = None
    purchase_date: Optional[date] = None
    first_run_date: Optional[date] = None
    maintainer_id: Optional[int] = None
    maintainer_name: Optional[str] = None
    maintain_term_days: Optional[int] = None
    running_status: str
    maintain_status: str
    continuous_run_hours: float
    continuous_stop_hours: float
    remark: Optional[str] = None
    # 现场机组参数
    unit_no: Optional[int] = None
    pump_type: Optional[str] = None
    rated_power_kw: Optional[float] = None
    rated_current_a: Optional[float] = None
    rated_voltage_kv: Optional[float] = None
    rated_head_m: Optional[float] = None
    rated_flow_m3s: Optional[float] = None
    blade_angle_min: Optional[float] = None
    blade_angle_max: Optional[float] = None
    # 是否接入实时/历史数据（False 时前端显示“未接入”）
    has_data: Optional[bool] = None


class TimeoutWarning(BaseModel):
    """设备连续运行超时警告项（可下钻到设备详情）"""

    equipment_id: int
    equipment_code: str
    equipment_name: str
    continuous_run_hours: float
    threshold_hours: float
    message: str


class EquipmentStats(BaseModel):
    total: int
    running: int
    # 离线 = SCADA 运行状态非运行中（实时计算）
    offline: int = 0
    # 检修状态派生（未闭环维修工单投影）：pending=待检修，overhaul=检修中
    pending: int = 0
    overhaul: int
    fault: int
    running_ratio: float
    offline_ratio: float = 0
    pending_ratio: float = 0
    overhaul_ratio: float
    fault_ratio: float
    timeout_warnings: list[TimeoutWarning] = Field(default_factory=list)


EquipmentOut.model_rebuild()
