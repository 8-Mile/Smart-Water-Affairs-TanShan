from datetime import date, timedelta
from decimal import Decimal

from fastapi import Depends, APIRouter, HTTPException, Query

from app.core.crud import get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.analytics import WaterSupplyPlan
from app.services import analytics_service as analytics

router = APIRouter(prefix="/water-supply", tags=["water-supply"])


def _plan_out(p: WaterSupplyPlan) -> dict:
    return {
        "id": p.id,
        "plan_type": p.plan_type,
        "plan_date": p.plan_date,
        "plan_value": float(p.plan_value),
        "remark": p.remark,
        "status": p.status,
        "created_at": p.created_at,
    }


@router.get("/plans")
def list_plans(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    plan_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    q = db.query(WaterSupplyPlan).filter(WaterSupplyPlan.deleted == 0)
    if plan_type:
        q = q.filter(WaterSupplyPlan.plan_type == plan_type)
    if start_date:
        q = q.filter(WaterSupplyPlan.plan_date >= start_date)
    if end_date:
        q = q.filter(WaterSupplyPlan.plan_date <= end_date)
    q = q.order_by(WaterSupplyPlan.plan_date.desc(), WaterSupplyPlan.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_plan_out(i) for i in result["items"]]
    return ok(result)


@router.post("/plans")
def create_plan(
    body: dict,
    db: DbSession,
    _: CurrentUser,
    _perm: None = Depends(require_perm("water:plan:create")),
):
    plan_type = body.get("plan_type") or "day"
    plan_date = body.get("plan_date")
    plan_value = body.get("plan_value")
    if not plan_date or plan_value is None:
        raise HTTPException(status_code=400, detail="计划日期和计划值必填")
    if isinstance(plan_date, str):
        plan_date = date.fromisoformat(plan_date[:10])
    # 日计划一日只能有一条：同类型+同日期已存在则禁止重复创建
    if plan_type == "day":
        exists = (
            db.query(WaterSupplyPlan)
            .filter(
                WaterSupplyPlan.deleted == 0,
                WaterSupplyPlan.plan_type == "day",
                WaterSupplyPlan.plan_date == plan_date,
            )
            .first()
        )
        if exists:
            raise HTTPException(status_code=400, detail=f"{plan_date.isoformat()} 已存在日计划，请编辑已有记录")
    obj = WaterSupplyPlan(
        plan_type=plan_type,
        plan_date=plan_date,
        plan_value=Decimal(str(plan_value)),
        remark=body.get("remark"),
        status=1,
        deleted=0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_plan_out(obj))


@router.put("/plans/{item_id}")
def update_plan(item_id: int, body: dict, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("water:plan:update")),
):
    obj = get_or_404(db, WaterSupplyPlan, item_id)
    new_type = obj.plan_type
    new_date = obj.plan_date
    if "plan_type" in body and body["plan_type"] is not None:
        new_type = body["plan_type"]
        obj.plan_type = body["plan_type"]
    if "plan_date" in body and body["plan_date"] is not None:
        pd = body["plan_date"]
        new_date = date.fromisoformat(pd[:10]) if isinstance(pd, str) else pd
        obj.plan_date = new_date
    # 日计划一日只能有一条：改日期后不能与已有日计划撞日
    if new_type == "day":
        conflict = (
            db.query(WaterSupplyPlan)
            .filter(
                WaterSupplyPlan.deleted == 0,
                WaterSupplyPlan.plan_type == "day",
                WaterSupplyPlan.plan_date == new_date,
                WaterSupplyPlan.id != item_id,
            )
            .first()
        )
        if conflict:
            raise HTTPException(status_code=400, detail=f"{new_date.isoformat()} 已存在日计划，无法修改到该日期")
    if "plan_value" in body and body["plan_value"] is not None:
        obj.plan_value = Decimal(str(body["plan_value"]))
    if "remark" in body:
        obj.remark = body["remark"]
    if "status" in body and body["status"] is not None:
        obj.status = body["status"]
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_plan_out(obj))


