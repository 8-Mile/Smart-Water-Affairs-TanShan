from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.alarm_engine.engine import create_repair_from_alarm
from app.alarm_engine.ws_hub import alarm_ws_hub
from app.core.crud import ensure_unique, get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.alarm import Alarm, AlarmActionLog, AlarmRule, AlarmType
from app.models.repair import RepairOrder
from app.models.equipment import Equipment
from app.models.user import User
from app.schemas.alarm import (
    AlarmActionLogOut,
    AlarmOut,
    AlarmRuleCreate,
    AlarmRuleOut,
    AlarmRuleUpdate,
    AlarmStatsOut,
    AlarmTypeCreate,
    AlarmTypeOut,
    AlarmTypeUpdate,
)

router = APIRouter(prefix="/alarms", tags=["alarms"])

# 实时告警口径：未闭环状态（未处理 / 处理中 / 待验收）
ACTIVE_STATUSES = ("pending", "processing", "pending_accept")

# ---- H3 轻量 TTL 缓存：stats / trend-24h 被 10s 轮询高频调用，聚合全表开销大 ----
# 缓存 5s：前端列表 10s 轮询期间最多复用一次计算；所有写端点成功后失效，保证操作反馈即时
import time as _time  # noqa: E402  模块级缓存计时用

_STATS_CACHE: dict[str, tuple[float, object]] = {}
_STATS_TTL = 5.0


def _cache_get(key: str):
    hit = _STATS_CACHE.get(key)
    if hit and _time.monotonic() - hit[0] < _STATS_TTL:
        return hit[1]
    return None


def _cache_set(key: str, value: object) -> None:
    _STATS_CACHE[key] = (_time.monotonic(), value)


def _invalidate_stats_cache() -> None:
    _STATS_CACHE.clear()


def _apply(obj, data: dict) -> None:
    for k, v in data.items():
        setattr(obj, k, v)


def _log(
    db: Session,
    alarm_id: int,
    action: str,
    user: User | None = None,
    detail: str | None = None,
) -> None:
    db.add(
        AlarmActionLog(
            alarm_id=alarm_id,
            action=action,
            operator_id=user.id if user else None,
            operator_name=user.display_name if user else None,
            detail=detail,
        )
    )


def _rule_out(db: Session, rule: AlarmRule) -> dict:
    data = AlarmRuleOut.model_validate(rule).model_dump()
    eq = (
        db.query(Equipment)
        .filter(Equipment.id == rule.equipment_id, Equipment.deleted == 0)
        .first()
    )
    data["equipment_name"] = eq.name if eq else None
    return data


def _alarm_out(a: Alarm, order_no: str | None = None) -> dict:
    data = AlarmOut.model_validate(a).model_dump()
    end = a.end_time or datetime.now()
    data["duration_sec"] = int((end - a.alarm_time).total_seconds()) if a.alarm_time else None
    # 关联工单编号：由列表/详情端点批量解析后传入
    data["repair_order_no"] = order_no
    return data


# ---- types ----
@router.get("/types")
def list_types(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    keyword: str | None = None,
):
    q = db.query(AlarmType).filter(AlarmType.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter((AlarmType.name.like(like)) | (AlarmType.code.like(like)))
    q = q.order_by(AlarmType.id.asc())
    result = paginate(q, page, page_size)
    result["items"] = [AlarmTypeOut.model_validate(i).model_dump() for i in result["items"]]
    return ok(result)


@router.get("/types/options")
def type_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(AlarmType)
        .filter(AlarmType.deleted == 0, AlarmType.status == 1)
        .order_by(AlarmType.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name, "code": r.code} for r in rows])


