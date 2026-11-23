"""M11 process node mock reviews have safe same-run report integration."""
from copy import deepcopy
from test_tanggang_a2ui_boards import env
from test_tanggang_mock_ai import mock_env, ask
from test_tanggang_mock_decisions import scenario
from app.models.equipment import Equipment
from app.models.tanggang_mock_ai import TanggangMockAiReport
from app.models.ai_audit import AiAuditLog

RUN_A="11111111-1111-4111-8111-111111111111"
RUN_B="22222222-2222-4222-8222-222222222222"


def check(**patch):
    row={
        "system_id":"middle",
        "facility_id":"EQ-P-MID",
        "facility_name":"中压除尘泵组",
        "state":"fault",
        "note":"本轮仅做设备模拟核查，尚未证明现场发生了故障",
        "scenario_id":"pump-fault",
        "run_uid":RUN_A,
        "data_mode":"SIM",
        "field_verified":False,
        "production_alarm_created":False,
        "repair_order_created":False,
        "recorded_at":"2026-11-23T02:20:00Z",
    }
    row.update(patch)
    return row


def test_report_preserves_same_run_sim_node_snapshot_without_production_writes(mock_env):
    client,current,Session=mock_env
    snapshot=scenario(scenario_id="pump-fault",run_uid=RUN_A,
                      process_checks=[check()])
    r=ask(client,"生成本轮SIM运行复盘报告",context=snapshot)
    assert r.status_code==200,r.text
    action=r.json()["data"]["pending_actions"][0]
    assert action["tool"]=="create_sim_report"
    assert action["payload"]["process_checks"]==[check()]
    assert action["payload"]["production_case_created"] is False
    assert action["payload"]["repair_order_created"] is False
    with Session() as db:
        assert db.query(TanggangMockAiReport).count()==0
        assert db.query(Equipment).count()==0
    saved=client.post("/api/v1/ai/confirm",json={"action_id":action["action_id"]})
    assert saved.status_code==200,saved.text
    report=client.get("/api/v1/ai/mock-reports").json()["data"][0]["report"]
    assert report["process_checks"][0]["facility_id"]=="EQ-P-MID"
    assert report["process_checks"][0]["run_uid"]==RUN_A
    assert report["field_verified"] is False
    current["name"]="other"
    assert client.get("/api/v1/ai/mock-reports").json()["data"]==[]
    with Session() as db:
        assert db.query(Equipment).count()==0
        assert db.query(AiAuditLog).count()==1


def test_invalid_or_cross_run_node_notes_rejected_before_report_action(mock_env):
    client,current,Session=mock_env
    baseline=scenario(scenario_id="pump-fault",run_uid=RUN_A)
    variants=[
        check(run_uid=RUN_B),
        check(scenario_id="storm"),
        check(data_mode="MEASURED"),
        check(field_verified=True),
        check(production_alarm_created=True),
        check(repair_order_created=True),
        check(facility_id="../../work-orders"),
        check(system_id="unknown"),
        check(state="repaired"),
        check(note="太短"),
        check(note="s"*601),
    ]
    for candidate in variants:
        payload=deepcopy(baseline)
        payload["process_checks"]=[candidate]
        response=client.post("/api/v1/ai/mock-decisions/analyze",json=payload)
        assert response.status_code==422,(candidate,response.status_code,response.text)
    duplicate=deepcopy(baseline)
    duplicate["process_checks"]=[check(),check(note="模拟重复节点核查不得覆盖现有记录")]
    assert client.post("/api/v1/ai/mock-decisions/analyze",json=duplicate).status_code==422
    missing_run=deepcopy(baseline)
    missing_run["run_uid"]=None
    missing_run["process_checks"]=[check()]
    assert client.post("/api/v1/ai/mock-decisions/analyze",json=missing_run).status_code==422
    with Session() as db:
        assert db.query(TanggangMockAiReport).count()==0
        assert db.query(AiAuditLog).count()==0


def test_legacy_sim_reports_have_no_node_checks_not_a_fake_review(mock_env):
    client,current,Session=mock_env
    result=ask(client,"生成本轮SIM运行复盘报告",context=scenario())
    assert result.status_code==200
    action=result.json()["data"]["pending_actions"][0]
    assert action["payload"]["process_checks"]==[]
    assert action["payload"]["data_mode"]=="SIM"
