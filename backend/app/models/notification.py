"""站内消息通知。"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Notification(Base):
    __tablename__ = "sys_notification"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 接收人
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # repair / dispatch / inspection / alarm / system
    ntype: Mapped[str] = mapped_column(String(32), nullable=False, default="system")
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 关联业务类型与ID，便于点击跳转定位
    biz_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    biz_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 点击后前端路由
    path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )
