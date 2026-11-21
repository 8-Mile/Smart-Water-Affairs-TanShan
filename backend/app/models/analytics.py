from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Float, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import SoftDeleteModel


class WaterSupplyPlan(SoftDeleteModel):
    """供水计划。"""

    __tablename__ = "water_supply_plan"

    # day / month / year
    plan_type: Mapped[str] = mapped_column(String(16), nullable=False, default="day")
    plan_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    plan_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class EnergyRecord(SoftDeleteModel):
    """耗能录入。"""

    __tablename__ = "energy_record"

    record_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    unit_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    unit_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    electricity_kwh: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ElectricityPrice(SoftDeleteModel):
    """峰谷平电价。"""

    __tablename__ = "electricity_price"

    name: Mapped[str] = mapped_column(String(64), nullable=False, default="默认电价")
    peak_price: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    valley_price: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    normal_price: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    # 峰时段小时，逗号分隔，如 "8,9,10,18,19,20"
    peak_hours: Mapped[str] = mapped_column(String(128), nullable=False, default="8,9,10,18,19,20")
    # 谷时段
    valley_hours: Mapped[str] = mapped_column(String(128), nullable=False, default="0,1,2,3,4,5,23")
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class EnergyEfficiencyDaily(SoftDeleteModel):
    """机组日能效统计（由时序数据自动计算）。"""

    __tablename__ = "energy_efficiency_daily"

    stat_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    unit_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    unit_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 耗电量 kWh（有功功率对时间积分）
    electricity_kwh: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    # 运行时长 h（P > 运行阈值的累计时间）
    run_hours: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False, default=0)
    # 供水量 m³（运行时长 × 额定流量，日报无流量测点时估算）
    water_m3: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    # 单耗 kWh/m³
    unit_consumption: Mapped[Decimal] = mapped_column(Numeric(10, 5), nullable=False, default=0)
    # 平均功率 kW
    avg_power_kw: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    # 负荷率 %（平均功率 / 额定功率 × 100）
    load_rate: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    # 理论效率 %（水功率 / 轴功率，截断到 100）
    efficiency: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    # 采样点数
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
