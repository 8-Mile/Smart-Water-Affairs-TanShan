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


def _operator(client: TestClient, h: dict, suffix: str) -> tuple[dict, int]:
    """创建操作员并登录，返回 (鉴权头, 用户id)；重名时直接登录复用。"""
    username = f"op_{suffix}"
    password = "operator123"
    r = client.post(
        "/api/v1/system/users",
        headers=h,
        json={
            "username": username,
            "password": password,
            "display_name": f"操作员{suffix}",
            "role_code": "operator",
        },
    )
    if r.status_code != 200:
        assert r.json()["message"] == "用户名已存在", r.text
    login = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert login.status_code == 200, login.text
    oh = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    user_id = client.get("/api/v1/auth/me", headers=oh).json()["data"]["id"]
    return oh, user_id


def test_alarm_engine_and_workflow():
    # 避免仿真自动刷库干扰本用例
    scada_runtime.stop()

    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        suffix = str(id(client))

        types = client.get("/api/v1/alarms/types/options", headers=h)
        assert types.status_code == 200
        assert len(types.json()["data"]) >= 6

        loc = client.post(
            "/api/v1/system/locations",
            headers=h,
            json={"name": "告警测试位置", "code": f"LOC-A-{suffix}"},
        )
        location_id = loc.json()["data"]["id"]
        type_id = client.get("/api/v1/equipment-types/options", headers=h).json()[
            "data"
        ][0]["id"]

        eq = client.post(
            "/api/v1/equipment",
            headers=h,
            json={
                "name": "告警测试泵",
                "code": f"PUMP-A-{suffix}",
                "type_id": type_id,
                "location_id": location_id,
                "scada_point_ids": "700",
            },
        )
        assert eq.status_code == 200, eq.text
        equipment_id = eq.json()["data"]["id"]

        rule = client.post(
            "/api/v1/alarms/rules",
            headers=h,
            json={
                "name": f"温度过高-{suffix}",
                "equipment_id": equipment_id,
                "point_refs": "700",
                "alarm_type_code": "TEMP_ALERT",
                "alarm_level": 2,
                "trigger_logic": "any",
                "compare_op": "gt",
                "threshold": "90",
                "delay_sec": 0,
                "debounce_sec": 60,
                "enabled": 1,
            },
        )
        assert rule.status_code == 200, rule.text

        # 注入越限值 → 触发引擎
        inj = client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "700", "value": 95.5},
        )
        assert inj.status_code == 200

        realtime = client.get(
            "/api/v1/alarms",
            headers=h,
            params={"realtime": True, "keyword": f"温度过高-{suffix}"},
        )
        assert realtime.status_code == 200
        items = realtime.json()["data"]["items"]
        assert len(items) >= 1
        alarm_id = items[0]["id"]
        assert items[0]["alarm_status"] == "pending"
        assert items[0]["alarm_level"] == 2

        # 去重：再次注入不新增
        before = realtime.json()["data"]["total"]
        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "700", "value": 96},
        )
        after = client.get(
            "/api/v1/alarms",
            headers=h,
            params={"realtime": True, "keyword": f"温度过高-{suffix}"},
        ).json()["data"]["total"]
        assert after == before

        # 维修处理：管理员一键生成维修工单（告警侧唯一处理入口）
        op_h, op_id = _operator(client, h, suffix)
        handled = client.post(
            f"/api/v1/alarms/{alarm_id}/repair-handle",
            headers=h,
        )
        assert handled.status_code == 200, handled.text
        data = handled.json()["data"]
        assert data["alarm_status"] == "processing"
        repair_id = data["repair_id"]
        order_no = data["repair_order_no"]
        assert repair_id and order_no

        # 重复维修处理被拒；操作员无权维修处理
        dup = client.post(f"/api/v1/alarms/{alarm_id}/repair-handle", headers=h)
        assert dup.status_code == 400
        forbidden = client.post(
            f"/api/v1/alarms/{alarm_id}/repair-handle", headers=op_h
        )
        assert forbidden.status_code == 403

        # 工单派单 → 维修人回写告警责任人；完工 → 告警待验收
        disp = client.post(
            f"/api/v1/repairs/{repair_id}/dispatch",
            headers=h,
            json={"worker_id": op_id},
        )
        assert disp.status_code == 200, disp.text
        dispatched = client.get(f"/api/v1/alarms/{alarm_id}", headers=h).json()["data"]
        assert dispatched["assignee_id"] == op_id
        done = client.post(
            f"/api/v1/repairs/{repair_id}/complete",
            headers=op_h,
            json={"feedback": "更换元件，试运行正常"},
        )
        assert done.status_code == 200, done.text
        waiting = client.get(f"/api/v1/alarms/{alarm_id}", headers=h).json()["data"]
        assert waiting["alarm_status"] == "pending_accept"

        # 工单侧验收通过 → 告警自动闭环并进入历史告警
        closed = client.post(
            f"/api/v1/repairs/{repair_id}/accept",
            headers=h,
            json={"pass_accept": True, "comment": "验收OK"},
        )
        assert closed.status_code == 200, closed.text
        final = client.get(f"/api/v1/alarms/{alarm_id}", headers=h).json()["data"]
        assert final["alarm_status"] == "closed"
        history = client.get(
            "/api/v1/alarms",
            headers=h,
            params={"keyword": f"温度过高-{suffix}"},
        ).json()["data"]["items"]
        assert any(x["id"] == alarm_id and x["alarm_status"] == "closed" for x in history)

        stats = client.get("/api/v1/alarms/stats", headers=h)
        assert stats.status_code == 200
        assert stats.json()["data"]["closed"] >= 1


def test_level1_auto_repair():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        suffix = str(id(client)) + "L1"

        loc = client.post(
            "/api/v1/system/locations",
            headers=h,
            json={"name": "L1位置", "code": f"LOC-L1-{suffix}"},
        )
        location_id = loc.json()["data"]["id"]
        type_id = client.get("/api/v1/equipment-types/options", headers=h).json()[
            "data"
        ][0]["id"]
        eq = client.post(
            "/api/v1/equipment",
            headers=h,
            json={
                "name": "一类告警泵",
                "code": f"PUMP-L1-{suffix}",
                "type_id": type_id,
                "location_id": location_id,
                "scada_point_ids": "701",
            },
        )
        equipment_id = eq.json()["data"]["id"]

        client.post(
            "/api/v1/alarms/rules",
            headers=h,
            json={
                "name": f"电流紧急-{suffix}",
                "equipment_id": equipment_id,
                "point_refs": "701",
                "alarm_type_code": "ELEC_ALERT",
                "alarm_level": 1,
                "compare_op": "gt",
                "threshold": "100",
                "delay_sec": 0,
                "enabled": 1,
            },
        )
        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "701", "value": 120},
        )
        items = client.get(
            "/api/v1/alarms",
            headers=h,
            params={"keyword": f"电流紧急-{suffix}"},
        ).json()["data"]["items"]
        assert len(items) >= 1
        assert items[0]["repair_id"] is not None
