"""站内消息通知接口。"""

from fastapi import APIRouter, Query
from sqlalchemy import func

from app.core.deps import CurrentUser, DbSession
from app.core.response import ok
from app.models.notification import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _to_dict(n: Notification) -> dict:
    return {
        "id": n.id,
        "ntype": n.ntype,
        "title": n.title,
        "content": n.content,
        "biz_type": n.biz_type,
        "biz_id": n.biz_id,
        "path": n.path,
        "is_read": n.is_read,
        "created_at": n.created_at,
    }


@router.get("")
def list_notifications(
    db: DbSession,
    current_user: CurrentUser,
    unread_only: int = Query(0, alias="unread_only"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.is_read == 0)
    total = q.count()
    rows = (
        q.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    unread = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == current_user.id, Notification.is_read == 0)
        .scalar()
    )
    return ok(
        {
            "list": [_to_dict(n) for n in rows],
            "total": total,
            "unread": int(unread or 0),
            "page": page,
            "page_size": page_size,
        }
    )


@router.get("/unread-count")
def unread_count(db: DbSession, current_user: CurrentUser):
    n = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == current_user.id, Notification.is_read == 0)
        .scalar()
    )
    return ok({"unread": int(n or 0)})


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, db: DbSession, current_user: CurrentUser):
    note = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
        .first()
    )
    if note and note.is_read == 0:
        note.is_read = 1
        db.commit()
    return ok({"id": notification_id, "is_read": 1})


@router.post("/read-all")
def mark_all_read(db: DbSession, current_user: CurrentUser):
    n = (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.is_read == 0,
        )
        .update({Notification.is_read: 1}, synchronize_session=False)
    )
    db.commit()
    return ok({"updated": n})
