"""Tanggang SIM decision/review: deterministic evidence, not autonomous dispatch.

The browser snapshot is unverified SIM data. This module NEVER writes operational
alarms, PLC instructions, official work orders or authoritative equipment.
"""
import json
from datetime import datetime, UTC

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.ai_audit import AiAuditLog
from app.models.tanggang_mock_ai import TanggangMockAiDecision
from app.models.user import User


PLAN_IDS = ("as-is", "defer", "storage-first", "standby")
DATA_NOTICE = (
    "本轮数据只来自浏览器SIM情景；方案计算不代表现场可行、审批通过、"
    "实际设备恢复或节能节水效果。"
)


def _validate_plans(context: dict) -> dict[str, dict]:
    # Browser data is an unverified SIM snapshot. Reject internally
    # inconsistent arithmetic instead of presenting arbitrary figures as
    # calculated operational intelligence.
    demanded = context["demand_m3h"]
    delivered = context["delivered_m3h"]
    expected_shortage = max(0, demanded - delivered)
    expected_coverage = delivered / demanded * 100 if demanded > .001 else 100
    if (delivered > demanded + .15 or
        abs(context["shortage_m3h"] - expected_shortage) > .15 or
        abs(context["coverage_percent"] - expected_coverage) > .5):
        raise HTTPException(status_code=422, detail="SIM需水、供水、缺口和覆盖率不一致")
    plans = context.get("plans", [])
    ids = [p["id"] for p in plans]
    if len(plans) != 4 or set(ids) != set(PLAN_IDS) or len(set(ids)) != 4:
        raise HTTPException(status_code=422, detail="缺少同一轮四个SIM比选方案，请先运行统一情景")
    for plan in plans:
        if plan["field_validated"] is not False or plan["id"] not in PLAN_IDS:
            raise HTTPException(status_code=422, detail="禁止将现场方案与SIM比选混用")
    baseline = next(p for p in plans if p["id"] == "as-is")
    if abs(baseline["shortage_m3h"] - context["shortage_m3h"]) > .15:
        raise HTTPException(status_code=422, detail="基准方案与同一轮模拟缺口不一致")
    return {p["id"]: p for p in plans}


def analyze(context: dict) -> dict:
    if context.get("data_mode") != "SIM" or context.get("field_verified") is not False:
        raise HTTPException(status_code=422, detail="只接受SIM模拟数据")
    options = _validate_plans(context)
    rules = context.get("triggered_rules", [])
    insufficient = context.get("insufficient_rules", [])
    terminals = context.get("affected_terminals", [])
    constrained = [p["title"] for p in options.values() if p["constraint"] == "CONSTRAINT_FAIL"]
    roles = [
        {
            "id": "supply", "name": "供水分析", "mode": "MOCK_RULE",
            "finding": (
                f"第{context['run_number']}轮模拟需求{context['demand_m3h']:g}m³/h，"
                f"分配{context['delivered_m3h']:g}m³/h，缺口{context['shortage_m3h']:g}m³/h；"
                f"模拟受影响用水点{len(terminals)}个。"
            ),
            "evidence": "统一SIM供水分配结果与终端优先级假设",
            "limitation": "实际作业需水、泵曲线、池容与真实管网连接均待核实",
        },
        {
            "id": "monitor", "name": "主动监护", "mode": "MOCK_RULE",
            "finding": (
                f"演示监护状态{context['monitor_risk']}，"
                f"模拟命中规则{len(rules)}条，依据不足规则{len(insufficient)}条。"
            ),
            "evidence": "同一轮模拟压力、电流、状态规则及合成相对时间序列",
            "limitation": "相关性不等于泵故障导致缺水；合成时间轴不是现场历史",
        },
        {
            "id": "operations", "name": "处置研判", "mode": "MOCK_RULE",
            "finding": (
                "对同一SIM基线完成维持现状、错峰、守住安全储量、"
                "假设增加备用能力四种方案的限制条件比选。"
            ),
            "evidence": (
                f"模型储量约束未通过：{'、'.join(constrained) if constrained else '无'}；"
                "其余方案仍未现场核实。"
            ),
            "limitation": "不自动选择或下发方案，操作人员只能记录SIM研究选择并在新轮次复核",
        },
    ]
    return {
        "data_mode": "SIM", "field_verified": False,
        "scenario_id": context["scenario_id"], "run_number": context["run_number"],
        "roles": roles, "plans": [options[x] for x in PLAN_IDS],
        "notice": DATA_NOTICE,
    }


def _visible(row: TanggangMockAiDecision) -> dict:
    snapshot = json.loads(row.snapshot_json)
    review = json.loads(row.review_json) if row.review_json else None
    selected = next(x for x in snapshot["plans"] if x["id"] == row.selected_plan_id)
    return {
        "id": row.id, "status": row.status,
        "scenario_id": row.scenario_id, "baseline_run": row.baseline_run,
        "selected_plan_id": row.selected_plan_id, "selected_plan": selected,
        "baseline": {
            "shortage_m3h": snapshot["shortage_m3h"],
            "monitor_risk": snapshot["monitor_risk"],
        },
        "rationale": row.rationale, "analysis": analyze(snapshot),
        "review": review, "created_at": row.created_at,
        "data_mode": "SIM", "field_verified": False,
        "real_dispatch_executed": False,
    }


