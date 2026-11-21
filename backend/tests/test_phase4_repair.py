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
    username = f"opr_{suffix}"
    password = "operator123"
    r = client.post(
        "/api/v1/system/users",
        headers=h,
        json={
            "username": username,
            "password": password,
            "display_name": f"维修员{suffix}",
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


def _seed_eq(client: TestClient, h: dict, suffix: str) -> int:
    loc = client.post(
        "/api/v1/system/locations",
        headers=h,
        json={"name": "工单位置", "code": f"LOC-R-{suffix}"},
    )
    location_id = loc.json()["data"]["id"]
    type_id = client.get("/api/v1/equipment-types/options", headers=h).json()["data"][0][
        "id"
    ]
    eq = client.post(
        "/api/v1/equipment",
        headers=h,
        json={
            "name": "工单测试泵",
            "code": f"PUMP-R-{suffix}",
            "type_id": type_id,
            "location_id": location_id,
            "scada_point_ids": "700",
        },
    )
    assert eq.status_code == 200, eq.text
    return eq.json()["data"]["id"]


def test_manual_repair_full_flow():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        suffix = str(id(client))
        equipment_id = _seed_eq(client, h, suffix)

        op_h, op_id = _operator(client, h, suffix)
        create = client.post(
            "/api/v1/repairs",
            headers=h,
            json={
                "equipment_id": equipment_id,
                "description": "轴承异响，需现场检修",
                "repair_type": "overhaul",
                "fault_category": "机械故障",
            },
        )
        assert create.status_code == 200, create.text
        order = create.json()["data"]
        assert order["process_status"] == "pending_dispatch"
        assert order["order_no"].startswith("RP-")
        repair_id = order["id"]

        # 派单给操作员
        disp = client.post(
            f"/api/v1/repairs/{repair_id}/dispatch",
            headers=h,
            json={"worker_id": op_id, "comment": "请尽快处理"},
        )
        assert disp.status_code == 200, disp.text
        assert disp.json()["data"]["process_status"] == "processing"
        assert disp.json()["data"]["worker_id"] == op_id

        done = client.post(
            f"/api/v1/repairs/{repair_id}/complete",
            headers=op_h,
            json={"feedback": "已更换轴承，试运行正常"},
        )
        assert done.status_code == 200
        assert done.json()["data"]["process_status"] == "pending_accept"

        acc = client.post(
            f"/api/v1/repairs/{repair_id}/accept",
            headers=h,
            json={"pass_accept": True, "comment": "验收通过"},
        )
        assert acc.status_code == 200
        assert acc.json()["data"]["process_status"] == "archived"

        stats = client.get("/api/v1/repairs/stats", headers=h)
        assert stats.status_code == 200
        assert stats.json()["data"]["archived"] >= 1


def test_alarm_repair_dispatch_sync():
    """告警申请维修 → 工单派单/完成/验收 → 告警状态联动。"""
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        suffix = str(id(client)) + "AL"
        equipment_id = _seed_eq(client, h, suffix)

        client.post(
            "/api/v1/alarms/rules",
            headers=h,
            json={
                "name": f"工单联动-{suffix}",
                "equipment_id": equipment_id,
                "point_refs": "700",
                "alarm_type_code": "TEMP_ALERT",
                "alarm_level": 2,
                "compare_op": "gt",
                "threshold": "90",
                "delay_sec": 0,
                "enabled": 1,
            },
        )
        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "700", "value": 99},
        )
        alarms = client.get(
            "/api/v1/alarms",
            headers=h,
            params={"keyword": f"工单联动-{suffix}"},
        ).json()["data"]["items"]
        assert alarms
        alarm_id = alarms[0]["id"]

        op_h, op_id = _operator(client, h, suffix)
        handled = client.post(f"/api/v1/alarms/{alarm_id}/repair-handle", headers=h)
        assert handled.status_code == 200
        repair_id = handled.json()["data"]["repair_id"]
        assert repair_id

        client.post(
            f"/api/v1/repairs/{repair_id}/dispatch",
            headers=h,
            json={"worker_id": op_id},
        )
        client.post(
            f"/api/v1/repairs/{repair_id}/complete",
            headers=op_h,
            json={"feedback": "修复完成"},
        )
        # 告警应变为待验收
        detail = client.get(f"/api/v1/alarms/{alarm_id}", headers=h).json()["data"]
        assert detail["alarm_status"] == "pending_accept"

        client.post(
            f"/api/v1/repairs/{repair_id}/accept",
            headers=h,
            json={"pass_accept": True},
        )
        detail2 = client.get(f"/api/v1/alarms/{alarm_id}", headers=h).json()["data"]
        assert detail2["alarm_status"] == "closed"

        # 验收驳回路径
        suffix2 = suffix + "RJ"
        equipment_id2 = _seed_eq(client, h, suffix2)
        client.post(
            "/api/v1/alarms/rules",
            headers=h,
            json={
                "name": f"驳回联动-{suffix2}",
                "equipment_id": equipment_id2,
                "point_refs": "701",
                "alarm_type_code": "ELEC_ALERT",
                "alarm_level": 2,
                "compare_op": "gt",
                "threshold": "100",
                "delay_sec": 0,
                "enabled": 1,
            },
        )
        client.post(
            "/api/v1/scada/inject",
            headers=h,
            json={"tag_name": "701", "value": 150},
        )
        a2 = client.get(
            "/api/v1/alarms",
            headers=h,
            params={"keyword": f"驳回联动-{suffix2}"},
        ).json()["data"]["items"][0]
        handled2 = client.post(f"/api/v1/alarms/{a2['id']}/repair-handle", headers=h)
        assert handled2.status_code == 200
        rid2 = handled2.json()["data"]["repair_id"]
        client.post(
            f"/api/v1/repairs/{rid2}/dispatch",
            headers=h,
            json={"worker_id": op_id},
        )
        client.post(
            f"/api/v1/repairs/{rid2}/complete",
            headers=op_h,
            json={"feedback": "暂修"},
        )
        client.post(
            f"/api/v1/repairs/{rid2}/accept",
            headers=h,
            json={"pass_accept": False, "comment": "未修好"},
        )
        a2d = client.get(f"/api/v1/alarms/{a2['id']}", headers=h).json()["data"]
        assert a2d["alarm_status"] == "processing"
        r2d = client.get(f"/api/v1/repairs/{rid2}", headers=h).json()["data"]
        assert r2d["process_status"] == "processing"


