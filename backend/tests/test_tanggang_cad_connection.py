"""M19: controlled candidate mapping never certifies hydraulic connectivity."""
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import get_current_user
from app.main import app
from app.models.user import User
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.tanggang_process_diagram import TanggangProcessDiagram
from app.models.tanggang_cad_connection import (
    TanggangCadConnectionCandidate, TanggangCadConnectionCandidateRevision,
)
from app.api.tanggang_cad_connection import INDEX, HANDLES

BASE = "/api/v1/tanggang/cad-connection-candidates"


@pytest.fixture
def env(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=[
        User.__table__, Role.__table__, Menu.__table__, RoleMenu.__table__,
        UserRole.__table__, TanggangProcessDiagram.__table__,
        TanggangCadConnectionCandidate.__table__,
        TanggangCadConnectionCandidateRevision.__table__,
    ])
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as db:
        role_ids = {}
        for name in ("reader", "editor", "manager"):
            role = Role(name=name, code="cad_" + name, status=1, deleted=0)
            db.add(role)
            db.flush()
            role_ids[name] = role.id
        for i, (role, permission) in enumerate([
            ("editor", "eq:update"), ("manager", "sys:menu:manage"),
        ]):
            menu = Menu(name=permission, perms=permission,
                        menu_type="button", parent_id=0,
                        sort=i + 1, visible=1, status=1, deleted=0)
            db.add(menu)
            db.flush()
            db.add(RoleMenu(role_id=role_ids[role], menu_id=menu.id))
        user_ids = {}
        for name, role_id in role_ids.items():
            user = User(
                username="cad_" + name,
                password_hash=uuid.uuid4().hex,
                display_name=name,
                role_code="cad_" + name,
                status=1, deleted=0,
            )
            db.add(user)
            db.flush()
            user_ids[name] = user.id
            db.add(UserRole(user_id=user.id, role_id=role_id))
        db.commit()
    current = {"name": "reader"}

    def session():
        with Session() as db:
            yield db

    def auth():
        with Session() as db:
            user = db.get(User, user_ids[current["name"]])
            db.expunge(user)
            return user

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_user] = auth
    monkeypatch.setattr("app.core.middleware.SessionLocal", Session)
    client = TestClient(app)
    try:
        yield client, current, Session
    finally:
        client.close()
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
        engine.dispose()


def proposal(system="middle", connection="design-01"):
    scope = INDEX["systems"][system]
    link = next(x for x in scope["connections"] if x["connection_id"] == connection)
    layer = link["candidate_layer"]
    if not layer:
        raise AssertionError("Test refers to unscoped link")
    return {
        "revision": 0, "layer": layer,
        "source_handles": [sorted(HANDLES[layer])[0]],
        "review_note": "设计图层同专业候选，仅登记待核源Handle；尚未核验管道两端接口。",
        "status": "candidate",
    }


def test_pinned_index_uses_only_consistent_medium_compatible_evidence():
    assert set(INDEX["systems"]) == {"middle", "mineral", "rain", "pool", "domestic"}
    assert sum(len(s["connections"]) for s in INDEX["systems"].values()) == 44
    assert sum(s["candidate_scope_count"] for s in INDEX["systems"].values()) == 23
    for system in INDEX["systems"].values():
        for link in system["connections"]:
            layer = link["candidate_layer"]
            if layer:
                assert layer in system["focus_layers"]
                assert layer in HANDLES
                assert link["medium"] in {"water", "sludge"}
            assert "verified" not in link


