"""Document-based Tanggang SCADA-point reviews, isolated from legacy SCADA rows.

No observation, PLC command, simulated value, equipment status or alarm is
created or changed here. This ledger tracks provenance of proposed mappings.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TanggangPointReview(Base):
    __tablename__ = "tg_point_review"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    point_id: Mapped[int] = mapped_column(
        ForeignKey("scada_points.id"), nullable=False, unique=True, index=True,
    )
    system_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    basis_type: Mapped[str] = mapped_column(String(32), nullable=False, default="UNVERIFIED")
    source_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    assumption_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now(),
    )


class TanggangPointReviewRevision(Base):
    __tablename__ = "tg_point_review_revision"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    point_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    before_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_json: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(),
    )