@router.post("/types")
def create_type(body: AlarmTypeCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("alarm:type:create")),
):
    ensure_unique(db, AlarmType, "code", body.code, message="类型编码已存在")
    obj = AlarmType(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(AlarmTypeOut.model_validate(obj).model_dump())


@router.put("/types/{item_id}")
def update_type(item_id: int, body: AlarmTypeUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("alarm:type:update")),
):
    obj = get_or_404(db, AlarmType, item_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        ensure_unique(db, AlarmType, "code", data["code"], exclude_id=item_id, message="类型编码已存在")
    _apply(obj, data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(AlarmTypeOut.model_validate(obj).model_dump())


@router.delete("/types/{item_id}")
def delete_type(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("alarm:type:delete")),
):
    obj = get_or_404(db, AlarmType, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- rules ----
@router.get("/rules")
def list_rules(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    equipment_id: int | None = None,
):
    q = db.query(AlarmRule).filter(AlarmRule.deleted == 0)
    if keyword:
        q = q.filter(AlarmRule.name.like(f"%{keyword}%"))
    if equipment_id is not None:
        # 包含该设备及其子设备的告警规则
        child_ids = [
            r[0]
            for r in db.query(Equipment.id).filter(
                Equipment.parent_id == equipment_id, Equipment.deleted == 0
            ).all()
        ]
        eq_ids = [equipment_id] + child_ids
        q = q.filter(AlarmRule.equipment_id.in_(eq_ids))
    q = q.order_by(AlarmRule.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [_rule_out(db, i) for i in result["items"]]
    return ok(result)


@router.post("/rules")
def create_rule(body: AlarmRuleCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("alarm:rule:create")),
):
    eq = get_or_404(db, Equipment, body.equipment_id)
    _ = eq
    obj = AlarmRule(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_rule_out(db, obj))


@router.put("/rules/{item_id}")
def update_rule(item_id: int, body: AlarmRuleUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("alarm:rule:update")),
):
    obj = get_or_404(db, AlarmRule, item_id)
    data = body.model_dump(exclude_unset=True)
    if "equipment_id" in data:
        get_or_404(db, Equipment, data["equipment_id"])
    _apply(obj, data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_rule_out(db, obj))


@router.post("/rules/{item_id}/copy")
def copy_rule(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("alarm:rule:create")),
):
    src = get_or_404(db, AlarmRule, item_id)
    obj = AlarmRule(
        name=f"{src.name}-副本",
        equipment_id=src.equipment_id,
        point_refs=src.point_refs,
        alarm_type_code=src.alarm_type_code,
        alarm_level=src.alarm_level,
        trigger_logic=src.trigger_logic,
        compare_op=src.compare_op,
        threshold=src.threshold,
        delay_sec=src.delay_sec,
        debounce_sec=src.debounce_sec,
        suppress_push_sec=src.suppress_push_sec,
        enabled=0,
        remark=src.remark,
        status=1,
        deleted=0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_rule_out(db, obj))


@router.delete("/rules/{item_id}")
def delete_rule(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("alarm:rule:delete")),
):
    obj = get_or_404(db, AlarmRule, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- alarm list ----
@router.get("")
def list_alarms(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    realtime: bool = Query(False, description="仅未闭环"),
    unassigned_only: bool = Query(False, description="仅未生成关联工单的告警"),
    assigned_only: bool = Query(False, description="仅已派工（有关联工单）的告警"),
    mine: bool = Query(False, description="仅指派给我处理的告警（操作员默认视角）"),
    alarm_status: str | None = None,
    alarm_level: int | None = None,
    alarm_type_code: str | None = None,
    equipment_id: int | None = None,
    keyword: str | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
):
    q = db.query(Alarm).filter(Alarm.deleted == 0)
    if realtime:
        q = q.filter(Alarm.alarm_status.in_(ACTIVE_STATUSES))
    if unassigned_only:
        # 实时页「待指派」卡：未闭环且未生成关联工单（尚未派工）
        q = q.filter(Alarm.repair_id.is_(None))
    if assigned_only:
        # 实时页「未处理/处理中」卡（互斥口径）：仅统计已派工部分
        q = q.filter(Alarm.repair_id.isnot(None))
    if mine:
        # 操作员「指派给我」视角：仅看本人被指派处理的告警
        q = q.filter(Alarm.assignee_id == current_user.id)
    if alarm_status:
        # 支持逗号分隔多状态（历史告警页用 closed,rejected 筛选已完成）
        statuses = [s.strip() for s in alarm_status.split(",") if s.strip()]
        if len(statuses) > 1:
            q = q.filter(Alarm.alarm_status.in_(statuses))
        else:
            q = q.filter(Alarm.alarm_status == statuses[0])
    if alarm_level is not None:
        q = q.filter(Alarm.alarm_level == alarm_level)
    if alarm_type_code:
        q = q.filter(Alarm.alarm_type_code == alarm_type_code)
    if equipment_id is not None:
        # 包含该设备及其子设备的告警
        child_ids = [
            r[0]
            for r in db.query(Equipment.id).filter(
                Equipment.parent_id == equipment_id, Equipment.deleted == 0
            ).all()
        ]
        eq_ids = [equipment_id] + child_ids
        q = q.filter(Alarm.equipment_id.in_(eq_ids))
    if start_time:
        q = q.filter(Alarm.alarm_time >= start_time)
    if end_time:
        q = q.filter(Alarm.alarm_time < end_time)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (Alarm.rule_name.like(like))
            | (Alarm.equipment_name.like(like))
            | (Alarm.equipment_code.like(like))
        )
    if realtime:
        # 实时列表：一类告警置顶，同级按最近状态流转时间倒序（新告警、处理完待验收的均浮在最前）
        q = q.order_by(Alarm.alarm_level.asc(), Alarm.updated_at.desc(), Alarm.id.desc())
    else:
        # 历史列表：一类告警置顶，同级按告警发生时间倒序
        q = q.order_by(Alarm.alarm_level.asc(), Alarm.alarm_time.desc(), Alarm.id.desc())
    result = paginate(q, page, page_size)
    # 批量解析关联工单编号，避免逐条查询
    repair_ids = {i.repair_id for i in result["items"] if i.repair_id}
    order_map: dict[int, str] = {}
    if repair_ids:
        from app.models.repair import RepairOrder

        rows = (
            db.query(RepairOrder.id, RepairOrder.order_no)
            .filter(RepairOrder.id.in_(repair_ids), RepairOrder.deleted == 0)
            .all()
        )
        order_map = {rid: no for rid, no in rows}
    result["items"] = [
        _alarm_out(i, order_map.get(i.repair_id) if i.repair_id else None)
        for i in result["items"]
    ]
    return ok(result)


