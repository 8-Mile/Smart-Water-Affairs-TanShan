"""站内消息通知服务：业务动作点统一调用，落库 + 事务提交后 WS 实时推送。"""

from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.notification import Notification
from app.models.user import User
from app.services.user_ws import user_ws_hub

MANAGER_ROLES = ("super_admin", "admin")
SUPER_ADMIN_ROLE = "super_admin"
_PENDING_KEY = "_pending_notifications"
_HOOK_KEY = "_notify_hook_installed"


def _install_commit_hook(db: Session) -> None:
    if db.info.get(_HOOK_KEY):
        return
    db.info[_HOOK_KEY] = True
    db.info[_PENDING_KEY] = []

    def _after_commit(session: Session) -> None:
        pending = session.info.get(_PENDING_KEY) or []
        session.info[_PENDING_KEY] = []
        for payload in pending:
            user_ws_hub.send_to_user_threadsafe(
                payload["user_id"], "notification.new", payload
            )

    def _after_rollback(session: Session) -> None:
        session.info[_PENDING_KEY] = []

    event.listen(db, "after_commit", _after_commit)
    event.listen(db, "after_rollback", _after_rollback)


def notify_users(
    db: Session,
    user_ids: Iterable[int],
    title: str,
    *,
    content: Optional[str] = None,
    ntype: str = "system",
    biz_type: Optional[str] = None,
    biz_id: Optional[str] = None,
    path: Optional[str] = None,
) -> int:
    """给指定用户发消息（调用方无需关心提交时机，提交后自动推送）。"""
    ids = {uid for uid in user_ids if uid}
    if not ids:
        return 0
    # 超管不接收站内消息：所有发送路径（角色广播/班组/定点）的唯一入口统一过滤
    ids = {
        uid
        for (uid,) in db.query(User.id)
        .filter(User.id.in_(ids), User.role_code != SUPER_ADMIN_ROLE)
        .all()
    }
    if not ids:
        return 0
    _install_commit_hook(db)
    notes: list[Notification] = []
    for uid in ids:
        note = Notification(
            user_id=uid,
            ntype=ntype,
            title=title,
            content=content,
            biz_type=biz_type,
            biz_id=str(biz_id) if biz_id is not None else None,
            path=path,
            is_read=0,
        )
        db.add(note)
        notes.append(note)
    db.flush()
    for n in notes:
        db.info[_PENDING_KEY].append(
            {
                "id": n.id,
                "user_id": n.user_id,
                "ntype": n.ntype,
                "title": n.title,
                "content": n.content,
                "biz_type": n.biz_type,
                "biz_id": n.biz_id,
                "path": n.path,
                "created_at": n.created_at,
            }
        )
    return len(notes)


def notify_roles(
    db: Session,
    role_codes: Iterable[str],
    title: str,
    *,
    content: Optional[str] = None,
    ntype: str = "system",
    biz_type: Optional[str] = None,
    biz_id: Optional[str] = None,
    path: Optional[str] = None,
    exclude_user_ids: Iterable[int] = (),
) -> int:
    """按角色广播消息（如所有管理员）。"""
    exclude = set(exclude_user_ids)
    users = (
        db.query(User)
        .filter(
            User.deleted == 0,
            User.status == 1,
            User.role_code.in_(tuple(role_codes)),
        )
        .all()
    )
    ids = [u.id for u in users if u.id not in exclude]
    return notify_users(
        db,
        ids,
        title,
        content=content,
        ntype=ntype,
        biz_type=biz_type,
        biz_id=biz_id,
        path=path,
    )


def notify_managers(
    db: Session,
    title: str,
    *,
    content: Optional[str] = None,
    ntype: str = "system",
    biz_type: Optional[str] = None,
    biz_id: Optional[str] = None,
    path: Optional[str] = None,
    exclude_user_ids: Iterable[int] = (),
) -> int:
    """通知全部管理员（超管+领导）。"""
    return notify_roles(
        db,
        MANAGER_ROLES,
        title,
        content=content,
        ntype=ntype,
        biz_type=biz_type,
        biz_id=biz_id,
        path=path,
        exclude_user_ids=exclude_user_ids,
    )


def notify_team(
    db: Session,
    team_id: int,
    title: str,
    *,
    content: Optional[str] = None,
    ntype: str = "inspection",
    biz_type: Optional[str] = None,
    biz_id: Optional[str] = None,
    path: str = "/inspection/tasks",
) -> int:
    """通知班组全体成员。"""
    users = (
        db.query(User)
        .filter(User.deleted == 0, User.status == 1, User.team_id == team_id)
        .all()
    )
    return notify_users(
        db,
        [u.id for u in users],
        title,
        content=content,
        ntype=ntype,
        biz_type=biz_type,
        biz_id=biz_id,
        path=path,
    )
