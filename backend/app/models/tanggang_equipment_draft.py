"""Tanggang DOCUMENT_BASED_DEMO equipment staging; NOT a real equipment asset."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class TanggangDemoEquipment(Base):
    __tablename__ = "tg_demo_equipment"
    __table_args__ = (
        UniqueConstraint("code",name="uq_tg_demo_equipment_code"),
    )
    id: Mapped[int] = mapped_column(Integer,primary_key=True,autoincrement=True)
    system_id: Mapped[str] = mapped_column(String(32),nullable=False)
    name: Mapped[str] = mapped_column(String(128),nullable=False)
    code: Mapped[str] = mapped_column(String(64),nullable=False)
    parameters_note: Mapped[str | None] = mapped_column(Text,nullable=True)
    request_text: Mapped[str] = mapped_column(Text,nullable=False)
    source_note: Mapped[str] = mapped_column(String(512),nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("sys_user.id"),nullable=False,index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime,server_default=func.now(),nullable=False)
