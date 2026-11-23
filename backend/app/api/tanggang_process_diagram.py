"""Fog diagram editing: old 5144-style schema, 5190 role gates and revisions.

No arbitrary HTML/JS/SVG, network image URLs, control commands or telemetry
writes. Illustrative connections are never certified physical water pipes.
"""
import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError
from sqlalchemy.exc import IntegrityError

from app.core.deps import DbSession, CurrentUser, collect_user_perms
from app.core.response import ok
from app.models.tanggang_process_diagram import (
    TanggangProcessDiagram, TanggangProcessDiagramRevision,
)

router = APIRouter(prefix="/tanggang/process-diagrams", tags=["tanggang-process-diagrams"])

# Whitelist is derived from the project's versioned CAD equipment inventories.
# This remains a *design* mapping, never a claim about field-installed devices.
# The pinned manifest ships WITH the backend. Otherwise standalone backend
# deployments would depend on a frontend source directory being mounted.
_MANIFEST = Path(__file__).resolve().parents[1] / "resources" / "tanggang_process_facilities.json"
with _MANIFEST.open(encoding="utf-8") as f:
    _cad_manifest = json.load(f)
SYSTEMS = {row["id"]: row["name"] for row in _cad_manifest["systems"]}
CAD_FACILITIES = {
    row["id"]: set(row["facility_ids"]) for row in _cad_manifest["systems"]
}
CAD_POINT_FIELDS = {
    facility: set(fields) for facility, fields in _cad_manifest["fields"].items()
}
assert set(SYSTEMS) == {"fog", "middle", "mineral", "rain", "pool", "domestic"}
SYMBOLS = {
    "fog_cannon", "water_tank", "centrifugal_pump", "pressure_gauge",
    "flow_meter", "butterfly_valve", "label", "generic_equipment",
    "pipe_straight", "pipe_elbow", "pipe_tee", "pipe_cross", "y_strainer",
}
PERM_EDIT = "eq:update"
PERM_PUBLISH = "sys:menu:manage"


class DiagramPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=0, le=2200)
    y: float = Field(ge=0, le=1400)


class DiagramSize(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width: float = Field(gt=0, le=700)
    height: float = Field(gt=0, le=700)


class DiagramCanvasSize(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width: float = Field(ge=400, le=2200)
    height: float = Field(ge=300, le=1400)


class DiagramNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=2, max_length=60, pattern=r"^[a-zA-Z0-9_-]+$")
    symbol_id: Literal[
        "fog_cannon", "water_tank", "centrifugal_pump", "pressure_gauge",
        "flow_meter", "butterfly_valve", "label", "generic_equipment",
        "pipe_straight", "pipe_elbow", "pipe_tee", "pipe_cross", "y_strainer",
    ]
    facility_id: str | None = Field(default=None, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    position: DiagramPoint
    size: DiagramSize
    point_keys: list[str] = Field(default_factory=list, max_length=10)
    visible: bool = True
    locked: bool = False

    @model_validator(mode="after")
    def valid_point_keys(self):
        if any(not x.strip() or len(x) > 60 for x in self.point_keys):
            raise PydanticCustomError("invalid_point_key", "测点显示字段长度不合法")
        if len(set(self.point_keys)) != len(self.point_keys):
            raise PydanticCustomError("duplicate_point_key", "测点显示字段不可重复")
        return self


class DiagramConnection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=2, max_length=60, pattern=r"^[a-zA-Z0-9_-]+$")
    source_node_id: str
    target_node_id: str
    medium: Literal["water", "signal", "sludge", "chemical"] = "water"
    relation: Literal["design", "conditional"] = "design"
    label: str | None = Field(default=None, max_length=50)
    verification: Literal["illustrative"] = "illustrative"


class DiagramDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_id: Literal["fog", "middle", "mineral", "rain", "pool", "domestic"]
    name: str = Field(min_length=2, max_length=80)
    view_box: DiagramCanvasSize
    background: Literal["light-grid"] = "light-grid"
    nodes: list[DiagramNode] = Field(min_length=1, max_length=60)
    connections: list[DiagramConnection] = Field(default_factory=list, max_length=60)

    @model_validator(mode="after")
    def valid_structure(self):
        allowed = CAD_FACILITIES[self.system_id]
        ids = [n.id for n in self.nodes]
        if len(ids) != len(set(ids)):
            raise PydanticCustomError("duplicate_node", "图元ID重复")
        bound: set[str] = set()
        for node in self.nodes:
            if node.facility_id and node.facility_id not in allowed:
                raise PydanticCustomError("invalid_facility", "图元只能绑定当前CAD设计设施")
            if node.facility_id:
                if node.facility_id in bound:
                    raise PydanticCustomError("duplicate_facility", "同一设计设施不可重复绑定")
                bound.add(node.facility_id)
            if node.position.x + node.size.width > self.view_box.width + 0.001 or (
                node.position.y + node.size.height > self.view_box.height + 0.001
            ):
                raise PydanticCustomError("node_overflow", "图元超出组态画布")
            if node.point_keys and not node.facility_id:
                raise PydanticCustomError("point_without_facility", "未绑定设计设施不能配置测点标签")
            if node.point_keys and not set(node.point_keys).issubset(
                CAD_POINT_FIELDS.get(node.facility_id or "", set())
            ):
                raise PydanticCustomError("unknown_point", "只能绑定该CAD设施已有的设计建议测点字段")
        line_ids = [c.id for c in self.connections]
        if len(line_ids) != len(set(line_ids)):
            raise PydanticCustomError("duplicate_line", "连接ID重复")
        for line in self.connections:
            if (line.source_node_id not in ids or line.target_node_id not in ids or
                    line.source_node_id == line.target_node_id or len(line.source_node_id) > 60 or
                    len(line.target_node_id) > 60):
                raise PydanticCustomError("invalid_connection", "连线两端必须是不同的已登记图元")
        return self


class SaveDraftBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    diagram: DiagramDocument


class RevisionActionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)


