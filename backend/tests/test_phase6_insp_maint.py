from datetime import date, timedelta

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


def test_inspection_plan_dispatch_complete():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        suffix = str(id(client))

        team = client.post(
            "/api/v1/system/teams",
            headers=h,
            json={"name": "巡检一班", "code": f"T-INSP-{suffix}"},
        )
        assert team.status_code == 200, team.text
        team_id = team.json()["data"]["id"]

        today = date.today()
        plan = client.post(
            "/api/v1/inspections/plans",
            headers=h,
            json={
                "name": f"日常巡检-{suffix}",
                "team_id": team_id,
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=30)).isoformat(),
                "frequency": "day",
                "items": ["泵温", "液位", "振动"],
                "enabled": 1,
            },
        )
        assert plan.status_code == 200, plan.text
        plan_id = plan.json()["data"]["id"]
        assert plan.json()["data"]["items"] == ["泵温", "液位", "振动"]

        disp = client.post(
            f"/api/v1/inspections/plans/{plan_id}/dispatch",
            headers=h,
        )
        assert disp.status_code == 200, disp.text
        task_id = disp.json()["data"]["id"]
        assert disp.json()["data"]["task_status"] == "pending"

        done = client.post(
            f"/api/v1/inspections/tasks/{task_id}/complete",
            headers=h,
            json={
                "results": [
                    {"name": "泵温", "result": "normal", "remark": ""},
                    {"name": "液位", "result": "abnormal", "remark": "偏高"},
                    {"name": "振动", "result": "normal"},
                ],
                "remark": "已现场确认",
            },
        )
        assert done.status_code == 200, done.text
        assert done.json()["data"]["has_abnormal"] == 1

        tasks = client.get(
            "/api/v1/inspections/tasks",
            headers=h,
            params={"plan_id": plan_id},
        )
        assert tasks.json()["data"]["items"][0]["task_status"] == "done"

        records = client.get("/api/v1/inspections/records", headers=h)
        assert records.status_code == 200
        assert records.json()["data"]["total"] >= 1


def test_maintenance_plan_dispatch_and_ledger():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        suffix = str(id(client))

        loc = client.post(
            "/api/v1/system/locations",
            headers=h,
            json={"name": "维保位置", "code": f"LOC-M-{suffix}"},
        )
        location_id = loc.json()["data"]["id"]
        type_id = client.get("/api/v1/equipment-types/options", headers=h).json()[
            "data"
        ][0]["id"]
        eq = client.post(
            "/api/v1/equipment",
            headers=h,
            json={
                "name": "维保泵",
                "code": f"PUMP-M-{suffix}",
                "type_id": type_id,
                "location_id": location_id,
            },
        )
        equipment_id = eq.json()["data"]["id"]

        today = date.today()
        plan = client.post(
            "/api/v1/maintenance/plans",
            headers=h,
            json={
                "name": f"月度润滑-{suffix}",
                "plan_type": "lubrication",
                "start_date": today.isoformat(),
                "cycle_days": 30,
                "advance_days": 3,
                "equipment_ids": [equipment_id],
                "enabled": 1,
            },
        )
        assert plan.status_code == 200, plan.text
        plan_id = plan.json()["data"]["id"]

        disp = client.post(
            f"/api/v1/maintenance/plans/{plan_id}/dispatch",
            headers=h,
        )
        assert disp.status_code == 200, disp.text
        assert disp.json()["data"]["count"] >= 1
        record_id = disp.json()["data"]["items"][0]["id"]

        done = client.post(
            f"/api/v1/maintenance/records/{record_id}/complete",
            headers=h,
            json={"content": "已完成润滑", "remark": "OK"},
        )
        assert done.status_code == 200
        assert done.json()["data"]["record_status"] == "done"

        # 手工维保
        manual = client.post(
            "/api/v1/maintenance/records",
            headers=h,
            json={
                "equipment_id": equipment_id,
                "maintain_type": "overhaul",
                "content": "临时检修",
            },
        )
        assert manual.status_code == 200

        ledger = client.get("/api/v1/maintenance/ledger", headers=h)
        assert ledger.status_code == 200
        assert ledger.json()["data"]["total"] >= 2
