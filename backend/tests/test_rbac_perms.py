"""按钮权限与菜单可见性全链路回归测试。

覆盖用户报告的两个缺陷：
1. 管理员取消角色按钮权限后，用户重新登录立即生效（seed 重跑不回灌）
2. 菜单「是否显示」关闭后，/system/menus/my 不再返回该菜单（含子树）

另覆盖 RBAC 写接口的按钮码校验（require_perm）。
"""

import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.deps import collect_user_perms, require_perm
from app.core.security import hash_password
from app.main import app
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.user import User
from app.services.bootstrap import _seed_roles, _upsert_operator_button_perms


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


ADMIN = {"username": "admin", "password": "admin123"}


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(c: TestClient, username: str, password: str) -> tuple[str, dict]:
    r = c.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    return body["access_token"], body["user"]


def _admin_headers(c: TestClient) -> dict:
    token, _ = _login(c, ADMIN["username"], ADMIN["password"])
    return _h(token)


def _mk_role(db) -> Role:
    code = f"t_role_{uuid.uuid4().hex[:8]}"
    role = Role(name=code, code=code, remark="rbac-test", status=1, deleted=0)
    db.add(role)
    db.commit()
    return role


def _mk_user(db, role: Role | None = None) -> User:
    username = f"t_user_{uuid.uuid4().hex[:8]}"
    user = User(
        username=username,
        password_hash=hash_password("test123456"),
        display_name=username,
        role_code=role.code if role else "operator",
        status=1,
        deleted=0,
    )
    db.add(user)
    db.commit()
    if role:
        db.add(UserRole(user_id=user.id, role_id=role.id))
        db.commit()
    return user


def _cleanup(db, role: Role | None = None, user: User | None = None, menu_ids=()) -> None:
    if user is not None:
        db.query(UserRole).filter(UserRole.user_id == user.id).delete()
        db.query(User).filter(User.id == user.id).delete()
    if role is not None:
        db.query(RoleMenu).filter(RoleMenu.role_id == role.id).delete()
        db.query(Role).filter(Role.id == role.id).delete()
    for mid in menu_ids:
        db.query(RoleMenu).filter(RoleMenu.menu_id == mid).delete()
        db.query(Menu).filter(Menu.id == mid).delete()
    db.commit()


def _menu_ids_of(tree: list[dict]) -> set[int]:
    out: set[int] = set()

    def walk(nodes: list[dict]) -> None:
        for n in nodes:
            out.add(n["id"])
            if n.get("children"):
                walk(n["children"])

    walk(tree)
    return out


def test_super_admin_wildcard_perms(client):
    """super_admin 登录下发 ['*'] 通配，前端 hasPerm 直通。"""
    _, user = _login(client, ADMIN["username"], ADMIN["password"])
    assert user["perms"] == ["*"]


def test_button_perm_grant_revoke_roundtrip(client):
    """授权→登录有码；取消→重新登录立即无码（按钮显隐跟随配置）。"""
    db = SessionLocal()
    role = _mk_role(db)
    user = _mk_user(db, role=role)
    try:
        page = db.query(Menu).filter(Menu.perms == "archive:list", Menu.deleted == 0).first()
        upload_btn = db.query(Menu).filter(Menu.perms == "archive:upload", Menu.deleted == 0).first()
        assert page and upload_btn
        h = _admin_headers(client)

        # 1) 授权页面 + 上传按钮 → 登录 perms 含 archive:upload
        r = client.put(
            f"/api/v1/system/roles/{role.id}",
            headers=h,
            json={"menu_ids": [page.id, upload_btn.id]},
        )
        assert r.status_code == 200, r.text
        _, u1 = _login(client, user.username, "test123456")
        assert "archive:upload" in u1["perms"]

        # 2) 取消上传按钮（仅保留页面菜单）→ 重新登录立即无码
        r = client.put(
            f"/api/v1/system/roles/{role.id}",
            headers=h,
            json={"menu_ids": [page.id]},
        )
        assert r.status_code == 200, r.text
        _, u2 = _login(client, user.username, "test123456")
        assert "archive:upload" not in u2["perms"]
    finally:
        _cleanup(db, role=role, user=user)
        db.close()


def test_seed_does_not_resurrect_removed_button(client):
    """手动取消 leader 的按钮后，重跑 seed（等价服务重启）不回灌。"""
    db = SessionLocal()
    try:
        roles = _seed_roles(db)
        leader = roles["admin"]
        btn = db.query(Menu).filter(Menu.perms == "archive:upload", Menu.deleted == 0).first()
        assert btn
        # 模拟管理员取消该按钮
        db.query(RoleMenu).filter(
            RoleMenu.role_id == leader.id, RoleMenu.menu_id == btn.id
        ).delete()
        db.commit()
        before = (
            db.query(RoleMenu)
            .filter(RoleMenu.role_id == leader.id, RoleMenu.menu_id == btn.id)
            .count()
        )
        assert before == 0
        # 重跑按钮灌入（lifespan 每次启动都会调用）
        _upsert_operator_button_perms(db, roles)
        after = (
            db.query(RoleMenu)
            .filter(RoleMenu.role_id == leader.id, RoleMenu.menu_id == btn.id)
            .count()
        )
        assert after == 0, "seed 不应回灌管理员手动取消的按钮权限"
    finally:
        db.close()


