from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import SoftDeleteModel


class Department(SoftDeleteModel):
    __tablename__ = "sys_department"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Team(SoftDeleteModel):
    __tablename__ = "sys_team"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    department_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    leader: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Location(SoftDeleteModel):
    __tablename__ = "sys_location"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Unit(SoftDeleteModel):
    """机组。"""

    __tablename__ = "sys_unit"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    location_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
