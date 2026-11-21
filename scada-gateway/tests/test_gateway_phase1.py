"""阶段 1 验收：Mock 写库、latest、inject、鉴权。"""

import time

from fastapi.testclient import TestClient

from app.main import app

TOKEN = "dev-scada-gateway-token-change-me"
HEADERS = {"X-Gateway-Token": TOKEN}


def test_unauthorized_without_token():
    with TestClient(app) as client:
        r = client.get("/api/v1/health")
        assert r.status_code == 401


def test_health_points_latest_inject():
    with TestClient(app) as client:
        # 等至少一次 mock tick
        time.sleep(1.5)

        health = client.get("/api/v1/health", headers=HEADERS)
        assert health.status_code == 200
        body = health.json()
        assert body["code"] == 0
        assert body["data"]["status"] == "up"
        assert body["data"]["runtime"]["running"] is True
        assert body["data"]["runtime"]["mode"] == "mock"

        points = client.get("/api/v1/points", headers=HEADERS)
        assert points.status_code == 200
        plist = points.json()["data"]
        assert len(plist) >= 8
        tags = {p["tag_name"] for p in plist}
        assert "PLC1.Flow" in tags
        assert "700" in tags

        latest = client.get("/api/v1/latest", headers=HEADERS)
        assert latest.status_code == 200
        items = latest.json()["data"]
        assert len(items) >= 1
        assert items[0]["tag_name"]
        assert items[0]["ts_ms"] > 0

        # inject
        inj = client.post(
            "/api/v1/inject",
            headers=HEADERS,
            json={"tag_name": "700", "value": 95.5},
        )
        assert inj.status_code == 200, inj.text
        assert inj.json()["data"]["value_num"] == 95.5

        one = client.get(
            "/api/v1/latest",
            headers=HEADERS,
            params={"tag_name": "700"},
        )
        assert one.status_code == 200
        row = one.json()["data"][0]
        assert float(row["display_value"]) == 95.5

        hist = client.get(
            "/api/v1/history",
            headers=HEADERS,
            params={"tag_name": "700", "limit": 10},
        )
        assert hist.status_code == 200
        assert len(hist.json()["data"]) >= 1

        # runtime stop/start
        stop = client.post("/api/v1/runtime/stop", headers=HEADERS)
        assert stop.status_code == 200
        assert stop.json()["data"]["running"] is False

        start = client.post(
            "/api/v1/runtime/start",
            headers=HEADERS,
            json={"mode": "mock", "interval_sec": 1.0},
        )
        assert start.status_code == 200
        assert start.json()["data"]["running"] is True
