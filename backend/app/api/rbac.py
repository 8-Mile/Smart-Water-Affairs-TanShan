from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.crud import ensure_unique, get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.core.security import hash_password
from app.models.org import Department, Team
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.user import User
from app.schemas.rbac import (
    MenuCreate,
    MenuOut,
    MenuUpdate,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    UserCreate,
    UserOut,
    UserUpdate,
)

router = APIRouter()


def _role_out(db: Session, role: Role) -> dict:
    data = RoleOut.model_validate(role).model_dump()
    menu_ids = [
        r.menu_id
        for r in db.query(RoleMenu).filter(RoleMenu.role_id == role.id).all()
    ]
    data["menu_ids"] = menu_ids
    return data


def _user_out(db: Session, user: User) -> dict:
    data = UserOut.model_validate(user).model_dump()
    if user.department_id:
        dep = (
            db.query(Department)
            .filter(Department.id == user.department_id, Department.deleted == 0)
            .first()
        )
        data["department_name"] = dep.name if dep else None
    if user.team_id:
        team = (
            db.query(Team)
            .filter(Team.id == user.team_id, Team.deleted == 0)
            .first()
        )
        data["team_name"] = team.name if team else None
    role_ids = [
        r.role_id
        for r in db.query(UserRole).filter(UserRole.user_id == user.id).all()
    ]
    data["role_ids"] = role_ids
    return data


def _set_role_menus(db: Session, role_id: int, menu_ids: list[int]) -> None:
    db.query(RoleMenu).filter(RoleMenu.role_id == role_id).delete()
    # 兜底补全祖先链：仅勾按钮而漏勾父页面时自动带上页面节点，
    # 避免「有按钮权限但页面从侧边栏消失」的断链授权
    all_menus = {
        m.id: m
        for m in db.query(Menu).filter(Menu.deleted == 0).all()
    }
    final_ids: set[int] = set(menu_ids)
    for mid in menu_ids:
        cur = all_menus.get(mid)
        while cur is not None and cur.parent_id:
            if cur.parent_id in final_ids:
                break
            final_ids.add(cur.parent_id)
            cur = all_menus.get(cur.parent_id)
    for mid in final_ids:
        db.add(RoleMenu(role_id=role_id, menu_id=mid))


def _set_user_roles(db: Session, user_id: int, role_ids: list[int]) -> None:
    db.query(UserRole).filter(UserRole.user_id == user_id).delete()
    for rid in role_ids:
        db.add(UserRole(user_id=user_id, role_id=rid))


# ---- Roles ----
@router.get("/roles")
def list_roles(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    _perm: None = Depends(require_perm("sys:user:list")),
):
    q = db.query(Role).filter(Role.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter((Role.name.like(like)) | (Role.code.like(like)))
    q = q.order_by(Role.id.asc())
    result = paginate(q, page, page_size)
    result["items"] = [_role_out(db, i) for i in result["items"]]
    return ok(result)


@router.get("/roles/options")
def role_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(Role)
        .filter(Role.deleted == 0, Role.status == 1)
        .order_by(Role.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name, "code": r.code} for r in rows])


@router.post("/roles")
def create_role(
    body: RoleCreate,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:role:assign")),
):
    ensure_unique(db, Role, "code", body.code)
    data = body.model_dump(exclude={"menu_ids"})
    obj = Role(**data)
    db.add(obj)
    db.flush()
    _set_role_menus(db, obj.id, body.menu_ids)
    db.commit()
    db.refresh(obj)
    return ok(_role_out(db, obj))


@router.put("/roles/{item_id}")
def update_role(
    item_id: int,
    body: RoleUpdate,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:role:assign")),
):
    obj = get_or_404(db, Role, item_id)
    data = body.model_dump(exclude_unset=True)
    menu_ids = data.pop("menu_ids", None)
    if "code" in data:
        ensure_unique(db, Role, "code", data["code"], exclude_id=item_id)
    for k, v in data.items():
        setattr(obj, k, v)
    if menu_ids is not None:
        _set_role_menus(db, obj.id, menu_ids)
    # menu_ids 落在独立的关联表，不更新角色行就不会触发 onupdate；
    # 权限保存后显式刷新 updated_at，避免「保存成功但时间戳没变」的错觉
    obj.updated_at = func.now()
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_role_out(db, obj))


