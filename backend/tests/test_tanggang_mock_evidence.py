"""M7: evidence notes are append-only and SIM run linkage is collision safe."""
from test_tanggang_a2ui_boards import env
from test_tanggang_mock_ai import mock_env, ask
from test_tanggang_mock_decisions import API, create, scenario, OPTIONS
from app.models.tanggang_mock_ai import (
    TanggangMockAiEvidenceNote, TanggangMockAiDecision, TanggangMockAiReport,
)
from app.models.equipment import Equipment
from app.models.ai_audit import AiAuditLog

U1 = "11111111-1111-4111-8111-111111111111"
U2 = "22222222-2222-4222-8222-222222222222"
U3 = "33333333-3333-4333-8333-333333333333"


def test_checkpoints_are_grounded_in_sim_snapshot_and_no_verified_claim(mock_env):
    client, current, Session = mock_env
    selected = create(client, plan="defer", run_uid=U1)
    assert selected.status_code == 200, selected.text
    decision_id = selected.json()["data"]["id"]
    resp = client.get(f"{API}/{decision_id}/evidence")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["data_mode"] == "SIM"
    assert data["field_verified"] is False
    assert data["verified"] == 0
    assert data["pending"] == data["total"]
    assert data["total"] >= 5
    assert all(x["field_verified"] is False and x["note_count"] == 0 for x in data["items"])
    labels = [x["label"] for x in data["items"]]
    assert "核对泵组铭牌、设备性能曲线与可用备用能力" in labels
    assert "核对SCADA测点" in labels
    assert "演示顺延不代表节水" in labels


def test_append_only_note_history_and_source_reference_is_unverified(mock_env):
    client, current, Session = mock_env
    selected = create(client, run_uid=U1).json()["data"]
    target = client.get(f"{API}/{selected['id']}/evidence").json()["data"]["items"][0]
    params = {
        "item_key": target["key"], "status": "material-requested",
        "note": "请求核对港区实际需水和作业班次，尚无现场资料",
        "source_reference": "用户上传文件待查页码",
    }
    first = client.post(f"{API}/{selected['id']}/evidence", json=params)
    assert first.status_code == 200, first.text
    item = next(i for i in first.json()["data"]["items"] if i["key"] == target["key"])
    assert item["status"] == "material-requested"
    assert item["note_count"] == 1
    assert item["field_verified"] is False
    second = client.post(f"{API}/{selected['id']}/evidence", json={
        **params, "status": "under-review",
        "note": "已将资料名称列为线索，正在核对文件内容，不代表实际验证",
    })
    assert second.status_code == 200, second.text
    data = second.json()["data"]
    item = next(i for i in data["items"] if i["key"] == target["key"])
    assert item["status"] == "under-review" and item["note_count"] == 2
    assert data["verified"] == 0
    with Session() as db:
        rows = db.query(TanggangMockAiEvidenceNote).all()
        assert len(rows) == 2
        assert rows[0].status == "material-requested"
        assert rows[1].status == "under-review"
        assert db.query(Equipment).count() == 0
        assert db.query(AiAuditLog).count() == 3


def test_no_forged_checkpoints_status_and_cross_user_access(mock_env):
    client, current, Session = mock_env
    selected = create(client, run_uid=U1).json()["data"]
    did = selected["id"]
    item_key = client.get(f"{API}/{did}/evidence").json()["data"]["items"][0]["key"]
    valid = {
        "item_key": item_key, "status": "pending",
        "note": "尚未取得现场文件，需要进一步联系项目业主",
    }
    assert client.post(f"{API}/{did}/evidence", json={
        **valid, "item_key": "e-ffffffffffffff",
    }).status_code == 422
    assert client.post(f"{API}/{did}/evidence", json={
        **valid, "status": "verified",
    }).status_code == 422
    assert client.post(f"{API}/{did}/evidence", json={
        **valid, "note": "太短",
    }).status_code == 422
    current["name"] = "other"
    assert client.get(f"{API}/{did}/evidence").status_code == 404
    assert client.post(f"{API}/{did}/evidence", json=valid).status_code == 404
    with Session() as db:
        assert db.query(TanggangMockAiEvidenceNote).count() == 0


