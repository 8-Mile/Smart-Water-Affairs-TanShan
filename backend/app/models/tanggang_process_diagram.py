"""Server-backed controlled SCADA-like diagram configurations (no PLC writes)."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TanggangProcessDiagram(Base):
    __tablename__ = "tg_process_diagram"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    system_id: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    draft_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    published_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by: Mapped[int] = mapped_column(ForeignKey("sys_user.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now(),
    )


class TanggangProcessDiagramRevision(Base):
    __tablename__ = "tg_process_diagram_revision"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    diagram_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    system_id: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("sys_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