@router.delete("/roles/{item_id}")
def delete_role(
    item_id: int,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:role:assign")),
):
    obj = get_or_404(db, Role, item_id)
    if obj.code in ("super_admin", "admin", "operator"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="系统内置角色不可删除",
        )
    soft_delete(db, obj)
    return ok(True)


# ---- Menus ----
def _build_menu_tree(menus: list[Menu]) -> list[dict]:
    nodes = {
        m.id: MenuOut.model_validate(m).model_dump() | {"children": []}
        for m in menus
    }
    roots: list[dict] = []
    for m in menus:
        node = nodes[m.id]
        if m.parent_id and m.parent_id in nodes:
            nodes[m.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


@router.get("/menus/tree")
def menu_tree(
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:user:list")),
):
    menus = (
        db.query(Menu)
        .filter(Menu.deleted == 0)
        .order_by(Menu.sort.asc(), Menu.id.asc())
        .all()
    )
    return ok(_build_menu_tree(menus))


@router.get("/menus/my")
def my_menus(db: DbSession, current_user: CurrentUser):
    """当前用户可见菜单树。"""
    # 菜单可见性统一按角色绑定（sys_role_menu）过滤，超管不再全量直通：
    # 角色界面矩阵终版——超管仅「系统管理」，领导/操作员排除「系统管理」。
    # 注意：按钮权限 _collect_user_perms 与菜单一律按角色实际授权收集，超管不再通配
    role_ids = [
        r.role_id
        for r in db.query(UserRole).filter(UserRole.user_id == current_user.id).all()
    ]
    if not role_ids:
        # 回退：按 role_code 找角色
        role = (
            db.query(Role)
            .filter(Role.code == current_user.role_code, Role.deleted == 0)
            .first()
        )
        if role:
            role_ids = [role.id]

    if not role_ids:
        return ok([])

    menu_ids = {
        rm.menu_id
        for rm in db.query(RoleMenu).filter(RoleMenu.role_id.in_(role_ids)).all()
    }
    if not menu_ids:
        return ok([])

    menus = (
        db.query(Menu)
        .filter(Menu.deleted == 0, Menu.status == 1)
        .order_by(Menu.sort.asc(), Menu.id.asc())
        .all()
    )
    by_id = {m.id: m for m in menus}
    # 仅保留「自身可见(visible=1)且祖先链全部可见」的已授权菜单：
    # 管理员在菜单管理中关闭「是否显示」后，非超管侧边栏不再渲染该菜单及其子树。
    # （旧实现补全父级时用的是无 visible 过滤的全集，导致 visible=0 的菜单依然被返回）
    final_ids: set[int] = set()
    for mid in menu_ids:
        chain: list[int] = []
        visible_ok = True
        cur = by_id.get(mid)
        while cur:
            if cur.visible != 1:
                visible_ok = False
                break
            chain.append(cur.id)
            cur = by_id.get(cur.parent_id) if cur.parent_id else None
        if visible_ok:
            final_ids.update(chain)
    # 过滤掉 button 类型节点：按钮仅用于权限计算，不参与侧边栏渲染
    # 否则按钮会作为菜单子节点出现，导致父菜单变成可展开目录而非可点击页面
    result_menus = [
        by_id[i]
        for i in final_ids
        if i in by_id and by_id[i].menu_type != "button"
    ]
    result_menus.sort(key=lambda m: (m.sort, m.id))
    return ok(_build_menu_tree(result_menus))


@router.post("/menus")
def create_menu(
    body: MenuCreate,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:menu:manage")),
):
    obj = Menu(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(MenuOut.model_validate(obj).model_dump())


@router.put("/menus/{item_id}")
def update_menu(
    item_id: int,
    body: MenuUpdate,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:menu:manage")),
):
    obj = get_or_404(db, Menu, item_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(MenuOut.model_validate(obj).model_dump())


@router.delete("/menus/{item_id}")
def delete_menu(
    item_id: int,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:menu:manage")),
):
    obj = get_or_404(db, Menu, item_id)
    child = (
        db.query(Menu)
        .filter(Menu.parent_id == item_id, Menu.deleted == 0)
        .first()
    )
    if child:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先删除子菜单",
        )
    soft_delete(db, obj)
    return ok(True)


# ---- Users ----
@router.get("/users")
def list_users(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    _perm: None = Depends(require_perm("sys:user:list")),
):
    q = db.query(User).filter(User.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (User.username.like(like))
            | (User.display_name.like(like))
            | (User.phone.like(like))
        )
    q = q.order_by(User.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_user_out(db, i) for i in result["items"]]
    return ok(result)


@router.get("/users/options")
def user_options(db: DbSession, _: CurrentUser):
    """用户轻量选项（班组成员多选等场景）。

    返回全部未删除用户（含禁用，保证已选成员可回显），禁用用户 name 后缀标注。
    """
    rows = (
        db.query(User)
        .filter(User.deleted == 0)
        .order_by(User.status.desc(), User.id.asc())
        .all()
    )
    # 批量取班组名，用于标注用户当前归属（一人一班，跨班组选择即调岗）
    team_ids = {u.team_id for u in rows if u.team_id}
    team_map = {
        t.id: t.name
        for t in db.query(Team).filter(Team.id.in_(team_ids), Team.deleted == 0).all()
    } if team_ids else {}
    return ok(
        [
            {
                "id": u.id,
                "name": u.display_name or u.username,
                "display_name": u.display_name or u.username,
                "username": u.username,
                "team_id": u.team_id,
                "team_name": team_map.get(u.team_id) if u.team_id else None,
                "role_code": u.role_code,
                "status": u.status,
            }
            for u in rows
        ]
    )


@router.post("/users")
def create_user(
    body: UserCreate,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:user:create")),
):
    exists = (
        db.query(User)
        .filter(User.username == body.username, User.deleted == 0)
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在",
        )
    # 姓名查重：排除已删除账号，避免同名用户在派单/巡检等场景混淆
    dup_name = (
        db.query(User)
        .filter(User.display_name == body.display_name, User.deleted == 0)
        .first()
    )
    if dup_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"姓名「{body.display_name}」已存在，请勿重复添加",
        )
    # 操作员必须归属班组：巡检任务池/抢单、通知均以班组为数据权限根（无班组将看不到任何任务）
    if body.role_code == "operator" and not body.team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="操作员必须归属班组，请先选择班组",
        )
    obj = User(
        username=body.username,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        phone=body.phone,
        department_id=body.department_id,
        team_id=body.team_id,
        role_code=body.role_code,
        status=body.status,
        deleted=0,
    )
    db.add(obj)
    db.flush()
    _set_user_roles(db, obj.id, body.role_ids)
    db.commit()
    db.refresh(obj)
    return ok(_user_out(db, obj))


