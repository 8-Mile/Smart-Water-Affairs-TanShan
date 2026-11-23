"""M19 CAD Handle ↔ process-flow candidate register (not proof of continuity).

All candidates require a human's engineering note, use source-V2.8 Handles
validated within the medium-compatible approved CAD layer, and remain
UNVERIFIED. There is no 'approve', 'field_verified' or PLC-related endpoint.
"""
import json
import re
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError

from app.core.deps import DbSession, CurrentUser, collect_user_perms
from app.core.response import ok
from app.models.tanggang_cad_connection import (
    TanggangCadConnectionCandidate, TanggangCadConnectionCandidateRevision,
)
from app.models.tanggang_process_diagram import TanggangProcessDiagram

router = APIRouter(prefix="/tanggang/cad-connection-candidates", tags=["tanggang-cad-evidence"])
_RESOURCE = Path(__file__).resolve().parents[1] / "resources/tanggang_cad_connection_candidates.json"
with _RESOURCE.open(encoding="utf-8") as stream:
    INDEX = json.load(stream)
if INDEX.get("schema_version") != 1 or INDEX.get("source_version") != "L1 V2.8":
    raise RuntimeError("M19 pinned engineering evidence manifest version invalid")
SYSTEMS = INDEX["systems"]
HANDLES = {layer: set(values) for layer, values in INDEX["handles_by_layer"].items()}
PERM_EDIT = "eq:update"
PERM_PUBLISH = "sys:menu:manage"
_SOURCE_HANDLE = re.compile(r"^[A-F0-9]{2,12}$")


class CandidateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    layer: str = Field(min_length=2, max_length=100)
    source_handles: list[str] = Field(min_length=1, max_length=8)
    review_note: str = Field(min_length=12, max_length=1200)
    status: Literal["candidate", "rejected"] = "candidate"

    @field_validator("review_note")
    @classmethod
    def valid_review_note(cls, note: str) -> str:
        trimmed = note.strip()
        if len(trimmed) < 12:
            raise ValueError("必须填写不少于12字的工程核查理由")
        return trimmed

    @field_validator("source_handles")
    @classmethod
    def handle_format(cls, handles: list[str]) -> list[str]:
        normalized = [value.strip().upper() for value in handles]
        if any(not _SOURCE_HANDLE.fullmatch(value) for value in normalized):
            raise ValueError("仅接受V2.8源CAD的十六进制Handle")
        if len(set(normalized)) != len(normalized):
            raise ValueError("CAD源Handle不可重复")
        return normalized


def _scope(system_id: str) -> dict:
    if system_id not in SYSTEMS:
        raise HTTPException(status_code=404, detail="当前系统没有M19 CAD候选关联范围")
    return SYSTEMS[system_id]


def _connection(system_id: str, connection_id: str) -> dict:
    for item in _scope(system_id)["connections"]:
        if item["connection_id"] == connection_id:
            return item
    raise HTTPException(status_code=404, detail="设计流程连接ID不在现有CAD证据清单内")


def _can_edit(db, user) -> bool:
    perms = collect_user_perms(db, user)
    return PERM_EDIT in perms or PERM_PUBLISH in perms


def _current_diagram_matches(db, system_id: str, reference: dict) -> bool:
    """Do not attach source handles to a changed or deleted diagram edge."""
    row = db.query(TanggangProcessDiagram).filter_by(system_id=system_id).first()
    if not row or not row.published_json:
        # Default template IDs from processFlow.ts are pinned in M19 INDEX.
        return True
    try:
        diagram = json.loads(row.published_json)
        line = next(x for x in diagram["connections"]
                    if x["id"] == reference["connection_id"])
    except (ValueError, KeyError, StopIteration, TypeError):
        return False
    return (
        line["source_node_id"] == reference["source_node_id"]
        and line["target_node_id"] == reference["target_node_id"]
        and line["medium"] == reference["medium"]
    )


def _serialize(row: TanggangCadConnectionCandidate) -> dict:
    return {
        "system_id": row.system_id,
        "connection_id": row.connection_id,
        "layer": row.layer,
        "source_handles": json.loads(row.source_handles_json),
        "review_note": row.review_note,
        "status": row.status,
        "revision": row.revision,
        "evidence_version": row.evidence_version,
        "updated_by": row.updated_by,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "physical_connection_verified": False,
    }


