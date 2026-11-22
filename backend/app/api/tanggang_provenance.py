"""Review Tanggang documentary SCADA-point provenance, without any live-data claims."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError

from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.scada import ScadaPoint
from app.models.tanggang import TanggangObjectLink, TanggangLinkMetric
from app.models.tanggang_provenance import (
    TanggangPointReview, TanggangPointReviewRevision,
)
from app.services.tanggang_catalog import SYSTEMS
from app.services.tanggang_provenance import BASIS_TYPES, data_context
from app.services.tanggang_readiness import integration_readiness

router = APIRouter(prefix="/tanggang", tags=["tanggang-provenance"])


class PointReviewBody(BaseModel):
    system_id: str = Field(min_length=1, max_length=32)
    basis_type: str = Field(default="UNVERIFIED", max_length=32)
    source_ref: str | None = Field(default=None, max_length=512)
    assumption_note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_basis(self):
        if self.system_id not in SYSTEMS:
            raise PydanticCustomError("invalid_tg_system", "必须选择已登记的唐港六系统")
        if self.basis_type not in BASIS_TYPES:
            raise PydanticCustomError("invalid_tg_source", "不支持的资料来源类型；本阶段禁止标为实测")
        self.source_ref = self.source_ref.strip() if self.source_ref else None
        self.assumption_note = self.assumption_note.strip() if self.assumption_note else None
        if self.basis_type == "DOCUMENT_REFERENCE" and not self.source_ref:
            raise PydanticCustomError("missing_source_doc", "资料参考必须注明用户上传的具体资料")
        if self.basis_type in ("ASSUMPTION", "DEMO_VALUE") and not self.assumption_note:
            raise PydanticCustomError("missing_assumption", "演示假设或资料推导必须说明假设依据")
        return self


def _review_dict(row: TanggangPointReview | None) -> dict:
    if row is None:
        return {"system_id":None,"basis_type":"UNVERIFIED","source_ref":None,
                "assumption_note":None,"updated_by":None,"updated_at":None}
    return {
        "system_id":row.system_id, "basis_type":row.basis_type,
        "source_ref":row.source_ref,"assumption_note":row.assumption_note,
        "updated_by":row.updated_by,"updated_at":row.updated_at,
    }


@router.get("/data-context")
def read_data_context(_: CurrentUser):
    return ok(data_context())


@router.get("/integration-readiness")
def read_integration_readiness(db: DbSession, _: CurrentUser):
    """Read-only completeness overview for the six business systems."""
    return ok(integration_readiness(db))


@router.get("/point-audit")
def list_point_audit(
    db: DbSession, _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    keyword: str | None = Query(None, max_length=128),
    system_id: str | None = Query(None, max_length=32),
    basis_type: str | None = Query(None, max_length=32),
):
    if system_id is not None and system_id not in SYSTEMS:
        raise HTTPException(status_code=400, detail="无效系统编码")
    if basis_type is not None and basis_type not in BASIS_TYPES:
        raise HTTPException(status_code=400, detail="无效来源分类")
    query = db.query(ScadaPoint).filter(ScadaPoint.deleted == 0)
    if keyword:
        query = query.filter(
            ScadaPoint.tag_name.contains(keyword) |
            ScadaPoint.node_id.contains(keyword) |
            ScadaPoint.description.contains(keyword)
        )
    if system_id is not None:
        # Include both documented review assignments and *candidate* metric
        # relations from object mapping. Without this, the most important
        # unreviewed points disappear from the per-system audit list.
        reviewed_ids = db.query(TanggangPointReview.point_id).filter(
            TanggangPointReview.system_id == system_id
        )
        linked_ids = db.query(TanggangLinkMetric.point_id).join(
            TanggangObjectLink,
            TanggangLinkMetric.link_id == TanggangObjectLink.id,
        ).filter(
            TanggangObjectLink.system_id == system_id,
            TanggangObjectLink.deleted == 0,
        )
        query = query.filter(or_(
            ScadaPoint.id.in_(reviewed_ids),
            ScadaPoint.id.in_(linked_ids),
        ))
    if basis_type == "UNVERIFIED":
        query = query.filter(
            ~ScadaPoint.id.in_(db.query(TanggangPointReview.point_id))
            | ScadaPoint.id.in_(
                db.query(TanggangPointReview.point_id).filter(
                    TanggangPointReview.basis_type == "UNVERIFIED"
                )
            )
        )
    elif basis_type:
        query = query.filter(
            ScadaPoint.id.in_(
                db.query(TanggangPointReview.point_id).filter(
                    TanggangPointReview.basis_type == basis_type
                )
            )
        )
    total=query.count()
    points=query.order_by(ScadaPoint.id.asc()).offset((page-1)*page_size).limit(page_size).all()
    pids=[row.id for row in points]
    reviews = (
        db.query(TanggangPointReview).filter(TanggangPointReview.point_id.in_(pids)).all()
        if pids else []
    )
    link_refs = (
        db.query(TanggangLinkMetric.point_id, TanggangObjectLink.system_id).join(
            TanggangObjectLink, TanggangLinkMetric.link_id == TanggangObjectLink.id
        ).filter(
            TanggangLinkMetric.point_id.in_(pids),
            TanggangObjectLink.deleted == 0
        ).all() if pids else []
    )
    review_map={x.point_id:x for x in reviews}
    systems_map: dict[int, set[str]]={}
    for pid,sid in link_refs:
        systems_map.setdefault(pid,set()).add(sid)
    mode="SIM" if get_settings().scada_mode == "mock" else "UNKNOWN"
    return ok({
        "items":[{
            "point_id":p.id,"tag_name":p.tag_name,"node_id":p.node_id,
            "equipment_id":p.equipment_id,"unit":p.unit,
            "description":p.description,
            "data_mode":mode,
            "field_verified":False,
            "linked_systems":sorted(systems_map.get(p.id,set())),
            **_review_dict(review_map.get(p.id)),
        } for p in points],
        "total":total,"page":page,"page_size":page_size,
        "context": {
            "stage":"DOCUMENT_BASED_DEMO","field_verified_count":0,
            "total_existing_scada_points":db.query(ScadaPoint).filter(ScadaPoint.deleted == 0).count(),
            "review_records":db.query(TanggangPointReview).filter(
                TanggangPointReview.basis_type != "UNVERIFIED"
            ).count(),
        },
    })


@router.put("/point-reviews/{point_id}")
def update_point_review(
    point_id: int, body: PointReviewBody, db: DbSession, user: CurrentUser,
    _perm=Depends(require_perm("scada:point:update")),
):
    p=db.query(ScadaPoint).filter(
        ScadaPoint.id == point_id, ScadaPoint.deleted == 0,
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="测点不存在或已删除")
    row=db.query(TanggangPointReview).filter(
        TanggangPointReview.point_id == point_id
    ).first()
    before=_review_dict(row) if row else None
    if row is None:
        row=TanggangPointReview(point_id=point_id,updated_by=user.id)
    row.system_id=body.system_id
    row.basis_type=body.basis_type
    row.source_ref=body.source_ref
    row.assumption_note=body.assumption_note
    row.updated_by=user.id
    db.add(row)
    db.flush()
    after=_review_dict(row)
    db.add(TanggangPointReviewRevision(
        point_id=point_id,
        actor_id=user.id,
        before_json=json.dumps(before,ensure_ascii=False,default=str) if before else None,
        after_json=json.dumps(after,ensure_ascii=False,default=str),
    ))
    db.commit()
    db.refresh(row)
    return ok({"point_id":point_id,"field_verified":False,**_review_dict(row)})


@router.get("/point-reviews/{point_id}/revisions")
def point_review_history(point_id: int, db: DbSession, _: CurrentUser):
    rows=db.query(TanggangPointReviewRevision).filter(
        TanggangPointReviewRevision.point_id == point_id
    ).order_by(TanggangPointReviewRevision.id.desc()).limit(100).all()
    return ok([{
        "point_id":point_id,"actor_id":r.actor_id,"created_at":r.created_at,
        "before":json.loads(r.before_json) if r.before_json else None,
        "after":json.loads(r.after_json),
    } for r in rows])
