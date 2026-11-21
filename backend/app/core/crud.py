"""通用软删除 CRUD 辅助。"""

from typing import Any, Optional, Type, TypeVar

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.base import SoftDeleteModel

ModelT = TypeVar("ModelT", bound=SoftDeleteModel)


def not_deleted(query, model: Type[ModelT]):
    return query.filter(model.deleted == 0)


def get_or_404(db: Session, model: Type[ModelT], item_id: int) -> ModelT:
    obj = (
        db.query(model)
        .filter(model.id == item_id, model.deleted == 0)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    return obj


def soft_delete(db: Session, obj: SoftDeleteModel) -> None:
    obj.deleted = 1
    db.add(obj)
    db.commit()


def paginate(
    query,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def ensure_unique(
    db: Session,
    model: Type[ModelT],
    field_name: str,
    value: Any,
    exclude_id: Optional[int] = None,
    message: str = "编码已存在",
) -> None:
    if value is None or value == "":
        return
    col = getattr(model, field_name)
    q = db.query(model).filter(col == value, model.deleted == 0)
    if exclude_id is not None:
        q = q.filter(model.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