class RestoreBody(RevisionActionBody):
    version: int = Field(ge=1)


def _edit(db, user) -> bool:
    return PERM_EDIT in collect_user_perms(db, user) or _publish(db, user)


def _publish(db, user) -> bool:
    return PERM_PUBLISH in collect_user_perms(db, user)


def _must(db, user, permission: str):
    allowed = _edit(db, user) if permission == PERM_EDIT else _publish(db, user)
    if not allowed:
        raise HTTPException(status_code=403, detail=f"无操作权限：缺少 {permission}")


def _entry(db, sid: str):
    if sid not in SYSTEMS:
        raise HTTPException(status_code=404, detail="组态系统尚未接入编辑器")
    return db.query(TanggangProcessDiagram).filter(
        TanggangProcessDiagram.system_id == sid,
    ).first()


def _response(row, can_edit: bool, system_id: str):
    return {
        "system_id": row.system_id if row else system_id,
        "name": SYSTEMS[system_id],
        "draft": json.loads(row.draft_json) if row and row.draft_json and can_edit else None,
        "published": json.loads(row.published_json) if row and row.published_json else None,
        "revision": row.draft_revision if row else 0,
        "published_version": row.published_version if row else 0,
        "can_edit": can_edit,
        "data_mode": "SIM", "field_verified": False,
        "control_enabled": False,
    }


def _rev(db, row, action, actor):
    db.add(TanggangProcessDiagramRevision(
        diagram_id=row.id, system_id=row.system_id,
        action=action, revision=row.draft_revision, version=row.published_version,
        snapshot_json=row.published_json if action == "publish" else (row.draft_json or "{}"),
        actor_id=actor,
    ))


@router.get("/{system_id}")
def fetch_diagram(system_id: str, db: DbSession, user: CurrentUser):
    row = _entry(db, system_id)
    return ok(_response(row, _edit(db, user), system_id))


@router.put("/{system_id}/draft")
def save_draft(system_id: str, body: SaveDraftBody, db: DbSession, user: CurrentUser):
    _must(db, user, PERM_EDIT)
    if system_id not in SYSTEMS or body.diagram.system_id != system_id:
        raise HTTPException(status_code=400, detail="组态系统不匹配")
    row = _entry(db, system_id)
    revision = row.draft_revision if row else 0
    if revision != body.revision:
        raise HTTPException(status_code=409, detail="其他用户已经修改组态，请刷新后重试")
    if row is None:
        row = TanggangProcessDiagram(
            system_id=system_id, updated_by=user.id, draft_revision=0,
            published_version=0,
        )
        db.add(row)
        db.flush()
    row.draft_json = body.diagram.model_dump_json()
    row.draft_revision += 1
    row.updated_by = user.id
    _rev(db, row, "draft", user.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="并发组态编辑冲突") from None
    return ok(_response(row, True, system_id))


@router.post("/{system_id}/publish")
def publish(system_id: str, body: RevisionActionBody, db: DbSession, user: CurrentUser):
    _must(db, user, PERM_PUBLISH)
    row = _entry(db, system_id)
    if not row or not row.draft_json:
        raise HTTPException(status_code=400, detail="必须先保存组态草稿")
    if body.revision != row.draft_revision:
        raise HTTPException(status_code=409, detail="组态草稿已改变，请先刷新")
    DiagramDocument.model_validate_json(row.draft_json)
    row.published_json = row.draft_json
    row.published_version += 1
    row.draft_revision += 1
    row.draft_json = None
    row.updated_by = user.id
    _rev(db, row, "publish", user.id)
    db.commit()
    return ok(_response(row, True, system_id))


@router.get("/{system_id}/history")
def history(system_id: str, db: DbSession, user: CurrentUser):
    _must(db, user, PERM_EDIT)
    row = _entry(db, system_id)
    if not row:
        return ok([])
    versions = db.query(TanggangProcessDiagramRevision).filter(
        TanggangProcessDiagramRevision.diagram_id == row.id,
        TanggangProcessDiagramRevision.action == "publish",
    ).order_by(TanggangProcessDiagramRevision.version.desc()).limit(50).all()
    return ok([{
        "version": x.version, "revision": x.revision,
        "snapshot": json.loads(x.snapshot_json), "created_at": x.created_at,
        "actor_id": x.actor_id,
    } for x in versions])


@router.post("/{system_id}/restore")
def restore(system_id: str, body: RestoreBody, db: DbSession, user: CurrentUser):
    _must(db, user, PERM_PUBLISH)
    row = _entry(db, system_id)
    if not row or body.revision != row.draft_revision:
        raise HTTPException(status_code=409, detail="组态版本已更新，请刷新")
    target = db.query(TanggangProcessDiagramRevision).filter(
        TanggangProcessDiagramRevision.diagram_id == row.id,
        TanggangProcessDiagramRevision.action == "publish",
        TanggangProcessDiagramRevision.version == body.version,
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="所选历史发布版本不存在")
    row.draft_json = target.snapshot_json
    row.draft_revision += 1
    row.updated_by = user.id
    _rev(db, row, "restore", user.id)
    db.commit()
    return ok(_response(row, True, system_id))
