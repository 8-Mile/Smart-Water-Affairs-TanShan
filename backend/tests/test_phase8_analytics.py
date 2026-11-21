from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.scada.simulator import scada_runtime


def _login(client: TestClient) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


def test_water_supply_plan_and_stats():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        today = date.today()

        plan = client.post(
            "/api/v1/water-supply/plans",
            headers=h,
            json={
                "plan_type": "day",
                "plan_date": today.isoformat(),
                "plan_value": 5000,
            },
        )
        assert plan.status_code == 200, plan.text
        assert plan.json()["data"]["plan_value"] == 5000

        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "PLC1.Flow", "value": 100},
        )
        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "PLC2.Flow", "value": 80},
        )

        stats = client.get(
            "/api/v1/water-supply/stats",
            headers=h,
            params={
                "start_date": (today - timedelta(days=2)).isoformat(),
                "end_date": today.isoformat(),
                "dimension": "time",
            },
        )
        assert stats.status_code == 200
        body = stats.json()["data"]
        assert "labels" in body
        assert "actual" in body
        assert body["summary"]["plan_total"] is not None

        cmp_ = client.get(
            "/api/v1/water-supply/compare",
            headers=h,
            params={"mode": "unit", "compare_date": today.isoformat()},
        )
        assert cmp_.status_code == 200
        assert "labels" in cmp_.json()["data"]


def test_energy_record_fee_and_ratio():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()

        # ensure unit
        units = client.get("/api/v1/system/units/options", headers=h)
        if not units.json()["data"]:
            loc = client.post(
                "/api/v1/system/locations",
                headers=h,
                json={"name": "能耗位置", "code": f"LOC-E-{id(client)}"},
            )
            client.post(
                "/api/v1/system/units",
                headers=h,
                json={
                    "name": "1#机组",
                    "code": f"U-E-{id(client)}",
                    "location_id": loc.json()["data"]["id"],
                },
            )
            units = client.get("/api/v1/system/units/options", headers=h)
        unit_id = units.json()["data"][0]["id"]

        now = datetime.now().replace(minute=0, second=0, microsecond=0)
        # 峰时段 9 点
        peak_time = now.replace(hour=9)
        rec = client.post(
            "/api/v1/energy/records",
            headers=h,
            json={
                "record_time": peak_time.isoformat(timespec="seconds"),
                "unit_id": unit_id,
                "electricity_kwh": 100,
                "remark": "峰时录入",
            },
        )
        assert rec.status_code == 200, rec.text

        # 谷时段 2 点
        valley_time = now.replace(hour=2)
        client.post(
            "/api/v1/energy/records",
            headers=h,
            json={
                "record_time": valley_time.isoformat(timespec="seconds"),
                "unit_id": unit_id,
                "electricity_kwh": 50,
            },
        )

        prices = client.get("/api/v1/energy/prices/active", headers=h)
        assert prices.status_code == 200
        assert prices.json()["data"] is not None

        fee = client.get(
            "/api/v1/energy/fee",
            headers=h,
            params={
                "start_date": date.today().isoformat(),
                "end_date": date.today().isoformat(),
            },
        )
        assert fee.status_code == 200
        f = fee.json()["data"]
        assert f["has_price"] is True
        assert f["total_kwh"] >= 150
        assert f["total_fee"] > 0

        stats = client.get(
            "/api/v1/energy/stats",
            headers=h,
            params={
                "start_date": (date.today() - timedelta(days=1)).isoformat(),
                "end_date": date.today().isoformat(),
                "dimension": "day",
            },
        )
        assert stats.status_code == 200
        assert "table" in stats.json()["data"]

        ratio = client.get(
            "/api/v1/energy/water-ratio",
            headers=h,
            params={"single_date": date.today().isoformat()},
        )
        assert ratio.status_code == 200
        assert "summary" in ratio.json()["data"]