@router.put("/users/{item_id}")
def update_user(
    item_id: int,
    body: UserUpdate,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("sys:user:update")),
):
    obj = (
        db.query(User)
        .filter(User.id == item_id, User.deleted == 0)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="用户不存在")
    data = body.model_dump(exclude_unset=True)
    # 姓名查重（排除自身）：编辑时也不允许与其他在用用户重名
    if "display_name" in data and data["display_name"] != obj.display_name:
        dup_name = (
            db.query(User)
            .filter(
                User.display_name == data["display_name"],
                User.deleted == 0,
                User.id != item_id,
            )
            .first()
        )
        if dup_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"姓名「{data['display_name']}」已存在，请勿重复添加",
            )
    role_ids = data.pop("role_ids", None)
    password = data.pop("password", None)
    prev_role = obj.role_code
    prev_status = obj.status
    for k, v in data.items():
        setattr(obj, k, v)
    # 操作员必须归属班组（编辑场景：改角色/清班组都拦下）
    final_role = obj.role_code
    final_team = obj.team_id
    if final_role == "operator" and not final_team:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="操作员必须归属班组，请先选择班组",
        )
    if password:
        obj.password_hash = hash_password(password)
    if role_ids is not None:
        _set_user_roles(db, obj.id, role_ids)
    # 改密 / 禁用 / 变更角色：令牌版本自增，使该用户已签发的令牌立即失效
    if password or obj.role_code != prev_role or (obj.status != 1 and prev_status == 1):
        obj.token_version = int(obj.token_version or 0) + 1
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_user_out(db, obj))


@router.delete("/users/{item_id}")
def delete_user(
    item_id: int,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("sys:user:delete")),
):
    if item_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除当前登录用户",
        )
    obj = (
        db.query(User)
        .filter(User.id == item_id, User.deleted == 0)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="用户不存在")
    if obj.username == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除内置管理员",
        )
    obj.deleted = 1
    db.add(obj)
    db.commit()
    return ok(True)