def test_unique_run_id_prevents_report_cross_association_when_counter_restarts(mock_env):
    client, current, Session = mock_env
    selected = create(client, run_uid=U1).json()["data"]
    foreign_run = scenario(
        run_number=3, run_uid=U3,
        scenario_started_at="2026-11-22T15:19:11Z",
    )
    action = ask(client, "生成本轮SIM运行复盘报告",
                 context=foreign_run).json()["data"]["pending_actions"][0]
    assert "sim_decision" not in action["payload"]
    assert "sim_evidence" not in action["payload"]

    same_run = scenario(run_uid=U1)
    match = ask(client, "生成本轮SIM运行复盘报告",
                context=same_run).json()["data"]["pending_actions"][0]
    assert match["payload"]["sim_decision"]["id"] == selected["id"]
    assert match["payload"]["sim_evidence"]["verified"] == 0
    assert match["payload"]["run_uid"] == U1

    forged = scenario(
        run_uid=U1, demand_m3h=140, delivered_m3h=105,
        shortage_m3h=35, coverage_percent=75,
        plans=[{**OPTIONS[0], "shortage_m3h": 35}, *OPTIONS[1:]],
    )
    wrong = ask(client, "生成本轮SIM运行复盘报告",
                context=forged).json()["data"]["pending_actions"][0]
    assert "sim_decision" not in wrong["payload"]


def test_new_run_id_is_required_for_replay_of_uid_backed_decision(mock_env):
    client, current, Session = mock_env
    selected = create(client, run_uid=U1).json()["data"]
    did = selected["id"]
    followup = scenario(
        run_number=4, run_uid=U1,
        scenario_started_at="2026-11-22T15:03:00Z",
    )
    assert client.post(f"{API}/{did}/review", json={
        "demo_context": followup,
        "human_note": "重复使用本轮标识应被拒绝，无论轮次是否递增",
    }).status_code == 422
    followup["run_uid"] = None
    assert client.post(f"{API}/{did}/review", json={
        "demo_context": followup,
        "human_note": "新的模拟复核不可省略唯一运行标识",
    }).status_code == 422
    followup["run_uid"] = U2
    r = client.post(f"{API}/{did}/review", json={
        "demo_context": followup,
        "human_note": "再次运行同一高峰SIM情景，仍未进行真实设备调度",
    })
    assert r.status_code == 200, r.text
    review = r.json()["data"]["review"]
    assert review["run_uid"] == U2 and review["baseline_run_uid"] == U1
    assert review["effect_attribution"] == "NOT_DEMONSTRATED"
    own_report = ask(client, "生成本轮SIM运行复盘报告",
                     context=followup).json()["data"]["pending_actions"][0]
    assert own_report["payload"]["sim_decision"]["id"] == did
    assert own_report["payload"]["sim_decision"]["review"]["run_uid"] == U2


def test_report_freezes_latest_evidence_status_before_confirmation(mock_env):
    client, current, Session = mock_env
    selected = create(client, run_uid=U1).json()["data"]
    did = selected["id"]
    target = client.get(f"{API}/{did}/evidence").json()["data"]["items"][0]
    client.post(f"{API}/{did}/evidence", json={
        "item_key": target["key"], "status": "material-requested",
        "note": "已经联系业务方请求提供这项缺失资料",
    })
    action = ask(client, "生成本轮SIM运行复盘报告",
                 context=scenario(run_uid=U1)).json()["data"]["pending_actions"][0]
    assert action["payload"]["sim_evidence"]["material_requested"] == 1
    client.post(f"{API}/{did}/evidence", json={
        "item_key": target["key"], "status": "under-review",
        "note": "资料线索正在人工核对，尚未形成验证结论",
    })
    saved = client.post("/api/v1/ai/confirm", json={"action_id": action["action_id"]})
    assert saved.status_code == 200,saved.text
    report = client.get("/api/v1/ai/mock-reports").json()["data"][0]["report"]
    assert report["sim_evidence"]["material_requested"] == 1
    assert report["sim_evidence"]["under_review"] == 0
    assert report["sim_evidence"]["verified"] == 0


def test_only_dev_mock_can_read_write_checkpoints(mock_env, monkeypatch):
    from app.core.config import get_settings
    client,current,Session=mock_env
    did = create(client, run_uid=U1).json()["data"]["id"]
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    assert client.get(f"{API}/{did}/evidence").status_code == 404
    assert client.post(f"{API}/{did}/evidence", json={
        "item_key": "e-ffffffffffffff", "status": "pending",
        "note": "测试生产环境不得记录演示假核验",
    }).status_code == 404
