from fastapi.testclient import TestClient

from app.main import app
from app.scada.simulator import scada_runtime


def test_dashboard_overview():
    scada_runtime.stop()
    with TestClient(app) as client:
        # inject some flow history via login + inject
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert login.status_code == 200
        h = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
        scada_runtime.stop()

        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "PLC1.Flow", "value": 110},
        )
        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "PLC2.Flow", "value": 95},
        )

        r = client.get("/api/v1/dashboard/overview", headers=h, params={"days": 7})
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        assert "kpi" in body
        assert "today_water" in body["kpi"]
        assert "running_units" in body["kpi"]
        assert "alarm_units" in body["kpi"]
        assert "month_orders" in body["kpi"]
        assert "charts" in body
        assert "water_trend" in body["charts"]
        assert "energy" in body["charts"]
        assert "todos" in body
        assert "repairs" in body["todos"]
        assert "alarms" in body["todos"]
        assert "inspections" in body["todos"]
        assert "dispatches" in body["todos"]
