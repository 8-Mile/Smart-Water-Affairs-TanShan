"""End-to-end isolated tests of SIM-only mock three-role decision and review."""
from copy import deepcopy

from test_tanggang_a2ui_boards import env
from test_tanggang_mock_ai import mock_env, ask
from test_tanggang_mock_ai_followups import CONTEXT
from app.models.tanggang_mock_ai import TanggangMockAiDecision, TanggangMockAiReport
from app.models.ai_audit import AiAuditLog
from app.models.equipment import Equipment
from app.models.tanggang_equipment_draft import TanggangDemoEquipment

API = "/api/v1/ai/mock-decisions"
OPTIONS = [
    {"id": "as-is", "title": "维持现状", "shortage_m3h": 34,
     "deferred_m3h": 0, "raw_end_storage_m3": 350, "safety_margin_m3": 150,
     "constraint": "UNVERIFIED", "blockers": [], "field_validated": False},
    {"id": "defer", "title": "错峰低优先级用水", "shortage_m3h": 20,
     "deferred_m3h": 18, "raw_end_storage_m3": 390, "safety_margin_m3": 190,
     "constraint": "UNVERIFIED", "blockers": ["演示顺延不代表节水"], "field_validated": False},
    {"id": "storage-first", "title": "优先守住安全储量", "shortage_m3h": 48,
     "deferred_m3h": 0, "raw_end_storage_m3": 160, "safety_margin_m3": -40,
     "constraint": "CONSTRAINT_FAIL", "blockers": ["期末储量低于演示安全线"],
     "field_validated": False},
    {"id": "standby", "title": "假设备用能力增加", "shortage_m3h": 0,
     "deferred_m3h": 0, "raw_end_storage_m3": 320, "safety_margin_m3": 120,
     "constraint": "UNVERIFIED", "blockers": ["现场备用泵不存在性尚未核实"],
     "field_validated": False},
]


def scenario(**changes):
    context = deepcopy(CONTEXT)
    context["plans"] = deepcopy(OPTIONS)
    context.update(changes)
    return context


def create(client, plan="defer", **changes):
    return client.post(API, json={
        "demo_context": scenario(**changes),
        "plan_id": plan,
        "rationale": "演示研究优先考虑低优先级需求错峰，并记录未核实条件",
    })


def test_three_rule_roles_use_one_sim_snapshot_without_writes(mock_env):
    client,current,Session = mock_env
    response = client.post(API+"/analyze", json=scenario())
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["data_mode"] == "SIM"
    assert result["field_verified"] is False
    assert len(result["roles"]) == 3
    assert [r["id"] for r in result["roles"]] == ["supply","monitor","operations"]
    assert all(r["mode"] == "MOCK_RULE" for r in result["roles"])
    assert "34" in result["roles"][0]["finding"]
    assert "高电流" not in result["roles"][0]["evidence"]
    assert "未通过" in result["roles"][2]["evidence"]
    assert len(result["plans"]) == 4
    with Session() as db:
        assert db.query(TanggangMockAiDecision).count() == 0
        assert db.query(AiAuditLog).count() == 0
        assert db.query(Equipment).count() == 0


def test_reject_incomplete_or_mismatched_plan_and_measured_input(mock_env):
    client,current,Session = mock_env
    cases = [
        scenario(plans=[]),
        scenario(plans=OPTIONS[:3]),
        scenario(plans=[OPTIONS[0]]*4),
        scenario(plans=[{**OPTIONS[0],"shortage_m3h":1},*OPTIONS[1:]]),
        scenario(plans=[{**OPTIONS[0],"field_validated":True},*OPTIONS[1:]]),
        scenario(data_mode="MEASURED"),
        scenario(field_verified=True),
        scenario(demand_m3h=139,delivered_m3h=104,shortage_m3h=34),
        scenario(coverage_percent=99),
    ]
    for data in cases:
        response=client.post(API+"/analyze",json=data)
        assert response.status_code==422,response.text
    assert client.post(API,json={
        "demo_context": scenario(), "plan_id":"unknown", "rationale":"说明足够八个字以上",
    }).status_code==422
    assert client.post(API,json={
        "demo_context": scenario(), "plan_id":"defer", "rationale":"太短",
    }).status_code==422
    with Session() as db:
        assert db.query(TanggangMockAiDecision).count() == 0


