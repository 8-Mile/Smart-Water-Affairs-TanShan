"""阶段 3：gateway 模式下 runtime/inject 代理到 Gateway。"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.scada.simulator import scada_runtime


def _login(client: TestClient) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


def test_mock_mode_runtime_still_local():
    scada_runtime.stop()
    settings = get_settings()
    assert settings.scada_mode == "mock"

    with TestClient(app) as client:
        scada_runtime.stop()
        h = _login(client)
        st = client.get("/api/v1/scada/runtime/status", headers=h)
        assert st.status_code == 200
        data = st.json()["data"]
        assert data.get("source") == "local"


def test_gateway_mode_runtime_and_inject_proxied():
    scada_runtime.stop()

    with (
        patch("app.api.scada._use_gateway", return_value=True),
        patch(
            "app.api.scada.scada_gateway_client.runtime_status",
            return_value={
                "mode": "mock",
                "running": True,
                "tick_count": 12,
                "endpoint": "mock://local-simulator",
            },
        ),
        patch(
            "app.api.scada.scada_gateway_client.runtime_start",
            return_value={"mode": "mock", "running": True, "tick_count": 0},
        ) as m_start,
        patch(
            "app.api.scada.scada_gateway_client.runtime_stop",
            return_value={"mode": "mock", "running": False},
        ) as m_stop,
        patch(
            "app.api.scada.scada_gateway_client.inject",
            return_value={
                "point_id": 3,
                "tag_name": "700",
                "node_id": "ns=1;i=700",
                "value_type": "number",
                "value_num": 88.0,
                "value_bool": None,
                "value_str": None,
                "status_code": 0,
                "status_name": "Good",
                "ts_ms": 1_700_000_000_000,
            },
        ) as m_inj,
    ):
        with TestClient(app) as client:
            scada_runtime.stop()
            h = _login(client)

            st = client.get("/api/v1/scada/runtime/status", headers=h)
            assert st.status_code == 200
            assert st.json()["data"]["source"] == "gateway"
            assert st.json()["data"]["running"] is True

            start = client.post(
                "/api/v1/scada/runtime/start",
                headers=h,
                json={"mode": "mock", "interval_sec": 1.0},
            )
            assert start.status_code == 200
            m_start.assert_called_once()

            stop = client.post("/api/v1/scada/runtime/stop", headers=h)
            assert stop.status_code == 200
            m_stop.assert_called_once()

            inj = client.post(
                "/api/v1/scada/inject",
                headers=h,
                json={"tag_name": "700", "value": 88},
            )
            assert inj.status_code == 200, inj.text
            body = inj.json()["data"]
            assert body["source"] == "gateway"
            assert body["tag_name"] == "700"
            assert float(body["value_num"]) == 88.0
            # 必须用 tag_name 调 Gateway，不能传主站 point_id
            kwargs = m_inj.call_args.kwargs
            assert kwargs.get("tag_name") == "700"
            assert kwargs.get("point_id") is None
