"""SIM-only, append-only notes against actual known missing evidence.

Items originate from the selected SIM decision's own locked input snapshot,
never from invented CAD drawings, sources or official SCADA readings.
"""
import hashlib
import json
from collections import Counter

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.ai_audit import AiAuditLog
from app.models.tanggang_mock_ai import TanggangMockAiEvidenceNote
from app.models.user import User
from app.services.tanggang_mock_decision import get_mine

# None of these states implies evidence is verified or field tests completed.
STATUSES = ("pending", "material-requested", "under-review")
FIXED_GATES = (
    "核对实际生产作业负荷与各用水终端需求",
    "核对泵组铭牌、设备性能曲线与可用备用能力",
    "核对现场池容曲线、最低水位及补水能力",
    "核对管道拓扑、阀门联锁与供水可达性",
    "核对水质与各供水水源的适用条件",
)


def _items(snapshot: dict, selected_id: str) -> list[dict]:
    plan = next(p for p in snapshot["plans"] if p["id"] == selected_id)
    candidates = [
        *[("required", label) for label in FIXED_GATES],
        *[("sim-checkpoint", label) for label in snapshot.get("checkpoints", [])],
        *[("plan-blocker", label) for label in plan.get("blockers", [])],
    ]
    items = []
    known: set[str] = set()
    for source, raw in candidates:
        label = str(raw).strip()[:160]
        if not label or label in known:
            continue
        known.add(label)
        key = "e-" + hashlib.sha256(label.encode("utf-8")).hexdigest()[:14]
        items.append({
            "key": key, "label": label, "kind": source,
            "source_verified": False,
        })
    return items[:30]


def list_checkpoints(db: Session, user: User, decision_id: int) -> dict:
    decision = get_mine(db, user, decision_id)
    snapshot = json.loads(decision.snapshot_json)
    items = _items(snapshot, decision.selected_plan_id)
    notes = db.query(TanggangMockAiEvidenceNote).filter(
        TanggangMockAiEvidenceNote.owner_id == user.id,
        TanggangMockAiEvidenceNote.decision_id == decision.id,
    ).order_by(TanggangMockAiEvidenceNote.id.asc()).limit(300).all()
    latest = {}
    for note in notes:
        latest[note.item_key] = note
    results = []
    for item in items:
        change = latest.get(item["key"])
        results.append({
            **item,
            "status": change.status if change else "pending",
            "note": change.note if change else "",
            "source_reference": change.source_reference if change else "",
            "note_count": sum(1 for n in notes if n.item_key == item["key"]),
            # Intentionally never 'verified', even if a user adds a document name.
            "field_verified": False,
        })
    counts = Counter(r["status"] for r in results)
    return {
        "decision_id": decision_id, "data_mode": "SIM",
        "field_verified": False, "items": results,
        "total": len(results),
        "pending": counts["pending"],
        "material_requested": counts["material-requested"],
        "under_review": counts["under-review"],
        "verified": 0,
    }


def record_note(db: Session, user: User, decision_id: int, *,
                item_key: str, status: str, note: str,
                source_reference: str = "") -> dict:
    decision = get_mine(db, user, decision_id)
    if status not in STATUSES:
        raise HTTPException(status_code=422, detail="核验事项状态不在白名单")
    if len(note.strip()) < 8 or len(note.strip()) > 1000:
        raise HTTPException(status_code=422, detail="请填写8到1000字的资料核对意见")
    if len(source_reference.strip()) > 160:
        raise HTTPException(status_code=422, detail="资料线索不能超过160字")
    snapshot = json.loads(decision.snapshot_json)
    items = _items(snapshot, decision.selected_plan_id)
    matched = next((i for i in items if i["key"] == item_key), None)
    if not matched:
        raise HTTPException(status_code=422, detail="核验事项与当前SIM方案不匹配")
    count = db.query(TanggangMockAiEvidenceNote).filter(
        TanggangMockAiEvidenceNote.owner_id == user.id,
        TanggangMockAiEvidenceNote.decision_id == decision_id,
    ).count()
    if count >= 150:
        raise HTTPException(status_code=429, detail="该演示方案的核对意见已达记录上限")
    row = TanggangMockAiEvidenceNote(
        decision_id=decision_id, owner_id=user.id, item_key=item_key,
        status=status, note=note.strip(),
        source_reference=source_reference.strip(),
    )
    db.add(row)
    db.flush()
    db.add(AiAuditLog(
        user_id=user.id, username=user.username,
        action_id="SIM-EVIDENCE-" + str(row.id),
        tool_name="record_sim_evidence",
        title="SIM待核实事项意见记录", status="confirmed",
        payload_json=json.dumps({
            "decision_id": decision_id, "item_key": item_key,
            "status": status, "source_reference": source_reference.strip(),
            "source_verified": False,
        }, ensure_ascii=False),
        result_json=json.dumps({"id": row.id, "field_verified": False},
                               ensure_ascii=False),
    ))
    db.commit()
    return list_checkpoints(db, user, decision_id)


def report_snapshot(db: Session, user: User, decision_id: int) -> dict:
    # A frozen summary captured at SIM report planning time, not evidence that
    # the actual facility or documentation has been validated.
    state = list_checkpoints(db, user, decision_id)
    return {
        "decision_id": decision_id, "total": state["total"],
        "pending": state["pending"],
        "material_requested": state["material_requested"],
        "under_review": state["under_review"],
        "verified": 0, "field_verified": False,
        "items": state["items"],
    }