@router.get("/counts")
def alarm_counts(
    db: DbSession,
    _: CurrentUser,
    equipment_ids: str | None = Query(None, description="逗号分隔的设备ID列表，为空则返回全部"),
):
    """批量查询设备未闭环告警计数 + 最高告警等级。

    返回:
      counts: { equipment_id: count }          设备自身未闭环告警数
      highest_levels: { equipment_id: level }  设备自身最高告警等级（1紧急 2重要 3一般）
    仅统计设备自身（不含子设备），顶级设备需在前端汇总 children。
    """
    base_q = db.query(Alarm).filter(
        Alarm.deleted == 0,
        Alarm.alarm_status.in_(ACTIVE_STATUSES),
    )
    if equipment_ids:
        ids = [int(x) for x in equipment_ids.split(",") if x.strip().isdigit()]
        if ids:
            base_q = base_q.filter(Alarm.equipment_id.in_(ids))

    # 计数
    count_rows = (
        base_q.with_entities(Alarm.equipment_id, func.count(Alarm.id))
        .group_by(Alarm.equipment_id)
        .all()
    )
    counts = {int(eid): int(cnt) for eid, cnt in count_rows}

    # 最高等级（alarm_level 数值越小等级越高：1 > 2 > 3）
    level_rows = (
        base_q.with_entities(Alarm.equipment_id, func.min(Alarm.alarm_level))
        .group_by(Alarm.equipment_id)
        .all()
    )
    highest_levels = {int(eid): int(lv) for eid, lv in level_rows}

    return ok({"counts": counts, "highest_levels": highest_levels})


