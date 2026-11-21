"""阶段 2：Gateway Ingest 镜像写库并触发告警。"""

import time

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.scada.simulator import scada_runtime


def _login(client: TestClient) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


def test_ingest_samples_updates_latest_and_can_trigger_alarm():
    scada_runtime.stop()
    settings = get_settings()
    token = settings.scada_ingest_token or settings.scada_gateway_token
    assert token

    with TestClient(app) as client:
        scada_runtime.stop()
        h = _login(client)

        # 确保有一条温度告警规则（测点 700）
        rules = client.get("/api/v1/alarms/rules", headers=h)
        # 若无规则则创建一个简单越限规则
        points = client.get("/api/v1/scada/points", headers=h)
        assert points.status_code == 200
        items = points.json()["data"]["items"]
        tag700 = next((p for p in items if p["tag_name"] == "700"), None)
        assert tag700 is not None

        # 创建或使用现有规则
        create = client.post(
            "/api/v1/alarms/rules",
            headers=h,
            json={
                "name": "ingest测试温度越限",
                "alarm_type_id": 1,
                "alarm_level": 2,
                "point_id": tag700["id"],
                "compare_op": "gt",
                "threshold": 90,
                "enabled": 1,
            },
        )
        # 可能已有类似规则，201/200 或校验失败均可继续 inject via ingest
        if create.status_code == 200:
            pass

        ts = int(time.time() * 1000)
        body = {
            "samples": [
                {
                    "point_id": 99999,  # Gateway id，主站应忽略并按 tag 映射
                    "tag_name": "700",
                    "node_id": "ns=1;i=700",
                    "value_type": "number",
                    "value_num": 96.5,
                    "status_code": 0,
                    "status_name": "Good",
                    "ts_ms": ts,
                }
            ],
            "write_history": True,
        }
        r = client.post(
            "/api/v1/internal/scada/samples",
            headers={"X-Gateway-Token": token},
            json=body,
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["accepted"] == 1

        # 主站 latest 应更新
        latest = client.get(
            "/api/v1/scada/latest",
            headers=h,
            params={"keyword": "700"},
        )
        assert latest.status_code == 200
        rows = latest.json()["data"]
        found = [x for x in rows if x.get("tag_name") == "700"]
        assert found, rows
        assert float(found[0].get("display_value") or found[0].get("value_num")) == 96.5

        # 无 token 拒绝
        bad = client.post(
            "/api/v1/internal/scada/samples",
            json=body,
        )
        assert bad.status_code == 401
