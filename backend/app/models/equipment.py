from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import SoftDeleteModel


class EquipmentType(SoftDeleteModel):
    __tablename__ = "eq_type"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Manufacturer(SoftDeleteModel):
    """生产厂商。"""

    __tablename__ = "eq_manufacturer"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    enterprise_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    contact_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class MaintenanceVendor(SoftDeleteModel):
    """维保厂商。"""

    __tablename__ = "eq_maintenance_vendor"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    enterprise_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    contact_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Equipment(SoftDeleteModel):
    __tablename__ = "eq_equipment"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    type_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # 父设备 ID，NULL 表示顶级设备（机组/闸门等），子设备指向父设备
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # SCADA 变量 ID，逗号分隔，如 700,701,702
    scada_point_ids: Mapped[str | None] = mapped_column(String(512), nullable=True)
    health_point_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    fire_point_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    security_point_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    manufacturer_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    department_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    location_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    first_run_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    maintainer_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    maintain_term_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # running / stopped / overhaul
    running_status: Mapped[str] = mapped_column(String(32), nullable=False, default="stopped")
    # normal / need_maintain / fault
    maintain_status: Mapped[str] = mapped_column(String(32), nullable=False, default="normal")
    continuous_run_hours: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # 累计停机小时数（启停事件聚合自动累加，允许设备档案手动修正）
    continuous_stop_hours: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 扩展档案字段（按父级分组模板差异化）：JSON 字符串，如 {"装机容量":"1600kW"}
    rated_params: Mapped[str | None] = mapped_column(Text, nullable=True)
    # —— 现场机组参数（点表/日报反推额定值）——
    # 机组编号 1~5，公共设备为 NULL
    unit_no: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 泵型：轴流泵 / 离心泵 / 混流泵
    pump_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 额定参数
    rated_power_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    rated_current_a: Mapped[float | None] = mapped_column(Float, nullable=True)
    rated_voltage_kv: Mapped[float | None] = mapped_column(Float, nullable=True)
    rated_head_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    rated_flow_m3s: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 可调叶片角度范围
    blade_angle_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    blade_angle_max: Mapped[float | None] = mapped_column(Float, nullable=True)


class EquipmentRunEvent(SoftDeleteModel):
    """设备启停事件记录，用于统计连续运行/停机时长与累计运行时间。"""

    __tablename__ = "eq_run_event"

    equipment_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    equipment_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # start / stop
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    event_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    # 自动=auto / 手动=manual
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
