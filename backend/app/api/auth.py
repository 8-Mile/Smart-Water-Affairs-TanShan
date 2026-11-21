from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.deps import CurrentUser, DbSession, get_data_scope
from app.core.response import ok
from app.core.security import create_access_token, hash_password, verify_password
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.user import User
from app.schemas.auth import LoginData, LoginRequest, UserInfo

router = APIRouter()


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=128)


def _collect_user_perms(db, user: User) -> list[str]:
    """收集用户的权限码列表（menu_type 为 menu/button 的 perms 集合）。

    同时下发菜单级码（如 dashboard:view）与按钮级码（如 eq:create），
    以对齐前端页面守卫 meta.perm（使用菜单级码）与按钮显隐（使用按钮级码）两处校验。

    super_admin 不再通配，按 role_menu 实际授权下发（仅系统管理子树）。
    """
    # 收集用户的所有 role_id
    role_ids = [r.role_id for r in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if not role_ids:
        # 回退：按 role_code 找角色
        role = db.query(Role).filter(Role.code == user.role_code, Role.deleted == 0).first()
        if role:
            role_ids = [role.id]
    if not role_ids:
        return []

    # 收集这些角色关联的 menu_id
    menu_ids = {rm.menu_id for rm in db.query(RoleMenu).filter(RoleMenu.role_id.in_(role_ids)).all()}
    if not menu_ids:
        return []

    # 查询 menu/button 类型的菜单，提取 perms（目录型 perms 为空、会被过滤）
    rows = (
        db.query(Menu)
        .filter(
            Menu.deleted == 0,
            Menu.menu_type.in_(("menu", "button")),
            Menu.perms.isnot(None),
            Menu.id.in_(menu_ids),
        )
        .all()
    )
    # 去重并过滤空字符串
    perms_set = {m.perms.strip() for m in rows if m.perms and m.perms.strip()}
    return sorted(perms_set)


@router.post("/login")
def login(body: LoginRequest, request: Request, db: DbSession):
    # 登录请求无 Authorization 头，审计中间件从这里取操作人
    request.state.audit_username = body.username
    user = (
        db.query(User)
        .filter(User.username == body.username, User.deleted == 0)
        .first()
    )
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
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

    token = create_access_token(
        subject=user.username,
        extra={"uid": user.id, "role": user.role_code, "tv": int(user.token_version or 0)},
    )
    user_info = UserInfo.model_validate(user)
    user_info.perms = _collect_user_perms(db, user)
    user_info.data_scope = get_data_scope(db, user)
    data = LoginData(access_token=token, user=user_info)
    return ok(data.model_dump())


@router.get("/me")
def me(current_user: CurrentUser, db: DbSession):
    user_info = UserInfo.model_validate(current_user)
    user_info.perms = _collect_user_perms(db, current_user)
    user_info.data_scope = get_data_scope(db, current_user)
    return ok(user_info.model_dump())


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    db: DbSession,
    current_user: CurrentUser,
):
    if not verify_password(body.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="原密码不正确")
    if body.old_password == body.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与原密码相同")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")

    current_user.password_hash = hash_password(body.new_password)
    # 版本号自增：本次改密后所有已签发令牌（含当前会话）立即失效
    current_user.token_version = int(current_user.token_version or 0) + 1
    db.add(current_user)
    db.commit()
    return ok(True, message="密码已修改，请重新登录")