@router.delete("/plans/{item_id}")
def delete_plan(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("water:plan:delete")),
):
    obj = get_or_404(db, WaterSupplyPlan, item_id)
    soft_delete(db, obj)
    return ok(True)


@router.get("/stats")
def stats(
    db: DbSession,
    _: CurrentUser,
    start_date: date | None = None,
    end_date: date | None = None,
    dimension: str = Query("time", description="time|unit"),
):
    end = end_date or date.today()
    start = start_date or (end - timedelta(days=6))
    if start > end:
        raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期")

    if dimension == "unit":
        # 用流量测点作为“机组”维度
        by_tag = analytics.water_actual_by_tag(db, end)
        labels = list(by_tag.keys())
        values = [by_tag[k] for k in labels]
        return ok(
            {
                "dimension": "unit",
                "date": end.isoformat(),
                "labels": labels,
                "values": values,
                "unit": "m³",
                "chart": "bar",
                "title": f"{end.isoformat()} 按测点供水贡献",
            }
        )

    actual = analytics.water_actual_by_day(db, start, end)
    plans = (
        db.query(WaterSupplyPlan)
        .filter(
            WaterSupplyPlan.deleted == 0,
            WaterSupplyPlan.plan_type == "day",
            WaterSupplyPlan.plan_date >= start,
            WaterSupplyPlan.plan_date <= end,
        )
        .all()
    )
    plan_map = {p.plan_date.isoformat(): float(p.plan_value) for p in plans}
    labels = []
    actual_series = []
    plan_series = []
    cur = start
    while cur <= end:
        k = cur.isoformat()
        labels.append(k)
        actual_series.append(actual.get(k, 0.0))
        plan_series.append(plan_map.get(k))
        cur += timedelta(days=1)

    total_actual = sum(actual_series)
    total_plan = sum(v for v in plan_series if v is not None)
    days = (end - start).days + 1
    # 完成率按实际/计划原值计算，不封顶：超计划时大于 100%，缺口时小于 100%
    rate = round(total_actual / total_plan * 100, 1) if total_plan else None
    gap = round(total_actual - total_plan, 2)
    peak = max(actual_series) if actual_series else 0.0
    peak_idx = actual_series.index(peak) if actual_series else -1
    return ok(
        {
            "dimension": "time",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "labels": labels,
            "actual": actual_series,
            "plan": plan_series,
            "unit": "m³",
            "summary": {
                "actual_total": round(total_actual, 2),
                "plan_total": round(total_plan, 2) if total_plan else None,
                "achievement_rate": rate,
                "actual_plan_gap": gap,
                "daily_avg": round(total_actual / days, 2),
                "peak_day_value": round(peak, 2),
                "peak_day_date": labels[peak_idx] if peak_idx >= 0 else None,
            },
            "title": "供水统计（按日）",
        }
    )


@router.get("/compare")
def compare(
    db: DbSession,
    _: CurrentUser,
    mode: str = Query("unit", description="unit|period"),
    compare_date: date | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    tags: str | None = Query(None, description="逗号分隔测点名，unit 模式"),
):
    if mode == "period":
        end = end_date or date.today()
        start = start_date or (end - timedelta(days=6))
        actual = analytics.water_actual_by_day(db, start, end)
        labels = []
        values = []
        cur = start
        while cur <= end:
            k = cur.isoformat()
            labels.append(k)
            values.append(actual.get(k, 0.0))
            cur += timedelta(days=1)
        return ok(
            {
                "mode": "period",
                "labels": labels,
                "values": values,
                "unit": "m³",
                "title": "按时段供水对比",
            }
        )

    day = compare_date or date.today()
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()] or None
    by_tag = analytics.water_actual_by_tag(db, day, tags=tag_list)
    return ok(
        {
            "mode": "unit",
            "date": day.isoformat(),
            "labels": list(by_tag.keys()),
            "values": list(by_tag.values()),
            "unit": "m³",
            "title": f"{day.isoformat()} 按测点/机组对比",
        }
    )