def test_selection_persists_only_sim_decision_and_owner_scope(mock_env):
    client,current,Session=mock_env
    selected=create(client,plan="storage-first")
    assert selected.status_code==200,selected.text
    data=selected.json()["data"]
    assert data["status"]=="selected"
    assert data["selected_plan_id"]=="storage-first"
    assert data["selected_plan"]["constraint"]=="CONSTRAINT_FAIL"
    assert data["real_dispatch_executed"] is False
    assert data["field_verified"] is False
    row_id=data["id"]
    listing=client.get(API).json()["data"]
    assert len(listing)==1 and listing[0]["id"]==row_id
    assert client.get(API+"/"+str(row_id)).status_code==200
    current["name"]="other"
    assert client.get(API).json()["data"]==[]
    assert client.get(API+"/"+str(row_id)).status_code==404
    assert client.post(API+"/"+str(row_id)+"/review",json={
        "demo_context":scenario(run_number=4,scenario_started_at="2026-11-22T14:02:00Z"),
        "human_note":"希望在新轮次查看缺口变化但不实际执行任何调度",
    }).status_code==404
    with Session() as db:
        assert db.query(TanggangMockAiDecision).count()==1
        assert db.query(AiAuditLog).count()==1
        assert db.query(Equipment).count()==0
        assert db.query(TanggangDemoEquipment).count()==0


def test_review_requires_new_same_scenario_run_and_never_attributes_effect(mock_env):
    client,current,Session=mock_env
    row_id=create(client).json()["data"]["id"]
    note="第二次模拟调整泵组能力假设，仍无实际设备与生产作业数据"
    base={"demo_context":scenario(),"human_note":note}
    assert client.post(API+f"/{row_id}/review",json=base).status_code==422
    assert client.post(API+f"/{row_id}/review",json={
        "demo_context":scenario(run_number=4,scenario_id="storm",
                                scenario_started_at="2026-11-22T14:02:00Z"),
        "human_note":note,
    }).status_code==422
    assert client.post(API+f"/{row_id}/review",json={
        "demo_context":scenario(run_number=4), "human_note":note,
    }).status_code==422
    new_context=scenario(
        run_number=4,scenario_started_at="2026-11-22T14:02:00Z",
        shortage_m3h=18,demand_m3h=120,delivered_m3h=102,
        coverage_percent=85,
        plans=[{**OPTIONS[0],"shortage_m3h":18},*OPTIONS[1:]],
    )
    done=client.post(API+f"/{row_id}/review",json={
        "demo_context":new_context,"human_note":note,
    })
    assert done.status_code==200,done.text
    outcome=done.json()["data"]
    assert outcome["status"]=="reviewed"
    assert outcome["review"]["before_shortage_m3h"]==34
    assert outcome["review"]["after_shortage_m3h"]==18
    assert outcome["review"]["shortage_delta_m3h"]==-16
    assert outcome["review"]["plan_executed"] is False
    assert outcome["review"]["effect_attribution"]=="NOT_DEMONSTRATED"
    assert "缺口减少" in outcome["review"]["finding"]
    assert client.post(API+f"/{row_id}/review",json={
        "demo_context":new_context,"human_note":note,
    }).status_code==409
    with Session() as db:
        assert db.query(TanggangMockAiDecision).count()==1
        assert db.query(AiAuditLog).count()==2
        assert db.query(Equipment).count()==0