def test_repair_operator_data_scope():
    """操作员在工单列表/统计中仅可见分配给自己的工单。"""
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()
        suffix = str(id(client)) + "SC"

        equipment_id = _seed_eq(client, h, suffix)
        create = client.post(
            "/api/v1/repairs",
            headers=h,
            json={
                "equipment_id": equipment_id,
                "description": "数据范围验证工单",
                "repair_type": "overhaul",
            },
        )
        assert create.status_code == 200, create.text
        rid = create.json()["data"]["id"]

        op_h, op_id = _operator(client, h, suffix)
        other_h, _other_id = _operator(client, h, suffix + "X")

        # 派给第一位操作员
        disp = client.post(
            f"/api/v1/repairs/{rid}/dispatch",
            headers=h,
            json={"worker_id": op_id},
        )
        assert disp.status_code == 200, disp.text

        # 被指派者可见
        mine = client.get("/api/v1/repairs", headers=op_h).json()["data"]
        assert any(x["id"] == rid for x in mine["items"])
        # 未被指派者不可见；统计亦不含该工单
        others = client.get("/api/v1/repairs", headers=other_h).json()["data"]
        assert not any(x["id"] == rid for x in others["items"])
        st = client.get("/api/v1/repairs/stats", headers=other_h).json()["data"]
        assert st["total"] == 0
        # 管理员可见全部
        admin_view = client.get("/api/v1/repairs", headers=h).json()["data"]
        assert any(x["id"] == rid for x in admin_view["items"])
