from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import SoftDeleteModel
from app.core.database import Base


class Role(SoftDeleteModel):
    __tablename__ = "sys_role"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # 数据范围：all=全部数据（默认）/ mine=仅本人相关数据（操作员）
    data_scope: Mapped[str] = mapped_column(String(16), nullable=False, default="all")
    # 按钮默认集是否已完成一次性种子：0=未种子（启动时灌入默认按钮）；
    # 1=已种子/已配置（此后管理员的任何手动修改，包括清空，都不再被启动流程回灌）
    perms_seeded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Menu(SoftDeleteModel):
    __tablename__ = "sys_menu"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    path: Mapped[str | None] = mapped_column(String(128), nullable=True)
    component: Mapped[str | None] = mapped_column(String(128), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    parent_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # directory / menu
    menu_type: Mapped[str] = mapped_column(String(16), nullable=False, default="menu")
    perms: Mapped[str | None] = mapped_column(String(128), nullable=True)
    visible: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class UserRole(Base):
    __tablename__ = "sys_user_role"
    __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_role"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)


class RoleMenu(Base):
    __tablename__ = "sys_role_menu"
    __table_args__ = (UniqueConstraint("role_id", "menu_id", name="uq_role_menu"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    menu_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
