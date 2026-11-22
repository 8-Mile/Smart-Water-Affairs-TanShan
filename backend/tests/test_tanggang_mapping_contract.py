"""TG-001/002/004 tests: isolated in-memory DB, no live site writes."""
from datetime import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import get_current_user
from app.main import app
from app.models.equipment import Equipment
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.scada import ScadaPoint, ScadaPointLatest
from app.models.tanggang import (
    TanggangObjectLink, TanggangLinkAsset, TanggangLinkMetric, TanggangLinkRevision,
)
from app.models.archive import OperationLog
from app.models.user import User
from app.services.tanggang_quality import point_envelope


@pytest.fixture
def env(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread":False},
        poolclass=StaticPool,
    )
    # Only the tables used by this feature: older unrelated models contain
    # conflicting index definitions when independently creating the entire schema.
    Base.metadata.create_all(bind=engine,tables=[
        User.__table__,Role.__table__,Menu.__table__,UserRole.__table__,
        RoleMenu.__table__,Equipment.__table__,ScadaPoint.__table__,
        ScadaPointLatest.__table__,TanggangObjectLink.__table__,
        TanggangLinkAsset.__table__,TanggangLinkMetric.__table__,
        TanggangLinkRevision.__table__,OperationLog.__table__,
    ])
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as db:
        role = Role(name="设备编辑测试角色",code="tanggang_editor",status=1,deleted=0)
        viewer_role = Role(name="只读测试角色",code="tanggang_viewer",status=1,deleted=0)
        menu = Menu(name="编辑设备",perms="eq:update",menu_type="button",
                    parent_id=0,sort=1,visible=1,status=1,deleted=0)
        db.add_all([role,viewer_role,menu])
        db.flush()
        writer = User(username="tg_editor",password_hash="x",role_code=role.code,
                      display_name="编辑者",status=1,deleted=0)
        reader = User(username="tg_reader",password_hash="x",role_code=viewer_role.code,
                      display_name="查看者",status=1,deleted=0)
        db.add_all([writer,reader])
        db.flush()
        db.add_all([
            UserRole(user_id=writer.id,role_id=role.id),
            UserRole(user_id=reader.id,role_id=viewer_role.id),
            RoleMenu(role_id=role.id,menu_id=menu.id),
        ])
        a = Equipment(name="测试中压泵A",code=f"TG-{uuid.uuid4().hex[:8]}",
                      type_id=1,status=1,deleted=0)
        b = Equipment(name="测试中压泵B",code=f"TG-{uuid.uuid4().hex[:8]}",
                      type_id=1,status=1,deleted=0)
        db.add_all([a,b])
        db.flush()
        point = ScadaPoint(tag_name="TG.TEST.PRESSURE",node_id="tg-pump",
                           equipment_id=a.id,value_type="number",unit="MPa",
                           sim_base=0,sim_amplitude=0,sim_period_sec=60,
                           status=1,deleted=0)
        db.add(point)
        db.commit()
        user_ids = {"writer":writer.id,"reader":reader.id}
        ids={"a":a.id,"b":b.id,"point":point.id}
    user_mode={"value":"writer"}

    def isolated_db():
        with Session() as db:
            yield db

    def fake_user():
        with Session() as db:
            user = db.get(User,user_ids[user_mode["value"]])
            assert user is not None
            db.expunge(user)
            return user

    app.dependency_overrides[get_db] = isolated_db
    app.dependency_overrides[get_current_user] = fake_user
    # OperationLogMiddleware normally bypasses Depends and creates its own session.
    # Redirect its audit writes too, so tests cannot alter the working water_ops DB.
    monkeypatch.setattr("app.core.middleware.SessionLocal",Session)
    client = TestClient(app)
    try:
        yield client, ids, user_mode, Session
    finally:
        client.close()
        app.dependency_overrides.pop(get_db,None)
        app.dependency_overrides.pop(get_current_user,None)
        engine.dispose()


def example(ids, **kw):
    body={
        "object_id":"cad:AB12","facility_id":"EQ-P-MID","system_id":"middle",
        "cad_handle":"AB12","source_ref":"CAD 第四分册 / DWG-A12",
        "asset_ids":[ids["a"]],"metric_ids":[ids["point"]],"verified":True,
    }
    body.update(kw)
    return body


def test_six_system_contract(env):
    client,ids,_,_ = env
    response = client.get("/api/v1/tanggang/systems")
    assert response.status_code == 200,response.text
    data=response.json()["data"]
    assert [x["id"] for x in data]==["fog","middle","mineral","rain","pool","domestic"]
    assert data[-1]["name"]=="生活污水提升与外送"