def test_candidate_is_persisted_revisioned_and_never_verified(env):
    client, current, Session = env
    initial = client.get(BASE + "/middle")
    assert initial.status_code == 200
    payload = initial.json()["data"]
    assert payload["total"] == 7
    assert payload["candidate_eligible"] == 6
    assert payload["candidate_recorded"] == 0
    assert payload["can_verify_physical_connection"] is False
    assert payload["can_edit"] is False
    body = proposal()
    assert client.put(BASE + "/middle/design-01", json=body).status_code == 403

    current["name"] = "editor"
    saved = client.put(BASE + "/middle/design-01", json=body)
    assert saved.status_code == 200, saved.text
    data = saved.json()["data"]
    assert data["revision"] == 1
    assert data["status"] == "candidate"
    assert data["physical_connection_verified"] is False
    assert data["source_handles"] == body["source_handles"]
    assert client.put(BASE + "/middle/design-01", json=body).status_code == 409

    other = client.get(BASE + "/rain").json()["data"]
    assert other["candidate_recorded"] == 0
    current["name"] = "reader"
    listing = client.get(BASE + "/middle").json()["data"]
    assert listing["candidate_recorded"] == 1
    assert listing["items"][0]["candidate"]["physical_connection_verified"] is False
    history = client.get(BASE + "/middle/design-01/history")
    assert history.status_code == 200
    assert [h["revision"] for h in history.json()["data"]] == [1]
    current["name"] = "manager"
    rejected = client.put(BASE + "/middle/design-01", json={
        **body, "revision": 1, "status": "rejected",
        "review_note": "复核后不采纳当前来源Handle；仍需设计图纸及端点证据。",
    })
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["data"]["status"] == "rejected"
    assert rejected.json()["data"]["physical_connection_verified"] is False
    assert [x["revision"] for x in client.get(
        BASE + "/middle/design-01/history").json()["data"]] == [2, 1]
    with Session() as db:
        assert db.query(TanggangCadConnectionCandidate).count() == 1
        assert db.query(TanggangCadConnectionCandidateRevision).count() == 2
        assert db.query(TanggangProcessDiagram).count() == 0


def test_rejects_cross_layer_fake_handles_unscoped_links_and_verify_flag(env):
    client, current, Session = env
    current["name"] = "manager"
    base = proposal()
    wrong_layer = INDEX["systems"]["pool"]["focus_layers"][0]
    invalid = [
        {**base, "layer": wrong_layer},
        {**base, "source_handles": ["DEADBEEF"]},
        {**base, "source_handles": base["source_handles"] * 2},
        {**base, "source_handles": ["<script>"]},
        {**base, "review_note": "short"},
        {**base, "status": "verified"},
        {**base, "physical_connection_verified": True},
    ]
    for item in invalid:
        response = client.put(BASE + "/middle/design-01", json=item)
        assert response.status_code in {400, 422}, (item, response.status_code, response.text)
    assert client.put(BASE + "/middle/design-07", json=base).status_code == 400
    assert client.put(BASE + "/pool/design-03", json=proposal("pool", "design-01")).status_code == 400
    assert client.put(BASE + "/fog/design-01", json=base).status_code == 404
    assert client.put(BASE + "/middle/design-99", json=base).status_code == 404
    assert client.put(BASE + "/middle/design-01", json={
        **base, "status": "rejected",
    }).status_code == 400
    with Session() as db:
        assert db.query(TanggangCadConnectionCandidate).count() == 0


def test_published_diagram_changes_invalidates_mapping_before_write(env):
    client, current, Session = env
    current["name"] = "manager"
    with Session() as db:
        db.add(TanggangProcessDiagram(
            system_id="middle", published_version=1,
            draft_revision=2, updated_by=1,
            published_json=json.dumps({
                "system_id": "middle",
                "connections": [{
                    "id": "design-01",
                    "source_node_id": "changed-source",
                    "target_node_id": "cad-EQ-P-MID",
                    "medium": "water",
                }],
            }),
        ))
        db.commit()
    scoped = client.get(BASE + "/middle").json()["data"]
    assert scoped["items"][0]["diagram_compatible"] is False
    assert client.put(BASE + "/middle/design-01", json=proposal()).status_code == 409
    with Session() as db:
        assert db.query(TanggangCadConnectionCandidate).count() == 0
