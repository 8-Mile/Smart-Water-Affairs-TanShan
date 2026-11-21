from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import Depends, APIRouter, HTTPException, Query

from app.core.crud import get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.analytics import ElectricityPrice, EnergyEfficiencyDaily, EnergyRecord
from app.models.org import Unit
from app.services import analytics_service as analytics

router = APIRouter(prefix="/energy", tags=["energy"])


def _record_out(r: EnergyRecord) -> dict:
    return {
        "id": r.id,
        "record_time": r.record_time,
        "unit_id": r.unit_id,
        "unit_name": r.unit_name,
        "electricity_kwh": float(r.electricity_kwh),
        "remark": r.remark,
        "created_at": r.created_at,
    }


def _price_out(p: ElectricityPrice) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "peak_price": float(p.peak_price),
        "valley_price": float(p.valley_price),
        "normal_price": float(p.normal_price),
        "peak_hours": p.peak_hours,
        "valley_hours": p.valley_hours,
        "effective_from": p.effective_from,
        "effective_to": p.effective_to,
        "remark": p.remark,
        "status": p.status,
    }


# ---- records ----
@router.get("/records")
def list_records(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    unit_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    q = db.query(EnergyRecord).filter(EnergyRecord.deleted == 0)
    if unit_id is not None:
        q = q.filter(EnergyRecord.unit_id == unit_id)
    if start_date:
        q = q.filter(
            EnergyRecord.record_time >= datetime.combine(start_date, datetime.min.time())
        )
    if end_date:
        q = q.filter(
            EnergyRecord.record_time
            < datetime.combine(end_date + timedelta(days=1), datetime.min.time())
        )
    q = q.order_by(EnergyRecord.record_time.desc(), EnergyRecord.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_record_out(i) for i in result["items"]]
    return ok(result)


@router.post("/records")
def create_record(body: dict, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("energy:record:create")),
):
    unit_id = body.get("unit_id")
    record_time = body.get("record_time")
    kwh = body.get("electricity_kwh")
    if unit_id is None or not record_time or kwh is None:
        raise HTTPException(status_code=400, detail="机组、记录时间、耗电量必填")
    unit = (
        db.query(Unit).filter(Unit.id == unit_id, Unit.deleted == 0).first()
    )
    if not unit:
        raise HTTPException(status_code=400, detail="机组不存在")
    if isinstance(record_time, str):
        record_time = datetime.fromisoformat(record_time.replace("Z", ""))
    obj = EnergyRecord(
        record_time=record_time,
        unit_id=unit.id,
        unit_name=unit.name,
        electricity_kwh=Decimal(str(kwh)),
        remark=body.get("remark"),
        status=1,
        deleted=0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_record_out(obj))


@router.put("/records/{item_id}")
def update_record(item_id: int, body: dict, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("energy:record:update")),
):
    obj = get_or_404(db, EnergyRecord, item_id)
    if "unit_id" in body and body["unit_id"] is not None:
        unit = (
            db.query(Unit)
            .filter(Unit.id == body["unit_id"], Unit.deleted == 0)
            .first()
        )
        if not unit:
            raise HTTPException(status_code=400, detail="机组不存在")
        obj.unit_id = unit.id
        obj.unit_name = unit.name
    if "record_time" in body and body["record_time"] is not None:
        rt = body["record_time"]
        obj.record_time = (
            datetime.fromisoformat(rt.replace("Z", "")) if isinstance(rt, str) else rt
        )
    if "electricity_kwh" in body and body["electricity_kwh"] is not None:
        obj.electricity_kwh = Decimal(str(body["electricity_kwh"]))
    if "remark" in body:
        obj.remark = body["remark"]
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_record_out(obj))


