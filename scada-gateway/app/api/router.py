from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.response import ok
from app.core.security import require_gateway_token
from app.retention import retention_worker
from app.runtime import gateway_runtime
from app.store.models import GwPoint, GwPointLatest, GwTagData
from app.api.schemas import InjectRequest, PointCreate, PointUpdate, RuntimeControl

DbSession = Annotated[Session, Depends(get_db)]
Auth = Annotated[None, Depends(require_gateway_token)]

router = APIRouter()


def _display_value(value_type: str, value_num, value_bool, value_str):
    if value_type == "bool":
        return value_bool
    if value_type == "string":
        return value_str
    if value_num is not None:
        return float(value_num)
    return None


def _point_dict(p: GwPoint, latest: GwPointLatest | None = None) -> dict[str, Any]:
    data = {
        "id": p.id,
        "tag_name": p.tag_name,
        "node_id": p.node_id,
        "value_type": p.value_type,
        "unit": p.unit,
        "description": p.description,
        "source": p.source,
        "sim_base": float(p.sim_base or 0),
        "sim_amplitude": float(p.sim_amplitude or 0),
        "sim_period_sec": float(p.sim_period_sec or 0),
        "enabled": p.enabled,
    }
    if latest:
        data["latest_value"] = _display_value(
            latest.value_type, latest.value_num, latest.value_bool, latest.value_str
        )
        data["latest_ts_ms"] = latest.ts_ms
        data["status_name"] = latest.status_name
    return data


@router.get("/health")
def health(_: Auth):
    st = gateway_runtime.status()
    return ok(
        {
            "status": "up",
            "service": "scada-gateway",
            "version": "0.2.0",
            "runtime": st,
            "retention": retention_worker.status(),
        }
    )


@router.post("/retention/run")
def retention_run(_: Auth):
    """手动触发一次历史清理。"""
    deleted = retention_worker.run_once()
    return ok({"deleted": deleted, **retention_worker.status()}, message="retention done")


@router.get("/runtime/status")
def runtime_status(_: Auth):
    return ok(gateway_runtime.status())


@router.post("/runtime/start")
def runtime_start(body: RuntimeControl, _: Auth):
    try:
        st = gateway_runtime.start(mode=body.mode, interval_sec=body.interval_sec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ok(st, message="采集已启动")


@router.post("/runtime/stop")
def runtime_stop(_: Auth):
    st = gateway_runtime.stop()
    return ok(st, message="采集已停止")


@router.get("/points")
def list_points(
    db: DbSession,
    _: Auth,
    keyword: str | None = None,
    enabled: int | None = None,
):
    q = db.query(GwPoint)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (GwPoint.tag_name.like(like))
            | (GwPoint.node_id.like(like))
            | (GwPoint.description.like(like))
        )
    if enabled is not None:
        q = q.filter(GwPoint.enabled == enabled)
    rows = q.order_by(GwPoint.id.asc()).all()
    latest_map = {
        x.point_id: x
        for x in db.query(GwPointLatest).all()
    }
    return ok([_point_dict(p, latest_map.get(p.id)) for p in rows])


@router.post("/points")
def create_point(body: PointCreate, db: DbSession, _: Auth):
    exists = db.query(GwPoint).filter(GwPoint.tag_name == body.tag_name).first()
    if exists:
        raise HTTPException(status_code=400, detail="测点名称已存在")
    obj = GwPoint(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_point_dict(obj))


@router.put("/points/{point_id}")
def update_point(point_id: int, body: PointUpdate, db: DbSession, _: Auth):
    obj = db.query(GwPoint).filter(GwPoint.id == point_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="测点不存在")
    data = body.model_dump(exclude_unset=True)
    if "tag_name" in data:
        clash = (
            db.query(GwPoint)
            .filter(GwPoint.tag_name == data["tag_name"], GwPoint.id != point_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail="测点名称已存在")
    for k, v in data.items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_point_dict(obj))


@router.delete("/points/{point_id}")
def delete_point(point_id: int, db: DbSession, _: Auth):
    obj = db.query(GwPoint).filter(GwPoint.id == point_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="测点不存在")
    db.delete(obj)
    db.query(GwPointLatest).filter(GwPointLatest.point_id == point_id).delete()
    db.commit()
    return ok(True)


@router.get("/latest")
def list_latest(
    db: DbSession,
    _: Auth,
    tag_name: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
):
    q = db.query(GwPointLatest).order_by(GwPointLatest.updated_at.desc())
    if tag_name:
        q = q.filter(GwPointLatest.tag_name == tag_name)
    rows = q.limit(limit).all()
    items = [
        {
            "point_id": r.point_id,
            "tag_name": r.tag_name,
            "node_id": r.node_id,
            "value_type": r.value_type,
            "value_num": float(r.value_num) if r.value_num is not None else None,
            "value_bool": r.value_bool,
            "value_str": r.value_str,
            "display_value": _display_value(
                r.value_type, r.value_num, r.value_bool, r.value_str
            ),
            "status_code": r.status_code,
            "status_name": r.status_name,
            "ts_ms": r.ts_ms,
            "updated_at": r.updated_at,
        }
        for r in rows
    ]
    return ok(items)


@router.get("/history")
def list_history(
    db: DbSession,
    _: Auth,
    tag_name: str = Query(..., min_length=1),
    from_ts: int | None = Query(None, description="起始毫秒时间戳"),
    to_ts: int | None = Query(None, description="结束毫秒时间戳"),
    limit: int = Query(1000, ge=1, le=10000),
):
    q = db.query(GwTagData).filter(GwTagData.tag_name == tag_name)
    if from_ts is not None:
        q = q.filter(GwTagData.ts_ms >= from_ts)
    if to_ts is not None:
        q = q.filter(GwTagData.ts_ms <= to_ts)
    rows = q.order_by(GwTagData.ts_ms.desc()).limit(limit).all()
    items = [
        {
            "tag_name": r.tag_name,
            "node_id": r.node_id,
            "value_type": r.value_type,
            "value_num": float(r.value_num) if r.value_num is not None else None,
            "value_bool": r.value_bool,
            "value_str": r.value_str,
            "display_value": _display_value(
                r.value_type, r.value_num, r.value_bool, r.value_str
            ),
            "status_name": r.status_name,
            "ts_ms": r.ts_ms,
        }
        for r in rows
    ]
    return ok(items)


@router.post("/inject")
def inject_value(body: InjectRequest, db: DbSession, _: Auth):
    point_id = body.point_id
    if point_id is None:
        if not body.tag_name:
            raise HTTPException(status_code=400, detail="point_id 或 tag_name 必填其一")
        p = db.query(GwPoint).filter(GwPoint.tag_name == body.tag_name).first()
        if not p:
            raise HTTPException(status_code=404, detail="测点不存在")
        point_id = p.id
    try:
        sample = gateway_runtime.inject(
            point_id=point_id,
            value=body.value,
            value_type=body.value_type,
            write_history=body.write_history,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ok(sample.to_dict())
