from datetime import datetime, timedelta

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


def test_dispatch_full_flow():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        me = client.get("/api/v1/auth/me", headers=h).json()["data"]
        finish = (datetime.now() + timedelta(hours=4)).isoformat(timespec="seconds")

        created = client.post(
            "/api/v1/dispatches",
            headers=h,
            json={
                "instruction_type": "internal",
                "content": "请开启1#泵，保持流量稳定",
                "executor_id": me["id"],
                "expected_finish_time": finish,
                "priority": "urgent",
            },
        )
        assert created.status_code == 200, created.text
        data = created.json()["data"]
        assert data["instruction_code"].startswith("DIS-")
        assert data["audit_status"] == "pending"
        item_id = data["id"]

        # 待审批不可执行
        bad = client.post(
            f"/api/v1/dispatches/{item_id}/complete",
            headers=h,
            json={"feedback": "done"},
        )
        assert bad.status_code == 400

        # 审核通过
        audit = client.post(
            f"/api/v1/dispatches/{item_id}/audit",
            headers=h,
            json={"passed": True, "comment": "同意执行"},
        )
        assert audit.status_code == 200
        assert audit.json()["data"]["audit_status"] == "approved"
        assert audit.json()["data"]["execute_status"] == "pending"

        # 执行完成
        done = client.post(
            f"/api/v1/dispatches/{item_id}/complete",
            headers=h,
            json={"feedback": "1#泵已开启"},
        )
        assert done.status_code == 200
        assert done.json()["data"]["execute_status"] == "done"

        stats = client.get("/api/v1/dispatches/stats", headers=h)
        assert stats.status_code == 200
        assert stats.json()["data"]["done"] >= 1
        assert stats.json()["data"]["today_count"] >= 1

        # 驳回路径
        c2 = client.post(
            "/api/v1/dispatches",
            headers=h,
            json={
                "instruction_type": "superior",
                "content": "临时停机指令",
                "executor_id": me["id"],
                "expected_finish_time": finish,
                "priority": "important",
            },
        )
        rid = c2.json()["data"]["id"]
        rej = client.post(
            f"/api/v1/dispatches/{rid}/audit",
            headers=h,
            json={"passed": False, "comment": "条件不满足"},
        )
        assert rej.status_code == 200
        assert rej.json()["data"]["audit_status"] == "rejected"
        assert rej.json()["data"]["execute_status"] == "none"

        # 工作台应能读到调度
        dash = client.get("/api/v1/dashboard/overview", headers=h)
        assert dash.status_code == 200
        assert "dispatches" in dash.json()["data"]["todos"]