@router.get("/{system_id}")
def list_candidates(system_id: str, db: DbSession, user: CurrentUser):
    scope = _scope(system_id)
    rows = db.query(TanggangCadConnectionCandidate).filter(
        TanggangCadConnectionCandidate.system_id == system_id,
    ).all()
    lookup = {row.connection_id: row for row in rows}
    items = []
    for item in scope["connections"]:
        record = lookup.get(item["connection_id"])
        compatible = _current_diagram_matches(db, system_id, item)
        items.append({
            **item,
            "diagram_compatible": compatible,
            "candidate": _serialize(record) if record else None,
            "physical_connection_verified": False,
        })
    return ok({
        "system_id": system_id,
        "source_version": INDEX["source_version"],
        "scope": INDEX["scope"],
        "can_edit": _can_edit(db, user),
        "can_verify_physical_connection": False,
        "items": items,
        "total": len(items),
        "candidate_eligible": scope["candidate_scope_count"],
        "candidate_recorded": sum(x["candidate"] is not None
                                  and x["candidate"]["status"] == "candidate" for x in items),
    })


@router.put("/{system_id}/{connection_id}")
def save_candidate(system_id: str, connection_id: str, body: CandidateBody,
                   db: DbSession, user: CurrentUser):
    if not _can_edit(db, user):
        raise HTTPException(status_code=403, detail="无CAD关联草稿编辑权限：eq:update")
    reference = _connection(system_id, connection_id)
    layer = reference["candidate_layer"]
    if not layer:
        raise HTTPException(
            status_code=400,
            detail="此工艺连接缺少同介质CAD管线图层资料，禁止提出物理Handle关联",
        )
    if body.layer != layer:
        raise HTTPException(status_code=400, detail="CAD图层与本工艺连接介质不匹配")
    if not set(body.source_handles).issubset(HANDLES.get(body.layer, set())):
        raise HTTPException(status_code=400, detail="源Handle不在对应V2.8 CAD图层台账")
    if not _current_diagram_matches(db, system_id, reference):
        raise HTTPException(status_code=409, detail="已发布组态连接与M19底稿不一致，需先校核映射")
    row = db.query(TanggangCadConnectionCandidate).filter_by(
        system_id=system_id, connection_id=connection_id,
    ).first()
    if body.status == "rejected" and not row:
        raise HTTPException(status_code=400, detail="无候选关联可驳回")
    revision = row.revision if row else 0
    if revision != body.revision:
        raise HTTPException(status_code=409, detail="CAD候选记录已被其他人员修改，请刷新后重试")
    if row is None:
        row = TanggangCadConnectionCandidate(
            system_id=system_id, connection_id=connection_id,
            layer=body.layer, source_handles_json="[]",
            review_note="", updated_by=user.id, revision=0,
        )
        db.add(row)
        db.flush()
    row.layer = layer
    row.source_handles_json = json.dumps(body.source_handles)
    row.review_note = body.review_note.strip()
    row.status = body.status
    row.revision += 1
    row.updated_by = user.id
    row.evidence_version = INDEX["source_version"]
    snapshot = _serialize(row)
    db.add(TanggangCadConnectionCandidateRevision(
        candidate_id=row.id, system_id=system_id, connection_id=connection_id,
        revision=row.revision, snapshot_json=json.dumps(snapshot, ensure_ascii=False),
        actor_id=user.id,
    ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="CAD候选记录并发写入冲突") from None
    db.refresh(row)
    return ok(_serialize(row))


@router.get("/{system_id}/{connection_id}/history")
def candidate_history(system_id: str, connection_id: str,
                      db: DbSession, user: CurrentUser):
    _connection(system_id, connection_id)
    rows = db.query(TanggangCadConnectionCandidateRevision).filter_by(
        system_id=system_id, connection_id=connection_id,
    ).order_by(TanggangCadConnectionCandidateRevision.revision.desc()).limit(50).all()
    return ok([{
        **json.loads(row.snapshot_json),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "actor_id": row.actor_id,
    } for row in rows])
