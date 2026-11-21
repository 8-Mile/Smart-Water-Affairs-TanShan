from fastapi.testclient import TestClient

from app.main import app


def _login(client: TestClient) -> str:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert r.status_code == 200
    return r.json()["data"]["access_token"]


def test_seed_menus_and_types():
    with TestClient(app) as client:
        token = _login(client)
        h = {"Authorization": f"Bearer {token}"}

        menus = client.get("/api/v1/system/menus/my", headers=h)
        assert menus.status_code == 200
        assert menus.json()["code"] == 0
        assert len(menus.json()["data"]) >= 2

        types = client.get("/api/v1/equipment-types", headers=h)
        assert types.status_code == 200
        assert types.json()["data"]["total"] >= 7


def test_department_and_equipment_flow():
    with TestClient(app) as client:
        token = _login(client)
        h = {"Authorization": f"Bearer {token}"}
        suffix = str(id(client))

        # location
        loc = client.post(
            "/api/v1/system/locations",
            headers=h,
            json={"name": "测试泵房", "code": f"LOC-T-{suffix}", "status": 1},
        )
        assert loc.status_code == 200, loc.text
        location_id = loc.json()["data"]["id"]

        # type
        types = client.get("/api/v1/equipment-types/options", headers=h)
        type_id = types.json()["data"][0]["id"]
        pump_code = f"PUMP-T-{suffix}"

        # create equipment
        eq = client.post(
            "/api/v1/equipment",
            headers=h,
            json={
                "name": "一号水泵",
                "code": pump_code,
                "type_id": type_id,
                "location_id": location_id,
                "scada_point_ids": "700,701,702",
                "running_status": "running",
                "maintain_status": "normal",
                "continuous_run_hours": 50,
            },
        )
        assert eq.status_code == 200, eq.text
        eq_id = eq.json()["data"]["id"]
        assert eq.json()["data"]["scada_point_ids"] == "700,701,702"

        # duplicate code
        dup = client.post(
            "/api/v1/equipment",
            headers=h,
            json={
                "name": "重复水泵",
                "code": pump_code,
                "type_id": type_id,
                "location_id": location_id,
            },
        )
        assert dup.status_code == 400

        # stats
        stats = client.get("/api/v1/equipment/stats", headers=h)
        assert stats.status_code == 200
        body = stats.json()["data"]
        assert body["total"] >= 1
        assert body["running"] >= 1
        assert any("超时" in w for w in body["timeout_warnings"])

        # type delete blocked
        eq_type_id = type_id
        # create isolated type and device then try delete used type
        blocked = client.delete(
            f"/api/v1/equipment-types/{eq_type_id}", headers=h
        )
        assert blocked.status_code == 400

        # delete equipment then ok path for unused type
        client.delete(f"/api/v1/equipment/{eq_id}", headers=h)