@router.get("/stats")
def alarm_stats(db: DbSession, current_user: CurrentUser, mine: bool = Query(False)):
    """告警统计（实时页 KPI 卡/图表 10s 轮询数据源，带 5s TTL 缓存）。

    mine=true 时收窄为「指派给本人」的告警（操作员默认视角），缓存按用户隔离。
    """
    cache_key = f"stats:mine:{current_user.id}" if mine else "stats"
    cached = _cache_get(cache_key)
    if cached is not None:
        return ok(cached)
    # 基础过滤条件：mine 时追加 assignee 收窄，供下述所有聚合并用
    flt: list = [Alarm.deleted == 0]
    if mine:
        flt.append(Alarm.assignee_id == current_user.id)

    def count_status(s: str) -> int:
        return (
            db.query(func.count(Alarm.id))
            .filter(*flt, Alarm.alarm_status == s)
            .scalar()
            or 0
        )

    by_type = (
        db.query(Alarm.alarm_type_name, func.count(Alarm.id))
        .filter(*flt)
        .group_by(Alarm.alarm_type_name)
        .all()
    )
    by_level = (
        db.query(Alarm.alarm_level, func.count(Alarm.id))
        .filter(*flt)
        .group_by(Alarm.alarm_level)
        .all()
    )
    top_eq = (
        db.query(Alarm.equipment_name, func.count(Alarm.id).label("cnt"))
        .filter(*flt)
        .group_by(Alarm.equipment_name)
        .order_by(func.count(Alarm.id).desc())
        .limit(10)
        .all()
    )

    # 待指派：未闭环且未生成关联工单（实时页「待指派」卡口径）
    unassigned = (
        db.query(func.count(Alarm.id))
        .filter(
            *flt,
            Alarm.alarm_status.in_(ACTIVE_STATUSES),
            Alarm.repair_id.is_(None),
        )
        .scalar()
        or 0
    )

    # 互斥划分：未处理/处理中仅统计已派工（有关联工单）部分，无工单的归入待指派，
    # 保证 未处理 + 处理中 + 待指派 + 待验收 = 未闭环总数，四卡互斥完备
    def count_assigned(status: str) -> int:
        return (
            db.query(func.count(Alarm.id))
            .filter(
                *flt,
                Alarm.alarm_status == status,
                Alarm.repair_id.isnot(None),
            )
            .scalar()
            or 0
        )

    # 近 14 天新增告警按「天」分桶，并按记录的「当前状态」归属；
    # 前 7 天作为环比基期，后 7 天为展示序列（KPI 卡迷你趋势图 + 环比徽标）。
    # 采用 14 天窗口而非 24h：告警数据跨越约两周，24h 窗口内多为空桶，趋势图无起伏。
    # active=未闭环总数（未处理+处理中+待验收），unassigned=其中未生成关联工单的部分。
    trend_keys = ("pending", "processing", "pending_accept", "active", "all", "rejected", "unassigned")
    days = 14
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    base = today_start - timedelta(days=days - 1)
    trend_rows = (
        db.query(Alarm.alarm_time, Alarm.alarm_status, Alarm.repair_id)
        .filter(*flt, Alarm.alarm_time >= base)
        .all()
    )
    cur_buckets: dict[str, list[int]] = {k: [0] * days for k in trend_keys}
    prev_sum: dict[str, int] = {k: 0 for k in trend_keys}
    cur_sum: dict[str, int] = {k: 0 for k in trend_keys}

    def bump(k: str, idx: int) -> None:
        cur_buckets[k][idx] += 1
        if idx >= days - 7:
            cur_sum[k] += 1
        else:
            prev_sum[k] += 1

    for t, st, rid in trend_rows:
        if t is None:
            continue
        idx = int((t - base).total_seconds() // 86400)
        if not 0 <= idx < days:
            continue
        bump("all", idx)
        if st in trend_keys:
            bump(st, idx)
        if st in ACTIVE_STATUSES:
            bump("active", idx)
            if rid is None:
                bump("unassigned", idx)
    status_trend = [
        {
            "key": k,
            "series": cur_buckets[k],
            "mom_pct": round((cur_sum[k] - prev_sum[k]) / prev_sum[k] * 100, 1)
            if prev_sum[k]
            else None,
        }
        for k in trend_keys
    ]

    # 分等级近 14 天每日趋势（历史告警 KPI 卡迷你柱状图）
    lv_rows = (
        db.query(Alarm.alarm_time, Alarm.alarm_level)
        .filter(*flt, Alarm.alarm_time >= base)
        .all()
    )
    lv_buckets: dict[int, list[int]] = {1: [0] * days, 2: [0] * days, 3: [0] * days}
    for t, lv in lv_rows:
        if t is None or lv not in lv_buckets:
            continue
        idx = int((t - base).total_seconds() // 86400)
        if 0 <= idx < days:
            lv_buckets[lv][idx] += 1
    level_trend = [{"level": lv, "series": lv_buckets[lv]} for lv in (1, 2, 3)]

    stats = AlarmStatsOut(
        pending=count_status("pending"),
        processing=count_status("processing"),
        pending_accept=count_status("pending_accept"),
        closed=count_status("closed"),
        rejected=count_status("rejected"),
        unassigned=unassigned,
        pending_assigned=count_assigned("pending"),
        processing_assigned=count_assigned("processing"),
        by_type=[{"name": n or "未知", "count": c} for n, c in by_type],
        by_level=[{"level": lv, "count": c} for lv, c in by_level],
        top_equipment=[{"name": n or "未知", "count": c} for n, c in top_eq],
        status_trend=status_trend,
        level_trend=level_trend,
    )
    payload = stats.model_dump()
    _cache_set(cache_key, payload)
    return ok(payload)


@router.get("/trend-24h")
def alarm_trend_24h(db: DbSession, _: CurrentUser):
    """近24小时分等级告警趋势（SQL 按小时分桶，带 5s TTL 缓存）。"""
    cached = _cache_get("trend24h")
    if cached is not None:
        return ok(cached)
    now = datetime.now()
    start = (now - timedelta(hours=23)).replace(minute=0, second=0, microsecond=0)
    # M3：由全量拉行到 Python 分桶改为 SQL group_by 聚合，数据量增长时开销恒定
    rows = (
        db.query(
            func.strftime("%Y-%m-%d %H:00:00", Alarm.alarm_time).label("hour"),
            Alarm.alarm_level,
            func.count(Alarm.id),
        )
        .filter(Alarm.deleted == 0, Alarm.alarm_time >= start)
        .group_by("hour", Alarm.alarm_level)
        .all()
    )
    labels = [(start + timedelta(hours=i)).strftime("%H:00") for i in range(24)]
    buckets: dict[int, list[int]] = {1: [0] * 24, 2: [0] * 24, 3: [0] * 24}
    for hour_key, lv, cnt in rows:
        if lv not in buckets or hour_key is None:
            continue
        t = datetime.strptime(hour_key, "%Y-%m-%d %H:%M:%S")
        idx = int((t - start).total_seconds() // 3600)
        if 0 <= idx < 24:
            buckets[lv][idx] += cnt
    names = {1: "一类", 2: "二类", 3: "三类"}
    colors = {1: "#ef4444", 2: "#f59e0b", 3: "#3b82f6"}
    payload = {
        "labels": labels,
        "series": [
            {"name": names[lv], "level": lv, "color": colors[lv], "data": buckets[lv]}
            for lv in (1, 2, 3)
        ],
        "total": sum(sum(v) for v in buckets.values()),
    }
    _cache_set("trend24h", payload)
    return ok(payload)


@router.get("/history-summary")
def alarm_history_summary(db: DbSession, _: CurrentUser):
    """历史告警KPI汇总：分等级总量 + 近30天环比 + 处理率。

    口径与历史告警列表一致：仅统计已结束状态（closed/rejected/reopened），
    保证卡片数字与页面表格总数可对账。
    """
    history_statuses = ("closed", "rejected", "reopened")
    now = datetime.now()
    cur_start = now - timedelta(days=30)
    prev_start = now - timedelta(days=60)

    def level_count(lv: int, start: datetime | None = None, end: datetime | None = None) -> int:
        q = db.query(func.count(Alarm.id)).filter(
            Alarm.deleted == 0,
            Alarm.alarm_level == lv,
            Alarm.alarm_status.in_(history_statuses),
        )
        if start:
            q = q.filter(Alarm.alarm_time >= start)
        if end:
            q = q.filter(Alarm.alarm_time < end)
        return q.scalar() or 0

    levels = []
    for lv, key in ((1, "severe"), (2, "important"), (3, "general")):
        cur = level_count(lv, cur_start)
        prev = level_count(lv, prev_start, cur_start)
        levels.append(
            {
                "level": lv,
                "key": key,
                "total": level_count(lv),
                "last30": cur,
                "prev30": prev,
                "mom_pct": round((cur - prev) / prev * 100) if prev else None,
            }
        )

    total_hist = (
        db.query(func.count(Alarm.id))
        .filter(Alarm.deleted == 0, Alarm.alarm_status.in_(history_statuses))
        .scalar()
        or 0
    )
    processed = (
        db.query(func.count(Alarm.id))
        .filter(Alarm.deleted == 0, Alarm.alarm_status.in_(["closed", "rejected"]))
        .scalar()
        or 0
    )
    rejected = (
        db.query(func.count(Alarm.id))
        .filter(Alarm.deleted == 0, Alarm.alarm_status == "rejected")
        .scalar()
        or 0
    )
    rate = round(processed / total_hist * 100, 1) if total_hist else 0.0
    return ok(
        {"levels": levels, "processed": processed, "rejected": rejected, "total": total_hist, "process_rate": rate}
    )


@router.get("/history-stats")
def alarm_history_stats(
    db: DbSession,
    _: CurrentUser,
    start_date: str = Query(..., description="起始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
):
    """按日期范围统计告警：总数 / 级别分布 / 处置率 / TOP 告警类型。

    过滤字段为 alarm_time（告警发生时间），区间为 [start_date 00:00:00, end_date 23:59:59]。
    处置口径：closed / rejected 视为已处理。
    """
    try:
        s = datetime.strptime(start_date, "%Y-%m-%d")
        e = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")

    base = db.query(Alarm).filter(
        Alarm.deleted == 0,
        Alarm.alarm_time >= s,
        Alarm.alarm_time < e,
    )
    total = base.count()

    level_rows = (
        base.with_entities(Alarm.alarm_level, func.count(Alarm.id))
        .group_by(Alarm.alarm_level)
        .all()
    )
    level_map = {1: "紧急", 2: "重要", 3: "一般", 4: "提示"}
    by_level = [
        {"level": lv, "name": level_map.get(lv, f"级别{lv}"), "count": int(cnt)}
        for lv, cnt in level_rows
    ]
    by_level.sort(key=lambda x: x["level"])

    processed = (
        base.filter(Alarm.alarm_status.in_(["closed", "rejected"])).count()
    )
    process_rate = round(processed / total * 100, 1) if total else 0.0

    top_types = (
        base.with_entities(Alarm.alarm_type_name, func.count(Alarm.id).label("cnt"))
        .group_by(Alarm.alarm_type_name)
        .order_by(func.count(Alarm.id).desc())
        .limit(3)
        .all()
    )
    top_types = [
        {"name": name or "未分类", "count": int(cnt)} for name, cnt in top_types
    ]

    return ok(
        {
            "total": total,
            "by_level": by_level,
            "processed": processed,
            "process_rate": process_rate,
            "top_types": top_types,
        }
    )


@router.get("/{alarm_id}")
def get_alarm(alarm_id: int, db: DbSession, _: CurrentUser):
    a = get_or_404(db, Alarm, alarm_id)
    order_no = None
    if a.repair_id:
        from app.models.repair import RepairOrder

        order = (
            db.query(RepairOrder.order_no)
            .filter(RepairOrder.id == a.repair_id, RepairOrder.deleted == 0)
            .first()
        )
        order_no = order[0] if order else None
    data = _alarm_out(a, order_no)
    logs = (
        db.query(AlarmActionLog)
        .filter(AlarmActionLog.alarm_id == alarm_id)
        .order_by(AlarmActionLog.id.asc())
        .all()
    )
    data["logs"] = [
        AlarmActionLogOut(
            id=l.id,
            action=l.action,
            operator_name=l.operator_name,
            detail=l.detail,
            created_at=l.created_at,
        ).model_dump()
        for l in logs
    ]
    return ok(data)


@router.post("/{alarm_id}/repair-handle")
def repair_handle(alarm_id: int, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("alarm:dispatch")),
):
    """维修处理：管理员将告警一键转为维修工单（告警侧唯一处理入口）。

    生成待派单工单并绑定告警，后续派单/完工/验收全部在维修工单内完成，
    工单状态由 sync_alarm_from_repair 自动回写告警，验收通过告警闭环进历史。
    已驳回（rejected）告警允许重新发起维修处理（生成新工单）。
    """
    a = get_or_404(db, Alarm, alarm_id)
    if a.repair_id:
        raise HTTPException(status_code=400, detail="已生成维修工单，请通过关联工单操作")
    if a.alarm_status not in ("pending", "processing", "rejected"):
        raise HTTPException(status_code=400, detail="当前状态不可维修处理")

    try:
        order = create_repair_from_alarm(
            db,
            a,
            applicant_id=current_user.id,
            applicant_name=current_user.display_name,
        )
    except ValueError as e:
        # 设备级互斥：同设备已有未归档工单，禁止再转工单
        raise HTTPException(status_code=400, detail=str(e)) from e
    # 告警进入处理流程，处理人即触发维修处理的管理员；
    # 驳回重开的告警置 reopened 吸收态：留在历史告警域跟踪处理，不回实时告警
    a.alarm_status = "reopened" if a.alarm_status == "rejected" else "processing"
    a.handler_id = current_user.id
    a.handler_name = current_user.display_name
    a.handle_time = datetime.now()
    # 驳回重开的告警带有驳回时刻的 end_time，重新激活必须清空
    a.end_time = None
    db.add(a)
    _log(db, a.id, "repair_handle", current_user, detail=f"生成工单 {order.order_no}")
    db.commit()
    db.refresh(a)
    _invalidate_stats_cache()  # 状态/派工已变，清 KPI 缓存保证前端立即可见
    data = _alarm_out(a)
    data["repair_order_no"] = order.order_no
    alarm_ws_hub.broadcast_threadsafe("alarm.updated", data)
    return ok(data)