def test_agent_chat_routes_to_read_only_analysis_and_no_context_fails_safe(mock_env):
    client,current,Session=mock_env
    missing=ask(client,"分析本轮SIM处置方案").json()["data"]
    assert missing["pending_actions"]==[]
    assert "先启动" in missing["reply"]
    analyzed=ask(client,"分析本轮SIM处置方案",context=scenario())
    assert analyzed.status_code==200,analyzed.text
    result=analyzed.json()["data"]
    assert [t["name"] for t in result["tool_trace"]]==[
        "mock_supply","mock_monitor","mock_operations",
    ]
    assert "模拟需求" in result["reply"]
    assert result["links"]==[{
        "path":"/port/operations/decision", "label":"进入SIM处置研判",
    }]
    detail=client.get("/api/v1/ai/sessions/"+result["session_id"])
    assistant=[m for m in detail.json()["data"]["messages"] if m["role"]=="assistant"][0]
    assert assistant["links"][0]["path"]=="/port/operations/decision"
    with Session() as db:
        assert db.query(TanggangMockAiDecision).count()==0


def test_report_includes_only_related_user_sim_decision_not_production_status(mock_env):
    client,current,Session=mock_env
    choice=create(client).json()["data"]
    body=ask(client,"生成本轮SIM运行复盘报告",context=scenario()).json()["data"]
    action=body["pending_actions"][0]
    assert action["tool"]=="create_sim_report"
    linked=action["payload"]["sim_decision"]
    assert linked["id"]==choice["id"]
    assert linked["selected_plan_id"]=="defer"
    assert linked["real_dispatch_executed"] is False
    confirmed=client.post("/api/v1/ai/confirm",json={
        "action_id":action["action_id"],
    })
    assert confirmed.status_code==200,confirmed.text
    report=client.get("/api/v1/ai/mock-reports").json()["data"][0]["report"]
    assert report["sim_decision"]["id"]==choice["id"]
    assert report["data_mode"]=="SIM"
    assert report["production_case_created"] is False
    assert report["repair_order_created"] is False
    current["name"]="other"
    unrelated=ask(client,"生成本轮SIM运行复盘报告",context=scenario()).json()["data"]
    assert "sim_decision" not in unrelated["pending_actions"][0]["payload"]


def test_mock_decision_disabled_outside_development(mock_env,monkeypatch):
    from app.core.config import get_settings
    client,current,Session=mock_env
    monkeypatch.setattr(get_settings(),"app_env","prod")
    assert client.get(API).status_code==404
    assert client.post(API+"/analyze",json=scenario()).status_code==404
    assert client.post(API,json={
        "demo_context":scenario(),"plan_id":"defer",
        "rationale":"测试在生产模式不得创建模拟决策",
    }).status_code==404


def test_reviewed_choice_is_captured_in_followup_run_replay(mock_env):
    client,current,Session=mock_env
    decision=create(client,plan="defer").json()["data"]
    next_run=scenario(
        run_number=4,scenario_started_at="2026-11-22T15:00:00Z",
        demand_m3h=120,delivered_m3h=102,shortage_m3h=18,coverage_percent=85,
        plans=[{**OPTIONS[0],"shortage_m3h":18},*OPTIONS[1:]],
    )
    reviewed=client.post(API+"/"+str(decision["id"])+"/review",json={
        "demo_context":next_run,
        "human_note":"第二轮SIM仅改变假设参数，现场未操作泵组或管网",
    })
    assert reviewed.status_code==200,reviewed.text
    planned=ask(client,"生成本轮SIM运行复盘报告",context=next_run)
    assert planned.status_code==200,planned.text
    action=planned.json()["data"]["pending_actions"][0]
    association=action["payload"]["sim_decision"]
    assert association["id"]==decision["id"]
    assert association["status"]=="reviewed"
    assert association["review"]["run_number"]==4
    assert association["review"]["effect_attribution"]=="NOT_DEMONSTRATED"
    saved=client.post("/api/v1/ai/confirm",json={
        "action_id":action["action_id"],
    })
    assert saved.status_code==200,saved.text
    report=client.get("/api/v1/ai/mock-reports").json()["data"][0]["report"]
    assert report["sim_decision"]["review"]["after_shortage_m3h"]==18
    assert report["sim_decision"]["real_dispatch_executed"] is False
