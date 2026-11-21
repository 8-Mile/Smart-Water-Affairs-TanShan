from datetime import datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import TokenError, get_payload
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.user import User

security_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(security_scheme)
    ] = None,
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或令牌缺失",
        )
    try:
        payload = get_payload(credentials.credentials)
    except TokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="长时间未操作已退出登录",
        ) from None
    username = str(payload.get("sub") or "")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="长时间未操作已退出登录",
        )

    user = db.query(User).filter(User.username == username, User.deleted == 0).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )
    # 令牌版本校验：改密/禁用/变更角色后旧令牌立即失效
    if int(payload.get("tv", 0)) != int(user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态已失效，请重新登录",
        )
    if user.status != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="用户已禁用",
        )
    if user.temp_expire_at and user.temp_expire_at <= datetime.now():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="临时授权已过期",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_data_scope(db: Session, user: User) -> str:
    """用户数据范围：取其角色（user.role_code 对应 sys_role）的 data_scope。

    all=全部数据（默认）；mine=仅本人相关数据（操作员）。
    super_admin 恒为 all；角色缺失时回退 all。
    """
    if user.role_code == "super_admin":
        return "all"
    role = db.query(Role).filter(Role.code == user.role_code, Role.deleted == 0).first()
    if role and role.data_scope:
        return role.data_scope
    return "all"


def is_mine_scope(db: Session, user: User) -> bool:
    """是否「仅本人」数据范围（列表硬过滤用，替换 role_code=='operator' 硬编码）。"""
    return get_data_scope(db, user) == "mine"


def collect_user_perms(db: Session, user: User) -> set[str]:
    """收集用户的权限码集合（menu_type 为 menu/button 的 perms）。

    与前端 hasPerm / auth.py 的 _collect_user_perms 同口径：
    user → user_role → role_menu → menu(menu/button)；super_admin 不再通配，
    按实际授权收集（仅系统管理子树，见 bootstrap._seed_role_menus）。
    菜单级码供前端页面守卫 meta.perm 校验，按钮级码供接口级 require_perm 校验。
    """
    role_ids = [
        r.role_id
        for r in db.query(UserRole).filter(UserRole.user_id == user.id).all()
    ]
    if not role_ids:
        # 回退：按 role_code 找角色
        role = db.query(Role).filter(Role.code == user.role_code, Role.deleted == 0).first()
        if role:
            role_ids = [role.id]
    if not role_ids:
        return set()

    menu_ids = {
        rm.menu_id
        for rm in db.query(RoleMenu).filter(RoleMenu.role_id.in_(role_ids)).all()
    }
    if not menu_ids:
        return set()

    rows = (
        db.query(Menu.perms)
        .filter(
            Menu.deleted == 0,
            Menu.menu_type.in_(("menu", "button")),
            Menu.perms.isnot(None),
            Menu.id.in_(menu_ids),
        )
        .all()
    )
    return {(p or "").strip() for (p,) in rows if p and p.strip()}


def require_super_admin(user: CurrentUser) -> User:
    """仅超级管理员可访问（不受角色菜单授权影响）。"""
    if user.role_code != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅超级管理员可执行该操作",
        )
    return user


SuperAdmin = Annotated[User, Depends(require_super_admin)]


def require_perm(code: str):
    """接口级按钮权限依赖工厂：持有权限码（role_menu 实际授权）放行，否则 403。

    用法：current_user: User = Depends(require_perm('eq:run:event'))
    """

    def _dep(db: DbSession, user: CurrentUser) -> User:
        perms = collect_user_perms(db, user)
        if code in perms:
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"无操作权限：缺少 {code}",
        )

    return _dep
