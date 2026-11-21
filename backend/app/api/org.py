from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.crud import ensure_unique, get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.org import Department, Location, Team, Unit
from app.models.user import User
from app.schemas.org import (
    DepartmentCreate,
    DepartmentOut,
    DepartmentUpdate,
    LocationCreate,
    LocationOut,
    LocationUpdate,
    TeamCreate,
    TeamOut,
    TeamUpdate,
    UnitCreate,
    UnitOut,
    UnitUpdate,
)

router = APIRouter()


def _apply_update(obj, data: dict) -> None:
    for k, v in data.items():
        setattr(obj, k, v)


# ---- Department ----
@router.get("/departments")
def list_departments(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
):
    q = db.query(Department).filter(Department.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter((Department.name.like(like)) | (Department.code.like(like)))
    q = q.order_by(Department.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [DepartmentOut.model_validate(i).model_dump() for i in result["items"]]
    return ok(result)


@router.get("/departments/options")
def department_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(Department)
        .filter(Department.deleted == 0, Department.status == 1)
        .order_by(Department.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name, "code": r.code} for r in rows])


@router.post("/departments")
def create_department(body: DepartmentCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:create"))):
    ensure_unique(db, Department, "code", body.code)
    obj = Department(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(DepartmentOut.model_validate(obj).model_dump())


@router.put("/departments/{item_id}")
def update_department(
    item_id: int, body: DepartmentUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:update"))):
    obj = get_or_404(db, Department, item_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        ensure_unique(db, Department, "code", data["code"], exclude_id=item_id)
    _apply_update(obj, data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(DepartmentOut.model_validate(obj).model_dump())


@router.delete("/departments/{item_id}")
def delete_department(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:delete"))):
    obj = get_or_404(db, Department, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- Team ----
def _sync_team_members(db: Session, team_id: int, member_ids: list[int] | None) -> None:
    """反向同步班组成员关系（sys_user.team_id）。

    - 新成员：team_id 置为当前班组
    - 被移除的原成员：team_id 置空
    member_ids=None 表示本次请求不涉及成员变更（PUT 局部更新）。
    """
    if member_ids is None:
        return
    target_ids = set(member_ids)
    members = (
        db.query(User)
        .filter(User.deleted == 0, User.id.in_(target_ids))
        .all()
        if target_ids
        else []
    )
    valid_ids = {u.id for u in members}
    # 加入：选中的用户归属到本班组
    for u in members:
        u.team_id = team_id
        db.add(u)
    # 移出：原属于本班组但不在新名单中的用户解除归属
    removed = (
        db.query(User)
        .filter(User.deleted == 0, User.team_id == team_id, User.id.notin_(valid_ids or [0]))
        .all()
    )
    for u in removed:
        u.team_id = None
        db.add(u)


def _team_out(db: Session, t: Team) -> dict:
    data = TeamOut.model_validate(t).model_dump()
    if t.department_id:
        dep = (
            db.query(Department)
            .filter(Department.id == t.department_id, Department.deleted == 0)
            .first()
        )
        data["department_name"] = dep.name if dep else None
    # 成员关系实时从 sys_user 聚合（成员维护入口在班组页，归属落在用户表）
    members = (
        db.query(User)
        .filter(User.deleted == 0, User.team_id == t.id)
        .order_by(User.id.asc())
        .all()
    )
    data["member_ids"] = [u.id for u in members]
    # 与 /users/options 口径一致：优先显示名称，空则回退登录账号
    data["member_names"] = [u.display_name or u.username for u in members]
    return data


@router.get("/teams")
def list_teams(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
):
    q = db.query(Team).filter(Team.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter((Team.name.like(like)) | (Team.code.like(like)))
    q = q.order_by(Team.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_team_out(db, i) for i in result["items"]]
    return ok(result)


@router.get("/teams/options")
def team_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(Team)
        .filter(Team.deleted == 0, Team.status == 1)
        .order_by(Team.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name, "code": r.code} for r in rows])


@router.post("/teams")
def create_team(body: TeamCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:create"))):
    ensure_unique(db, Team, "code", body.code)
    payload = body.model_dump(exclude={"member_ids"})
    obj = Team(**payload)
    db.add(obj)
    db.flush()
    _sync_team_members(db, obj.id, body.member_ids)
    db.commit()
    db.refresh(obj)
    return ok(_team_out(db, obj))


@router.put("/teams/{item_id}")
def update_team(item_id: int, body: TeamUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:update"))):
    obj = get_or_404(db, Team, item_id)
    data = body.model_dump(exclude_unset=True)
    member_ids = data.pop("member_ids", None)
    if "code" in data:
        ensure_unique(db, Team, "code", data["code"], exclude_id=item_id)
    _apply_update(obj, data)
    db.add(obj)
    _sync_team_members(db, item_id, member_ids)
    db.commit()
    db.refresh(obj)
    return ok(_team_out(db, obj))


@router.delete("/teams/{item_id}")
def delete_team(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:delete"))):
    obj = get_or_404(db, Team, item_id)
    # 解除班组成员归属，避免悬挂 team_id（认领/通知过滤依赖该字段）
    _sync_team_members(db, item_id, [])
    soft_delete(db, obj)
    return ok(True)


# ---- Location ----
@router.get("/locations")
def list_locations(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
):
    q = db.query(Location).filter(Location.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter((Location.name.like(like)) | (Location.code.like(like)))
    q = q.order_by(Location.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [LocationOut.model_validate(i).model_dump() for i in result["items"]]
    return ok(result)


@router.get("/locations/options")
def location_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(Location)
        .filter(Location.deleted == 0, Location.status == 1)
        .order_by(Location.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name, "code": r.code} for r in rows])


@router.post("/locations")
def create_location(body: LocationCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:create"))):
    ensure_unique(db, Location, "code", body.code)
    obj = Location(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(LocationOut.model_validate(obj).model_dump())


@router.put("/locations/{item_id}")
def update_location(item_id: int, body: LocationUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:update"))):
    obj = get_or_404(db, Location, item_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        ensure_unique(db, Location, "code", data["code"], exclude_id=item_id)
    _apply_update(obj, data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(LocationOut.model_validate(obj).model_dump())


@router.delete("/locations/{item_id}")
def delete_location(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:delete"))):
    obj = get_or_404(db, Location, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- Unit ----
def _unit_out(db: Session, u: Unit) -> dict:
    data = UnitOut.model_validate(u).model_dump()
    if u.location_id:
        loc = (
            db.query(Location)
            .filter(Location.id == u.location_id, Location.deleted == 0)
            .first()
        )
        data["location_name"] = loc.name if loc else None
    return data


@router.get("/units")
def list_units(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
):
    q = db.query(Unit).filter(Unit.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter((Unit.name.like(like)) | (Unit.code.like(like)))
    q = q.order_by(Unit.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_unit_out(db, i) for i in result["items"]]
    return ok(result)


@router.get("/units/options")
def unit_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(Unit)
        .filter(Unit.deleted == 0, Unit.status == 1)
        .order_by(Unit.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name, "code": r.code} for r in rows])


@router.post("/units")
def create_unit(body: UnitCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:create"))):
    ensure_unique(db, Unit, "code", body.code)
    obj = Unit(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_unit_out(db, obj))


@router.put("/units/{item_id}")
def update_unit(item_id: int, body: UnitUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:update"))):
    obj = get_or_404(db, Unit, item_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        ensure_unique(db, Unit, "code", data["code"], exclude_id=item_id)
    _apply_update(obj, data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_unit_out(db, obj))


@router.delete("/units/{item_id}")
def delete_unit(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("sys:dept:delete"))):
    obj = get_or_404(db, Unit, item_id)
    soft_delete(db, obj)
    return ok(True)
