"""Tanggang port-water CAD/scene ↔ facility ↔ business entity mapping.

Separate, versioned relationship tables; never modify SCADA or equipment records.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import SoftDeleteModel


class TanggangObjectLink(SoftDeleteModel):
    __tablename__ = "tg_object_link"
    __table_args__ = (
        UniqueConstraint("object_id", "facility_id", "system_id", name="uq_tg_object_facility_system"),
    )

    object_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    facility_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    system_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    cad_handle: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    verified: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verified_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_by: Mapped[int] = mapped_column(Integer, nullable=False)
    asset_refs: Mapped[list["TanggangLinkAsset"]] = relationship(
        back_populates="link", cascade="all, delete-orphan", lazy="selectin",
    )
    metric_refs: Mapped[list["TanggangLinkMetric"]] = relationship(
        back_populates="link", cascade="all, delete-orphan", lazy="selectin",
    )


class TanggangLinkAsset(Base):
    __tablename__ = "tg_link_asset"
    __table_args__ = (UniqueConstraint("link_id", "asset_id", name="uq_tg_link_asset"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    link_id: Mapped[int] = mapped_column(ForeignKey("tg_object_link.id"), nullable=False, index=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("eq_equipment.id"), nullable=False, index=True)
    link: Mapped[TanggangObjectLink] = relationship(back_populates="asset_refs")


class TanggangLinkMetric(Base):
    __tablename__ = "tg_link_metric"
    __table_args__ = (UniqueConstraint("link_id", "point_id", name="uq_tg_link_metric"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    link_id: Mapped[int] = mapped_column(ForeignKey("tg_object_link.id"), nullable=False, index=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("scada_points.id"), nullable=False, index=True)
    link: Mapped[TanggangObjectLink] = relationship(back_populates="metric_refs")


class TanggangLinkRevision(Base):
    __tablename__ = "tg_object_link_revision"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    link_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    before_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