def _audit(db: Session, user: User, tool: str, result: dict, payload: dict):
    db.add(AiAuditLog(
        user_id=user.id, username=user.username, tool_name=tool,
        action_id="SIM-DECISION-" + str(result["id"]),
        title="SIM方案研究" if tool == "record_sim_decision" else "SIM方案复核",
        status="confirmed",
        payload_json=json.dumps(payload, ensure_ascii=False),
        result_json=json.dumps({"id": result["id"], "status": result["status"]},
                               ensure_ascii=False),
    ))


def create(db: Session, user: User, context: dict, plan_id: str, rationale: str) -> dict:
    analysis = analyze(context)
    if plan_id not in PLAN_IDS:
        raise HTTPException(status_code=422, detail="仅可选择既有四种模拟方案")
    # Only record the human-selected *research option*. No operational approval.
    row = TanggangMockAiDecision(
        owner_id=user.id, scenario_id=context["scenario_id"],
        baseline_run=context["run_number"],
        selected_plan_id=plan_id, status="selected",
        snapshot_json=json.dumps(context, ensure_ascii=False),
        rationale=rationale.strip(),
    )
    db.add(row)
    db.flush()
    result = _visible(row)
    _audit(db, user, "record_sim_decision", result, {
        "data_mode": "SIM", "plan_id": plan_id,
        "scenario_id": context["scenario_id"], "run_number": context["run_number"],
        "rationale": rationale,
    })
    db.commit()
    return result


def list_mine(db: Session, user: User) -> list[dict]:
    rows = db.query(TanggangMockAiDecision).filter(
        TanggangMockAiDecision.owner_id == user.id,
    ).order_by(TanggangMockAiDecision.id.desc()).limit(80).all()
    return [_visible(row) for row in rows]


def get_mine(db: Session, user: User, decision_id: int) -> TanggangMockAiDecision:
    row = db.query(TanggangMockAiDecision).filter(
        TanggangMockAiDecision.id == decision_id,
        TanggangMockAiDecision.owner_id == user.id,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="SIM研判记录不存在或无权查看")
    return row


def review(db: Session, user: User, decision_id: int,
           context: dict, human_note: str) -> dict:
    row = get_mine(db, user, decision_id)
    if row.status != "selected":
        raise HTTPException(status_code=409, detail="该SIM方案已经复核，不可重复覆盖")
    if context.get("data_mode") != "SIM" or context.get("field_verified") is not False:
        raise HTTPException(status_code=422, detail="复核结果必须来自新的SIM情景")
    _validate_plans(context)
    if context["scenario_id"] != row.scenario_id or context["run_number"] <= row.baseline_run:
        raise HTTPException(status_code=422, detail="请运行同一情景的新SIM轮次后再复核")
    old = json.loads(row.snapshot_json)
    original_uid = old.get("run_uid")
    incoming_uid = context.get("run_uid")
    if original_uid and (not incoming_uid or incoming_uid == original_uid):
        raise HTTPException(status_code=422, detail="复核必须来自不同的SIM运行标识")
    if context.get("scenario_started_at", "") == old.get("scenario_started_at", ""):
        raise HTTPException(status_code=422, detail="复核不能重复使用原情景时间快照")
    before = old["shortage_m3h"]
    after = context["shortage_m3h"]
    delta = round(after - before, 3)
    finding = "SIM缺口减少" if delta < -.001 else (
        "SIM缺口增加" if delta > .001 else "SIM缺口未变化"
    )
    details = {
        "run_number": context["run_number"],
        "scenario_started_at": context.get("scenario_started_at", ""),
        "run_uid": context.get("run_uid"),
        "baseline_run_uid": old.get("run_uid"),
        "data_mode": "SIM", "field_verified": False,
        "before_shortage_m3h": before, "after_shortage_m3h": after,
        "shortage_delta_m3h": delta, "finding": finding,
        "after_monitor_risk": context["monitor_risk"],
        "constraint": next(
            p["constraint"] for p in context["plans"]
            if p["id"] == row.selected_plan_id
        ),
        "human_note": human_note.strip(),
        "simulation_only": True, "plan_executed": False,
        "effect_attribution": "NOT_DEMONSTRATED",
        "warning": "仅比较两次SIM输入与结果，不能证明已实施方案或取得现场治理效果",
    }
    now = datetime.now(UTC).replace(tzinfo=None)
    changed = db.execute(
        update(TanggangMockAiDecision).where(
            TanggangMockAiDecision.id == row.id,
            TanggangMockAiDecision.owner_id == user.id,
            TanggangMockAiDecision.status == "selected",
        ).values(
            status="reviewed", review_json=json.dumps(details, ensure_ascii=False),
            updated_at=now,
        ),
    ).rowcount
    if changed != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="复核状态已变化，请刷新")
    db.flush()
    db.refresh(row)
    result = _visible(row)
    _audit(db, user, "review_sim_decision", result, {
        "data_mode": "SIM", "before_run": row.baseline_run,
        "after_run": context["run_number"], "note": human_note,
        "effect_attribution": "NOT_DEMONSTRATED",
    })
    db.commit()
    return result
