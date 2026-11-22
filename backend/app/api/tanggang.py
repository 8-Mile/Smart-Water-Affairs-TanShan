"""Tanggang engineering object to real equipment/SCADA mapping.

Explicit operator review, one transaction per change and full revision history.
The verified flag certifies reviewed object identity, NEVER a pipe
hydraulic connection or measured SCADA provenance.
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.equipment import Equipment
from app.models.scada import ScadaPoint, ScadaPointLatest
from app.models.tanggang import (
    TanggangObjectLink, TanggangLinkAsset, TanggangLinkMetric, TanggangLinkRevision,
)
from app.services.tanggang_catalog import SYSTEMS
from app.services.tanggang_quality import point_envelope

router = APIRouter(prefix="/tanggang", tags=["tanggang"])


class LinkBody(BaseModel):
    object_id: str = Field(min_length=1, max_length=128)
    facility_id: str = Field(min_length=1, max_length=128)
    system_id: str
    cad_handle: str | None = Field(default=None, max_length=128)
    source_ref: str | None = Field(default=None, max_length=512)
    verified: bool = False
    asset_ids: list[int] = Field(default_factory=list, max_length=200)
    metric_ids: list[int] = Field(default_factory=list, max_length=500)

    @field_validator("object_id", "facility_id", "system_id")
    @classmethod
    def clean_id(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped or stripped != value or any(ord(ch) < 32 for ch in value):
            raise PydanticCustomError("invalid_tanggang_id","标识符不可为空、带首尾空格或控制字符")
        return value

    @field_validator("asset_ids", "metric_ids")
    @classmethod
    def distinct_positive_ids(cls, value: list[int]) -> list[int]:
        if any(i <= 0 for i in value) or len(value) != len(set(value)):
            raise PydanticCustomError("invalid_tanggang_refs","设备/测点编号必须为唯一的正整数")
        return value

    @model_validator(mode="after")
    def check_evidence(self):
        if self.system_id not in SYSTEMS:
            raise PydanticCustomError("invalid_tanggang_system","未知的唐港六系统ID")
        if self.verified and (not self.source_ref or not self.source_ref.strip()):
            raise PydanticCustomError("missing_tanggang_evidence","审核通过的对象关系必须提供可追溯的工程来源")
        return self


def _serialized(record: TanggangObjectLink) -> dict:
    return {
        "id": record.id,
        "object_id": record.object_id,
        "facility_id": record.facility_id,
        "system_id": record.system_id,
        "system_name": SYSTEMS[record.system_id],
        "cad_handle": record.cad_handle,
        "source_ref": record.source_ref,
        "asset_ids": sorted(x.asset_id for x in record.asset_refs),
        "metric_ids": sorted(x.point_id for x in record.metric_refs),
        "verified": bool(record.verified),
        "verified_by": record.verified_by,
        "verified_at": record.verified_at,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "data_mode": "REF",
        "hydraulic_topology_verified": False,
    }


def _row(db, link_id: int) -> TanggangObjectLink:
    row = (
        db.query(TanggangObjectLink)
        .options(selectinload(TanggangObjectLink.asset_refs),
                 selectinload(TanggangObjectLink.metric_refs))
        .filter(TanggangObjectLink.id == link_id, TanggangObjectLink.deleted == 0)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="工程对象关联不存在")
    return row


def _validate_references(db, body: LinkBody) -> None:
    if body.asset_ids:
        matches = db.query(Equipment.id).filter(
            Equipment.id.in_(body.asset_ids), Equipment.deleted == 0,
        ).all()
        found = {x[0] for x in matches}
        if found != set(body.asset_ids):
            raise HTTPException(status_code=400, detail="设备台账存在无效或已删除编号")
    if body.metric_ids:
        points = db.query(ScadaPoint).filter(
            ScadaPoint.id.in_(body.metric_ids), ScadaPoint.deleted == 0,
        ).all()
        if {x.id for x in points} != set(body.metric_ids):
            raise HTTPException(status_code=400, detail="SCADA点表存在无效或已删除编号")
        for point in points:
            if point.equipment_id is not None and point.equipment_id not in body.asset_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"测点 {point.id} 已绑定设备 {point.equipment_id}，必须在本关联中同时指定该设备",
                )


def _apply(row: TanggangObjectLink, body: LinkBody, user_id: int) -> None:
    row.object_id = body.object_id
    row.facility_id = body.facility_id
    row.system_id = body.system_id
    row.cad_handle = body.cad_handle
    row.source_ref = body.source_ref.strip() if body.source_ref else None
    row.verified = int(body.verified)
    row.verified_by = user_id if body.verified else None
    row.verified_at = datetime.now(timezone.utc).replace(tzinfo=None) if body.verified else None
    row.updated_by = user_id
    existing_assets = {x.asset_id:x for x in row.asset_refs}
    existing_metrics = {x.point_id:x for x in row.metric_refs}
    # Reuse existing link rows; replacing equal relations could conflict with the
    # unique(link_id, asset_id/point_id) constraint during an UPDATE.
    row.asset_refs = [
        existing_assets.get(x) or TanggangLinkAsset(asset_id=x)
        for x in sorted(body.asset_ids)
    ]
    row.metric_refs = [
        existing_metrics.get(x) or TanggangLinkMetric(point_id=x)
        for x in sorted(body.metric_ids)
    ]


def _rev(db, link_id: int, action: str, before: dict | None, after: dict | None, actor: int):
    db.add(TanggangLinkRevision(
        link_id=link_id, action=action,
        before_json=json.dumps(before, ensure_ascii=False, default=str) if before else None,
        after_json=json.dumps(after, ensure_ascii=False, default=str) if after else None,
        actor_id=actor,
    ))


@router.get("/systems")
def list_systems(_: CurrentUser):
    return ok([{"id":system_id,"name":name} for system_id,name in SYSTEMS.items()])


@router.get("/object-links")
def list_object_links(
    db: DbSession, _: CurrentUser,
    object_id: str | None = Query(None, max_length=128),
    facility_id: str | None = Query(None, max_length=128),
    system_id: str | None = Query(None, max_length=32),
    asset_id: int | None = Query(None, ge=1),
    metric_id: int | None = Query(None, ge=1),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    include_latest: bool = False,
):
    if system_id is not None and system_id not in SYSTEMS:
        raise HTTPException(status_code=400, detail="未知系统ID")
    q = db.query(TanggangObjectLink).filter(TanggangObjectLink.deleted == 0)
    if object_id is not None:
        q = q.filter(TanggangObjectLink.object_id == object_id)
    if facility_id is not None:
        q = q.filter(TanggangObjectLink.facility_id == facility_id)
    if system_id is not None:
        q = q.filter(TanggangObjectLink.system_id == system_id)
    if asset_id is not None:
        q = q.filter(TanggangObjectLink.asset_refs.any(TanggangLinkAsset.asset_id == asset_id))
    if metric_id is not None:
        q = q.filter(TanggangObjectLink.metric_refs.any(TanggangLinkMetric.point_id == metric_id))
    total = q.count()
    records = q.order_by(TanggangObjectLink.id.desc()).offset((page - 1)*page_size).limit(page_size).all()
    items = [_serialized(row) for row in records]
    # Resolve real asset names for business-page drill-down (no fabricated IDs).
    asset_ids = set(aid for item in items for aid in item["asset_ids"])
    existing_assets = (
        db.query(Equipment).filter(Equipment.id.in_(asset_ids), Equipment.deleted == 0).all()
        if asset_ids else []
    )
    asset_map = {x.id:x for x in existing_assets}
    for item in items:
        item["assets"] = [
            {"id":aid, "name":asset_map[aid].name, "code":asset_map[aid].code}
            for aid in item["asset_ids"] if aid in asset_map
        ]
        item["stale_asset_ids"] = [aid for aid in item["asset_ids"] if aid not in asset_map]
    if include_latest:
        point_ids = set(x for item in items for x in item["metric_ids"])
        points = (
            db.query(ScadaPoint).filter(ScadaPoint.id.in_(point_ids), ScadaPoint.deleted == 0).all()
            if point_ids else []
        )
        latest = (
            db.query(ScadaPointLatest).filter(ScadaPointLatest.point_id.in_(point_ids)).all()
            if point_ids else []
        )
        point_map = {x.id:x for x in points}
        latest_map = {x.point_id:x for x in latest}
        mode = get_settings().scada_mode
        for item in items:
            item["measurements"] = [
                point_envelope(point_map[pid],latest_map.get(pid),runtime_mode=mode)
                for pid in item["metric_ids"] if pid in point_map
            ]
    return ok({"items":items,"total":total,"page":page,"page_size":page_size})


@router.get("/object-links/{link_id}")
def get_object_link(link_id: int, db: DbSession, _: CurrentUser):
    return ok(_serialized(_row(db,link_id)))


@router.get("/object-links/{link_id}/revisions")
def get_link_revisions(link_id: int, db: DbSession, _: CurrentUser):
    _row(db,link_id)
    rows = db.query(TanggangLinkRevision).filter(
        TanggangLinkRevision.link_id == link_id,
    ).order_by(TanggangLinkRevision.id.desc()).limit(100).all()
    return ok([{
        "action":x.action,"actor_id":x.actor_id,"created_at":x.created_at,
        "before":json.loads(x.before_json) if x.before_json else None,
        "after":json.loads(x.after_json) if x.after_json else None,
    } for x in rows])


@router.post("/object-links")
def create_object_link(
    body: LinkBody, db: DbSession, user: CurrentUser,
    _perm=Depends(require_perm("eq:update")),
):
    _validate_references(db,body)
    existing = db.query(TanggangObjectLink).filter(
        TanggangObjectLink.object_id == body.object_id,
        TanggangObjectLink.facility_id == body.facility_id,
        TanggangObjectLink.system_id == body.system_id,
    ).first()
    if existing is not None and not existing.deleted:
        raise HTTPException(status_code=409, detail="该对象、设施与系统已建立关联")
    row = existing or TanggangObjectLink(
        object_id=body.object_id, facility_id=body.facility_id,
        system_id=body.system_id, created_by=user.id, updated_by=user.id,
    )
    row.deleted = 0
    _apply(row,body,user.id)
    db.add(row)
    db.flush()
    after = _serialized(row)
    _rev(db,row.id,"reactivate" if existing else "create",None,after,user.id)
    db.commit()
    return ok(_serialized(_row(db,row.id)))


@router.put("/object-links/{link_id}")
def update_object_link(
    link_id:int, body:LinkBody, db:DbSession, user:CurrentUser,
    _perm=Depends(require_perm("eq:update")),
):
    row = _row(db,link_id)
    if (body.object_id,body.facility_id,body.system_id) != (row.object_id,row.facility_id,row.system_id):
        raise HTTPException(status_code=400, detail="对象/设施/系统主身份不可更改，请创建新的关联")
    _validate_references(db,body)
    before = _serialized(row)
    _apply(row,body,user.id)
    db.flush()
    _rev(db,row.id,"update",before,_serialized(row),user.id)
    db.commit()
    return ok(_serialized(_row(db,link_id)))


@router.delete("/object-links/{link_id}")
def delete_object_link(
    link_id:int, db:DbSession, user:CurrentUser,
    _perm=Depends(require_perm("eq:update")),
):
    row = _row(db,link_id)
    before = _serialized(row)
    row.deleted = 1
    row.updated_by = user.id
    _rev(db,row.id,"delete",before,None,user.id)
    db.commit()
    return ok({"id":link_id,"deleted":True})
