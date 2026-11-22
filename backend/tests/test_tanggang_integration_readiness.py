"""Six-system preparation matrix must never imply any real port SCADA connectivity."""
from test_tanggang_mapping_contract import env, example
from app.models.equipment import Equipment
from app.models.scada import ScadaPoint
from app.models.tanggang import TanggangObjectLink
from app.models.tanggang_provenance import TanggangPointReview


URL = "/api/v1/tanggang/integration-readiness"


def matrix(client):
    result = client.get(URL)
    assert result.status_code == 200, result.text
    return result.json()["data"]


def system(data, sid):
    return next(row for row in data["systems"] if row["id"] == sid)


def test_empty_or_unassigned_points_do_not_count_as_six_system_connected(env):
    client, ids, _, Session = env
    data = matrix(client)
    assert [x["id"] for x in data["systems"]] == [
        "fog", "middle", "mineral", "rain", "pool", "domestic",
    ]
    assert data["stage"] == "DOCUMENT_BASED_DEMO"
    assert data["measured_point_count"] == 0
    assert data["scada_commissioned"] is False
    assert data["inventory"]["registered_scada_points"] == 1
    assert data["inventory"]["unassigned_scada_points"] == 1
    assert all(x["point_links"] == 0 and x["field_verified"] is False
               and x["scada_commissioned"] is False for x in data["systems"])
    assert all("尚未登记工程对象" in x["issues"][0] for x in data["systems"])


def test_registered_link_is_software_mapping_not_live_connection(env):
    client, ids, _, Session = env
    created = client.post("/api/v1/tanggang/object-links", json=example(ids))
    assert created.status_code == 200, created.text
    data = matrix(client)
    mid = system(data, "middle")
    assert mid["object_links"] == 1
    assert mid["object_identity_reviewed"] == 1
    assert mid["object_source_refs"] == 1
    assert mid["linked_facility_ids"] == ["EQ-P-MID"]
    assert mid["asset_bound_facility_ids"] == ["EQ-P-MID"]
    assert mid["asset_links"] == 1
    assert mid["point_links"] == 1
    assert mid["point_candidates"] == 1
    assert mid["point_document_references"] == 0
    assert mid["point_without_review"] == 1
    assert "缺少资料核对" in "；".join(mid["issues"])
    assert mid["field_verified"] is False
    assert mid["status"] == "DOCUMENT_PREPARATION_ONLY"
    assert data["measured_point_count"] == 0
    assert system(data, "fog")["point_links"] == 0


def test_reviewed_document_only_counts_in_specified_system(env):
    client, ids, _, Session = env
    created = client.post("/api/v1/tanggang/object-links", json=example(ids))
    assert created.status_code == 200
    doc = client.put(f"/api/v1/tanggang/point-reviews/{ids['point']}", json={
        "system_id": "middle", "basis_type": "DOCUMENT_REFERENCE",
        "source_ref": "用户上传资料/图号-待核原件",
    })
    assert doc.status_code == 200
    data = matrix(client)
    mid = system(data, "middle")
    assert mid["point_document_references"] == 1
    assert mid["point_without_review"] == 0
    assert mid["point_without_object_link"] == 0
    assert mid["point_system_discrepancies"] == 0
    assert data["inventory"]["reviewed_scada_points"] == 1
    assert data["inventory"]["unassigned_scada_points"] == 0
    assert data["measured_point_count"] == 0
    assert system(data, "rain")["point_candidates"] == 0


def test_unlinked_review_and_system_discrepancy_do_not_fake_readiness(env):
    client, ids, _, Session = env
    doc = client.put(f"/api/v1/tanggang/point-reviews/{ids['point']}", json={
        "system_id": "rain", "basis_type": "ASSUMPTION",
        "assumption_note": "设计资料推导候选点，具体现场尚需核对",
    })
    assert doc.status_code == 200
    data = matrix(client)
    rain = system(data, "rain")
    assert rain["point_candidates"] == 1
    assert rain["point_links"] == 0
    assert rain["point_assumptions"] == 1
    assert rain["point_without_object_link"] == 1
    assert rain["point_document_references"] == 0
    created = client.post("/api/v1/tanggang/object-links", json=example(ids))
    assert created.status_code == 200
    data = matrix(client)
    mid = system(data, "middle")
    rain = system(data, "rain")
    assert mid["point_links"] == 1
    assert mid["point_system_discrepancies"] == 1
    assert mid["point_document_references"] == 0
    assert rain["point_candidates"] == 1
    assert rain["point_without_object_link"] == 1
    assert all(not x["field_verified"] for x in data["systems"])


def test_deleted_assets_and_points_flag_stale_references_without_writes(env):
    client, ids, _, Session = env
    created = client.post("/api/v1/tanggang/object-links", json=example(ids))
    assert created.status_code == 200, created.text
    with Session() as db:
        db.get(Equipment, ids["a"]).deleted = 1
        db.get(ScadaPoint, ids["point"]).deleted = 1
        db.commit()
    data = matrix(client)
    mid = system(data, "middle")
    assert mid["object_links"] == 1
    assert mid["asset_links"] == 0
    assert mid["asset_bound_facility_ids"] == []
    assert mid["linked_facility_ids"] == ["EQ-P-MID"]
    assert mid["point_links"] == 0
    assert mid["stale_asset_links"] == 1
    assert mid["stale_point_links"] == 1
    with Session() as db:
        assert db.query(TanggangObjectLink).count() == 1


def test_readonly_endpoint_does_not_require_scada_edit_permission(env):
    client, ids, mode, Session = env
    mode["value"] = "reader"
    data = matrix(client)
    assert data["measured_point_count"] == 0
    assert len(data["systems"]) == 6



def test_system_point_audit_includes_unreviewed_object_link_candidates(env):
    client, ids, _, Session = env
    link = client.post("/api/v1/tanggang/object-links", json=example(ids))
    assert link.status_code == 200, link.text
    audit = client.get("/api/v1/tanggang/point-audit", params={
        "system_id": "middle",
    })
    assert audit.status_code == 200, audit.text
    rows = audit.json()["data"]
    assert rows["total"] == 1
    assert rows["items"][0]["point_id"] == ids["point"]
    assert rows["items"][0]["system_id"] is None
    assert rows["items"][0]["basis_type"] == "UNVERIFIED"
    assert rows["items"][0]["linked_systems"] == ["middle"]
    assert rows["items"][0]["field_verified"] is False
    unverified = client.get("/api/v1/tanggang/point-audit", params={
        "system_id": "middle", "basis_type": "UNVERIFIED",
    })
    assert unverified.status_code == 200
    assert unverified.json()["data"]["total"] == 1
    assert client.get("/api/v1/tanggang/point-audit",params={
        "system_id": "rain",
    }).json()["data"]["total"] == 0