def test_create_read_filter_revision_delete_reactivate(env):
    client,ids,_,_ = env
    body=example(ids)
    response=client.post("/api/v1/tanggang/object-links",json=body)
    assert response.status_code==200,response.text
    obj=response.json()["data"]
    assert obj["verified"] is True
    assert obj["asset_ids"]==[ids["a"]]
    assert obj["metric_ids"]==[ids["point"]]
    assert obj["data_mode"]=="REF"
    assert obj["hydraulic_topology_verified"] is False
    item_id=obj["id"]
    assert client.post("/api/v1/tanggang/object-links",json=body).status_code==409
    for filters in [
        {"system_id":"middle"},{"object_id":"cad:AB12"},{"facility_id":"EQ-P-MID"},
        {"asset_id":ids["a"]},{"metric_id":ids["point"]},
    ]:
        listing=client.get("/api/v1/tanggang/object-links",params=filters)
        assert listing.status_code==200,listing.text
        assert listing.json()["data"]["total"]==1
    other = example(ids,source_ref="更新CAD依据",asset_ids=[ids["a"],ids["b"]])
    updated=client.put(f"/api/v1/tanggang/object-links/{item_id}",json=other)
    assert updated.status_code==200,updated.text
    assert updated.json()["data"]["asset_ids"]==sorted([ids["a"],ids["b"]])
    repeat=client.put(f"/api/v1/tanggang/object-links/{item_id}",json=other)
    assert repeat.status_code==200,repeat.text
    history=client.get(f"/api/v1/tanggang/object-links/{item_id}/revisions")
    assert history.status_code==200
    assert [x["action"] for x in history.json()["data"]]==["update","update","create"]
    assert client.delete(f"/api/v1/tanggang/object-links/{item_id}").status_code==200
    assert client.get(f"/api/v1/tanggang/object-links/{item_id}").status_code==404
    assert client.get("/api/v1/tanggang/object-links").json()["data"]["total"]==0
    reactivate=client.post("/api/v1/tanggang/object-links",json=body)
    assert reactivate.status_code==200,reactivate.text
    assert reactivate.json()["data"]["id"]==item_id
    assert reactivate.json()["data"]["asset_ids"]==[ids["a"]]
    assert client.get(f"/api/v1/tanggang/object-links/{item_id}/revisions").json()["data"][0]["action"]=="reactivate"


def test_multi_system_same_asset_but_no_assumed_water_network(env):
    client,ids,_,_=env
    a=client.post("/api/v1/tanggang/object-links",json=example(ids))
    b=client.post("/api/v1/tanggang/object-links",json=example(
        ids,object_id="cad:AB13",facility_id="EQ-P-FOG",system_id="fog",
        metric_ids=[],verified=False,source_ref=None,
    ))
    assert a.status_code==200,a.text
    assert b.status_code==200,b.text
    links=client.get("/api/v1/tanggang/object-links",params={"asset_id":ids["a"]}).json()["data"]
    assert links["total"]==2
    assert all(x["hydraulic_topology_verified"] is False for x in links["items"])


def test_invalid_evidence_and_references_do_not_write(env):
    client,ids,_,Session=env
    for payload in [
        example(ids,system_id="fake"),
        example(ids,verified=True,source_ref=""),
        example(ids,asset_ids=[9999999]),
        example(ids,metric_ids=[9999999]),
        example(ids,asset_ids=[ids["b"]]),
        example(ids,asset_ids=[ids["a"],ids["a"]]),
        example(ids,object_id=" cad:AB12"),
    ]:
        res=client.post("/api/v1/tanggang/object-links",json=payload)
        assert res.status_code in (400,422),res.text
    with Session() as db:
        assert db.query(TanggangObjectLink).count()==0


def test_denied_edit_still_allows_authenticated_read(env):
    client,ids,mode,Session=env
    mode["value"]="reader"
    assert client.get("/api/v1/tanggang/systems").status_code==200
    assert client.get("/api/v1/tanggang/object-links").status_code==200
    res=client.post("/api/v1/tanggang/object-links",json=example(ids))
    assert res.status_code==403,res.text
    with Session() as db:
        assert db.query(TanggangObjectLink).count()==0


def test_missing_vs_zero_vs_stale_and_sim_mode():
    point=ScadaPoint(id=5,tag_name="T.P",node_id="pump",equipment_id=9,unit="MPa")
    missing=point_envelope(point,None,runtime_mode="mock",now_ms=1_000_000)
    assert missing["quality"]=="MISSING" and missing["value"] is None
    assert missing["data_mode"]=="SIM"
    zero=ScadaPointLatest(point_id=5,ts_ms=900_000,value_num=0,value_type="number",
                          status_code=0,status_name="Good")
    actual=point_envelope(point,zero,runtime_mode="mock",now_ms=1_000_000)
    assert actual["value"]==0 and actual["quality"]=="GOOD"
    assert actual["data_mode"]=="SIM"
    stale=point_envelope(point,zero,runtime_mode="gateway",now_ms=1_900_000)
    assert stale["quality"]=="STALE" and stale["data_mode"]=="UNKNOWN"
    zero.status_name="Offline"
    assert point_envelope(point,zero,runtime_mode="opcua",now_ms=950_000)["quality"]=="OFFLINE"
    zero.status_name="Good"
    zero.status_code=500
    assert point_envelope(point,zero,runtime_mode="opcua",now_ms=950_000)["quality"]=="BAD"


def test_measured_source_never_inferred_from_gateway_mode(env,monkeypatch):
    client,ids,_,Session=env
    result=client.post("/api/v1/tanggang/object-links",json=example(ids))
    assert result.status_code==200,result.text
    with Session() as db:
        db.add(ScadaPointLatest(point_id=ids["point"],tag_name="TG.TEST.PRESSURE",
            node_id="tg-pump",value_type="number",value_num=1.25,
            status_code=0,status_name="Good",
            ts_ms=int(datetime.now().timestamp()*1000)))
        db.commit()
    res=client.get("/api/v1/tanggang/object-links",params={"include_latest":"true"})
    assert res.status_code==200,res.text
    envv=res.json()["data"]["items"][0]["measurements"][0]
    assert envv["metric_id"]==ids["point"]
    assert envv["data_mode"] in ("SIM","UNKNOWN")
    assert envv["data_mode"]!="MEASURED"
    assert envv["quality"]=="GOOD"


def test_corrupted_scada_timestamp_cannot_be_shown_as_valid_data():
    point=ScadaPoint(id=9,tag_name="BAD",node_id="bad",value_type="number")
    latest=ScadaPointLatest(point_id=9,ts_ms=999_999_999_999_999,
                           value_num=12,value_type="number",
                           status_code=0,status_name="Good")
    r=point_envelope(point,latest,runtime_mode="mock",now_ms=1_000_000)
    assert r["quality"]=="BAD"
    assert r["observed_at"] is None
