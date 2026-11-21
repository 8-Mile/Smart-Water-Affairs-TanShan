from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import SoftDeleteModel


class Archive(SoftDeleteModel):
    __tablename__ = "doc_archive"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # DOC-DRAWING / DOC-POLICY / DOC-STANDARD / DOC-ACCEPTANCE / DOC-OTHER
    category_code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    category_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    file_format: Mapped[str | None] = mapped_column(String(32), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    uploader_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploader_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    upload_time: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 档案编号（如 DA20240328001），归档时自动生成或手动指定
    archive_no: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # 来源类型：自动关联 / 人工上传 / 告警关联
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 关联工单号（工单档案场景，用于串联工单流转日志）
    related_order: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # 关联设备名称
    related_equipment: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # 关联事项描述
    related_matter: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ArchiveCategory(SoftDeleteModel):
    """档案分类目录（层级：parent_id=0 为顶层；独立于档案 category_code 维护）。"""

    __tablename__ = "doc_archive_category"

    name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    parent_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ArchiveFavorite(Base):
    __tablename__ = "doc_archive_favorite"
    __table_args__ = (
        UniqueConstraint("user_id", "archive_id", name="uq_archive_fav"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    archive_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class OperationLog(Base):
    """操作审计日志（Phase 10）。"""

    __tablename__ = "sys_operation_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=200)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )
