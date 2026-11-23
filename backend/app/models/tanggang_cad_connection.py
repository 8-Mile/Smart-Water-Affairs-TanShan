"""M19 evidence-association hypotheses, not hydraulic connectivity approvals."""
from datetime import datetime
from sqlalchemy import (
    DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class TanggangCadConnectionCandidate(Base):
    __tablename__ = "tg_cad_connection_candidate"
    __table_args__ = (
        UniqueConstraint("system_id", "connection_id", name="uq_tg_cad_candidate_system_connection"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    system_id: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    connection_id: Mapped[str] = mapped_column(String(64), nullable=False)
    layer: Mapped[str] = mapped_column(String(100), nullable=False)
    source_handles_json: Mapped[str] = mapped_column(Text, nullable=False)
    review_note: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="candidate")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    evidence_version: Mapped[str] = mapped_column(String(24), nullable=False, default="L1 V2.8")
    updated_by: Mapped[int] = mapped_column(ForeignKey("sys_user.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now(),
    )


class TanggangCadConnectionCandidateRevision(Base):
    __tablename__ = "tg_cad_connection_candidate_revision"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    system_id: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    connection_id: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("sys_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
