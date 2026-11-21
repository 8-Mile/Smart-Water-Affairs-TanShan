import time

from fastapi.testclient import TestClient

from app.main import app


def _login(client: TestClient) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


def test_scada_points_seeded_and_latest_updates():
    with TestClient(app) as client:
        h = _login(client)

        points = client.get("/api/v1/scada/points", headers=h, params={"page_size": 50})
        assert points.status_code == 200
        body = points.json()["data"]
        assert body["total"] >= 6

        # ensure simulator running
        start = client.post(
            "/api/v1/scada/runtime/start",
            headers=h,
            json={"mode": "mock", "interval_sec": 0.5},
        )
        assert start.status_code == 200
        assert start.json()["data"]["running"] is True

        # wait for at least one tick
        time.sleep(1.2)

        status = client.get("/api/v1/scada/runtime/status", headers=h)
        assert status.status_code == 200
        st = status.json()["data"]
        assert st["tick_count"] >= 1
        assert st["last_sample_count"] >= 1

        latest = client.get("/api/v1/scada/latest", headers=h)
        assert latest.status_code == 200
        items = latest.json()["data"]
        assert len(items) >= 1
        assert items[0]["tag_name"]

        # inject
        first_id = body["items"][0]["id"]
        inj = client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"point_id": first_id, "value": 99.5, "value_type": "number"},
        )
        assert inj.status_code == 200
        assert inj.json()["data"]["value_num"] == 99.5

        hist = client.get(
            "/api/v1/scada/history",
            headers=h,
            params={"point_id": first_id, "page_size": 10},
        )
        assert hist.status_code == 200
        assert hist.json()["data"]["total"] >= 1

        stop = client.post("/api/v1/scada/runtime/stop", headers=h)
        assert stop.status_code == 200
        assert stop.json()["data"]["running"] is False


def test_equipment_scada_values():
    with TestClient(app) as client:
        h = _login(client)
        suffix = str(id(client))

        loc = client.post(
            "/api/v1/system/locations",
            headers=h,
            json={"name": "SCADA测试位置", "code": f"LOC-S-{suffix}"},
        )
        location_id = loc.json()["data"]["id"]
        type_id = client.get("/api/v1/equipment-types/options", headers=h).json()[
            "data"
        ][0]["id"]

        eq = client.post(
            "/api/v1/equipment",
            headers=h,
            json={
                "name": "仿真水泵",
                "code": f"PUMP-S-{suffix}",
                "type_id": type_id,
                "location_id": location_id,
                "scada_point_ids": "700,701,PLC1.Flow",
            },
        )
        assert eq.status_code == 200, eq.text
        eq_id = eq.json()["data"]["id"]

        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "700", "value": 66.6},
        )
        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "PLC1.Flow", "value": 123.4},
        )

        vals = client.get(f"/api/v1/scada/equipment/{eq_id}/values", headers=h)
        assert vals.status_code == 200
        data = vals.json()["data"]
        assert len(data) == 3
        found_tags = {d["tag_name"] for d in data if d["found"]}
        assert "700" in found_tags
        assert "PLC1.Flow" in found_tags