def test_my_menus_respects_visible(client):
    """菜单 visible=0 后 /system/menus/my 不再返回；隐藏目录连带隐藏子树。"""
    db = SessionLocal()
    role = _mk_role(db)
    user = _mk_user(db, role=role)
    created: list[int] = []
    try:
        h = _admin_headers(client)
        suffix = uuid.uuid4().hex[:8]

        # 建临时目录 + 子菜单（均可见）
        r = client.post(
            "/api/v1/system/menus",
            headers=h,
            json={"name": f"测试目录{suffix}", "menu_type": "dir", "visible": 1, "sort": 999},
        )
        assert r.status_code == 200, r.text
        dir_id = r.json()["data"]["id"]
        created.append(dir_id)
        r = client.post(
            "/api/v1/system/menus",
            headers=h,
            json={
                "name": f"测试菜单{suffix}",
                "path": f"/t-{suffix}",
                "menu_type": "menu",
                "parent_id": dir_id,
                "visible": 1,
                "sort": 1,
            },
        )
        assert r.status_code == 200, r.text
        menu_id = r.json()["data"]["id"]
        created.append(menu_id)

        # 授权给临时角色，登录后可见
        r = client.put(
            f"/api/v1/system/roles/{role.id}", headers=h, json={"menu_ids": [dir_id, menu_id]}
        )
        assert r.status_code == 200, r.text
        ut, _ = _login(client, user.username, "test123456")
        tree = client.get("/api/v1/system/menus/my", headers=_h(ut)).json()["data"]
        assert {menu_id, dir_id} <= _menu_ids_of(tree)

        # 关闭子菜单「是否显示」→ 立即不可见（无需重启/清缓存）
        r = client.put(f"/api/v1/system/menus/{menu_id}", headers=h, json={"visible": 0})
        assert r.status_code == 200, r.text
        ut, _ = _login(client, user.username, "test123456")
        tree = client.get("/api/v1/system/menus/my", headers=_h(ut)).json()["data"]
        assert menu_id not in _menu_ids_of(tree)
        assert dir_id in _menu_ids_of(tree)

        # 关闭目录「是否显示」→ 整棵子树不可见
        r = client.put(f"/api/v1/system/menus/{dir_id}", headers=h, json={"visible": 0})
        assert r.status_code == 200, r.text
        r = client.put(f"/api/v1/system/menus/{menu_id}", headers=h, json={"visible": 1})
        assert r.status_code == 200, r.text
        ut, _ = _login(client, user.username, "test123456")
        tree = client.get("/api/v1/system/menus/my", headers=_h(ut)).json()["data"]
        assert _menu_ids_of(tree).isdisjoint({dir_id, menu_id})

        # 恢复显示 → 重新可见
        r = client.put(f"/api/v1/system/menus/{dir_id}", headers=h, json={"visible": 1})
        assert r.status_code == 200, r.text
        ut, _ = _login(client, user.username, "test123456")
        tree = client.get("/api/v1/system/menus/my", headers=_h(ut)).json()["data"]
        assert {menu_id, dir_id} <= _menu_ids_of(tree)
    finally:
        _cleanup(db, role=role, user=user, menu_ids=created)
        db.close()


def test_require_perm_factory(client):
    """require_perm：无码 403，超管通配放行；collect 口径与前端 hasPerm 一致。"""
    db = SessionLocal()
    role = _mk_role(db)
    user = _mk_user(db, role=role)
    try:
        assert collect_user_perms(db, user) == set()
        with pytest.raises(HTTPException) as ei:
            require_perm("archive:upload")(db, user)
        assert ei.value.status_code == 403

        sa = db.query(User).filter(User.username == ADMIN["username"], User.deleted == 0).first()
        assert sa is not None
        assert collect_user_perms(db, sa) == {"*"}
        assert require_perm("any:code")(db, sa) is sa
    finally:
        _cleanup(db, role=role, user=user)
        db.close()


def test_rbac_write_endpoints_require_perm(client):
    """无 sys:role:assign 码的用户不能改角色授权（接口级校验）。"""
    db = SessionLocal()
    role = _mk_role(db)
    user = _mk_user(db, role=role)
    try:
        ut, _ = _login(client, user.username, "test123456")
        h = _h(ut)
        # 无 sys:role:assign → 改角色被拒
        r = client.put(f"/api/v1/system/roles/{role.id}", headers=h, json={"menu_ids": []})
        assert r.status_code == 403, r.text
        # 无 sys:menu:manage → 改菜单被拒
        r = client.put("/api/v1/system/menus/1", headers=h, json={"visible": 0})
        assert r.status_code == 403, r.text
        # 无 sys:user:update → 改用户被拒
        r = client.put(f"/api/v1/system/users/{user.id}", headers=h, json={"phone": "1"})
        assert r.status_code == 403, r.text
    finally:
        _cleanup(db, role=role, user=user)
        db.close()