@router.delete("/records/{item_id}")
def delete_record(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("energy:record:delete")),
):
    obj = get_or_404(db, EnergyRecord, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- stats ----
@router.get("/stats")
def stats(
    db: DbSession,
    _: CurrentUser,
    start_date: date | None = None,
    end_date: date | None = None,
    unit_id: int | None = None,
    dimension: str = Query("day", description="day|unit"),
):
    end = end_date or date.today()
    start = start_date or (end - timedelta(days=6))
    if dimension == "unit":
        items = analytics.energy_by_unit(db, start, end)
        water = analytics.water_actual_by_day(db, start, end)
        total_water = sum(water.values()) or 0
        # 粗略按机组分摊用水量不便，水电耗用总水
        for it in items:
            it["water_m3"] = round(total_water, 2) if len(items) == 1 else None
            it["ratio"] = (
                round(it["electricity_kwh"] / total_water, 4)
                if total_water > 0 and len(items) == 1
                else None
            )
        return ok(
            {
                "dimension": "unit",
                "labels": [i["unit_name"] for i in items],
                "values": [i["electricity_kwh"] for i in items],
                "items": items,
                "unit": "kWh",
                "title": "按机组电耗",
            }
        )

    energy = analytics.energy_by_day(db, start, end, unit_id=unit_id)
    water = analytics.water_actual_by_day(db, start, end)
    labels = []
    e_series = []
    w_series = []
    ratio = []
    table = []
    cur = start
    while cur <= end:
        k = cur.isoformat()
        labels.append(k)
        e = energy.get(k, 0.0)
        w = water.get(k, 0.0)
        e_series.append(e)
        w_series.append(w)
        r = round(e / w, 4) if w > 0 else None
        ratio.append(r)
        table.append(
            {
                "time": k,
                "electricity_kwh": e,
                "water_m3": w,
                "ratio": r,
            }
        )
        cur += timedelta(days=1)
    return ok(
        {
            "dimension": "day",
            "labels": labels,
            "electricity_kwh": e_series,
            "water_m3": w_series,
            "ratio": ratio,
            "table": table,
            "unit": "kWh",
            "title": "电耗统计",
        }
    )


@router.get("/fee")
def fee_stats(
    db: DbSession,
    _: CurrentUser,
    start_date: date | None = None,
    end_date: date | None = None,
):
    end = end_date or date.today()
    start = start_date or (end - timedelta(days=6))
    return ok(analytics.calc_electricity_fee(db, start, end))


@router.get("/water-ratio")
def water_ratio(
    db: DbSession,
    _: CurrentUser,
    start_date: date | None = None,
    end_date: date | None = None,
    unit_id: int | None = None,
    single_date: date | None = None,
):
    if single_date:
        start = end = single_date
    else:
        end = end_date or date.today()
        start = start_date or (end - timedelta(days=6))
    data = analytics.water_energy_ratio(db, start, end, unit_id=unit_id)
    # 泵组对比
    units = analytics.energy_by_unit(db, start, end)
    data["unit_compare"] = units
    return ok(data)


# ---- prices ----
@router.get("/prices")
def list_prices(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    q = (
        db.query(ElectricityPrice)
        .filter(ElectricityPrice.deleted == 0)
        .order_by(ElectricityPrice.effective_from.desc())
    )
    result = paginate(q, page, page_size)
    result["items"] = [_price_out(i) for i in result["items"]]
    return ok(result)


@router.get("/prices/active")
def active_price(db: DbSession, _: CurrentUser):
    p = analytics.active_price(db)
    return ok(_price_out(p) if p else None)


@router.post("/prices")
def create_price(body: dict, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("energy:price:create")),
):
    ef = body.get("effective_from")
    if not ef:
        raise HTTPException(status_code=400, detail="生效日期必填")
    if isinstance(ef, str):
        ef = date.fromisoformat(ef[:10])
    et = body.get("effective_to")
    if isinstance(et, str) and et:
        et = date.fromisoformat(et[:10])
    obj = ElectricityPrice(
        name=body.get("name") or "默认电价",
        peak_price=Decimal(str(body.get("peak_price") or 0)),
        valley_price=Decimal(str(body.get("valley_price") or 0)),
        normal_price=Decimal(str(body.get("normal_price") or 0)),
        peak_hours=body.get("peak_hours") or "8,9,10,18,19,20",
        valley_hours=body.get("valley_hours") or "0,1,2,3,4,5,23",
        effective_from=ef,
        effective_to=et,
        remark=body.get("remark"),
        status=body.get("status", 1),
        deleted=0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_price_out(obj))


@router.put("/prices/{item_id}")
def update_price(item_id: int, body: dict, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("energy:price:update")),
):
    obj = get_or_404(db, ElectricityPrice, item_id)
    for key in (
        "name",
        "peak_hours",
        "valley_hours",
        "remark",
        "status",
    ):
        if key in body and body[key] is not None:
            setattr(obj, key, body[key])
    for key in ("peak_price", "valley_price", "normal_price"):
        if key in body and body[key] is not None:
            setattr(obj, key, Decimal(str(body[key])))
    if "effective_from" in body and body["effective_from"] is not None:
        ef = body["effective_from"]
        obj.effective_from = date.fromisoformat(ef[:10]) if isinstance(ef, str) else ef
    if "effective_to" in body:
        et = body["effective_to"]
        if et is None or et == "":
            obj.effective_to = None
        else:
            obj.effective_to = date.fromisoformat(et[:10]) if isinstance(et, str) else et
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_price_out(obj))


@router.delete("/prices/{item_id}")
def delete_price(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("energy:price:delete")),
):
    obj = get_or_404(db, ElectricityPrice, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- efficiency ----
@router.get("/efficiency")
def list_efficiency(
    db: DbSession,
    _: CurrentUser,
    unit_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    """机组日能效指标（由时序数据自动计算）。"""
    q = db.query(EnergyEfficiencyDaily).filter(EnergyEfficiencyDaily.deleted == 0)
    if unit_id is not None:
        q = q.filter(EnergyEfficiencyDaily.unit_id == unit_id)
    if start_date:
        q = q.filter(EnergyEfficiencyDaily.stat_date >= start_date)
    if end_date:
        q = q.filter(EnergyEfficiencyDaily.stat_date <= end_date)
    rows = q.order_by(EnergyEfficiencyDaily.stat_date.desc(), EnergyEfficiencyDaily.unit_id).all()
    items = [
        {
            "id": r.id,
            "stat_date": r.stat_date,
            "unit_id": r.unit_id,
            "unit_name": r.unit_name,
            "electricity_kwh": float(r.electricity_kwh),
            "run_hours": float(r.run_hours),
            "water_m3": float(r.water_m3),
            "unit_consumption": float(r.unit_consumption),
            "avg_power_kw": float(r.avg_power_kw),
            "load_rate": float(r.load_rate),
            "efficiency": float(r.efficiency),
            "sample_count": r.sample_count,
            "remark": r.remark,
        }
        for r in rows
    ]
    return ok(items)
