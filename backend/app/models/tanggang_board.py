"""Tanggang controlled A2UI dashboard layout, NOT arbitrary executable Vue/JS."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TanggangBoard(Base):
    __tablename__ = "tg_a2ui_board"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    target_path: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("sys_user.id"), nullable=False, index=True)
    widgets_json: Mapped[str] = mapped_column(Text, nullable=False)
    # Drafts are owner-only; publishing is allowed only by existing menu admins.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    allowed_roles_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now(),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class TanggangBoardRevision(Base):
    __tablename__ = "tg_a2ui_board_revision"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    board_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
