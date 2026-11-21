from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, DateTime, Float, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import SoftDeleteModel


class ScadaPoint(SoftDeleteModel):
    """SCADA 测点注册表。"""

    __tablename__ = "scada_points"

    tag_name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    node_id: Mapped[str] = mapped_column(String(128), nullable=False)
    # number / bool / string
    value_type: Mapped[str] = mapped_column(String(16), nullable=False, default="number")
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 仿真参数
    sim_base: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False, default=0)
    sim_amplitude: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False, default=1)
    sim_period_sec: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False, default=60)
    # 是否参与仿真/采集
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # —— 现场点表（力控 DZZDB）映射字段 ——
    # 原始 TagID（点表业务键，不做主键，避免序号语义冲突）
    tag_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 绑定的设备 ID（设备台账重建后回填）
    equipment_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 测点分类：electrical 电气 / temperature 温度 / hydraulic 水力 / switch 开关量 / other
    point_category: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # 量程上下限（点表 MaxValue / MinValue）
    min_value: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    max_value: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    # 告警阈值（点表 Hi/Lo/HiHi/LoLo，仅保留数值）
    hi: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    lo: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    hihi: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    lolo: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    # 告警组、历史归档间隔（秒）、IO 地址
    alarm_group: Mapped[str | None] = mapped_column(String(64), nullable=True)
    his_rec_interval: Mapped[int | None] = mapped_column(Integer, nullable=True)
    io_access: Mapped[str | None] = mapped_column(String(256), nullable=True)


class ScadaConfig(Base):
    """SCADA 接入配置（页面保存后覆盖 .env 默认值，单行记录）。"""

    __tablename__ = "scada_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="mock")
    gateway_url: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    gateway_api_prefix: Mapped[str] = mapped_column(
        String(64), nullable=False, default="/api/v1"
    )
    gateway_token: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    ingest_token: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    data_source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="mirror"
    )
    opcua_endpoint: Mapped[str] = mapped_column(
        String(256), nullable=False, default=""
    )
    opcua_security_policy: Mapped[str] = mapped_column(
        String(32), nullable=False, default="None"
    )
    opcua_auth_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="anonymous"
    )
    opcua_username: Mapped[str] = mapped_column(
        String(128), nullable=False, default=""
    )
    opcua_password: Mapped[str] = mapped_column(
        String(256), nullable=False, default=""
    )
    sim_interval_sec: Mapped[float] = mapped_column(
        Float, nullable=False, default=1.0
    )
    auto_start: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ScadaPointLatest(Base):
    """测点最新值缓存。"""

    __tablename__ = "scada_point_latest"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    point_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    tag_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(String(128), nullable=False)
    value_type: Mapped[str] = mapped_column(String(16), nullable=False, default="number")
    value_num: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    value_bool: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    value_str: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status_name: Mapped[str] = mapped_column(String(32), nullable=False, default="Good")
    ts_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ScadaTagData(Base):
    """历史时序（对齐旧表 scada_tag_data）。"""

    __tablename__ = "scada_tag_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tag_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(String(128), nullable=False)
    value_type: Mapped[str] = mapped_column(String(16), nullable=False, default="number")
    value_num: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    value_bool: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    value_str: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status_name: Mapped[str] = mapped_column(String(32), nullable=False, default="Good")
    ts_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
