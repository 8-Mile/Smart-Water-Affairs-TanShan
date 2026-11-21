"""供水/能耗统计服务。"""

from __future__ import annotations

import bisect
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.analytics import ElectricityPrice, EnergyRecord
from app.models.equipment import Equipment
from app.models.scada import ScadaPoint, ScadaTagData

# —— 功率推流估算常量（现场 4 个流量测点无历史，供水量改由有功功率反算）——
# 依据泵站水泵相似定律：Q = η·P / (ρ·g·H)
WATER_DENSITY_KG_M3 = 1000.0  # ρ：水体密度 kg/m³
GRAVITY_M_S2 = 9.81  # g：重力加速度 m/s²
PUMP_EFFICIENCY = 0.85  # η：机组综合效率（水泵 + 电机 + 传动）
KW_TO_WATT = 1000.0  # 有功功率按 kW 存储，公式需换算为 W
MIN_HEAD_M = 0.1  # 扬程下限（m），避免 H→0 时推算流量发散
STOP_POWER_RATIO = 0.05  # P ≤ 额定功率的 5% 视为停机，流量记 0
FOREPOOL_LEVEL_TAG = "FJ前池水位"
BACKPOOL_LEVEL_TAG = "FJ后池水位"


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _local_day_expr(ts_col):
    """SQLite 端按本地自然日分组的时间表达式（ts 为毫秒 epoch）。

    原实现用 datetime.fromtimestamp 取本地日期；这里用 strftime + 本地时区偏移补偿，
    保证 00:00–08:00 等时段仍归属正确的本地日期。
    """
    off = datetime.now().astimezone().utcoffset() or timedelta(0)
    return func.strftime(
        "%Y-%m-%d",
        ts_col / 1000,
        "unixepoch",
        f"{int(off.total_seconds())} seconds",
    )


def _hour_token(token: str) -> Optional[int]:
    """解析 "8" / "08" / "08:00" 这类小时写法，返回 0-23 的小时。"""
    token = token.strip()
    if not token:
        return None
    head = token.split(":")[0]
    if head.isdigit():
        h = int(head)
        if 0 <= h <= 23:
            return h
    return None


def parse_hours(raw: str | None) -> set[int]:
    """解析时段配置，兼容两种写法：

    - 逗号分隔的小时整数：`"8,9,10,18,19,20"`
    - 区间写法（支持跨零点）：`"08:00-11:00,18:00-21:00"`、`"23:00-07:00"`
    """
    if not raw:
        return set()
    out: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            sh = _hour_token(start_s)
            eh = _hour_token(end_s)
            if sh is None or eh is None:
                continue
            h = sh
            while h != eh:
                out.add(h)
                h = (h + 1) % 24
            continue
        h = _hour_token(part)
        if h is not None:
            out.add(h)
    return out


def flow_points(
    db: Session,
    station: str | None = None,
) -> list[ScadaPoint]:
    """按泵站过滤流量测点，避免多站直接相加。

    station 支持：
    - 泵站名/前缀匹配（如 "大张庄"、"二号泵站"）
    - 点位 node_id 匹配（如 "PLC1"、"ns=2;s=PS02"）
    默认不过滤，但调用方在求和前应显式指定 station。
    """
    q = db.query(ScadaPoint).filter(
        ScadaPoint.deleted == 0,
        ScadaPoint.status == 1,
        (
            ScadaPoint.tag_name.ilike("%flow%")
            | ScadaPoint.tag_name.ilike("%流量%")
            | ScadaPoint.description.ilike("%流量%")
        ),
    )
    if station:
        like = f"%{station}%"
        q = q.filter(
            ScadaPoint.tag_name.ilike(like)
            | ScadaPoint.description.ilike(like)
            | ScadaPoint.node_id.ilike(like)
        )
    return q.all()


def flow_station_names(db: Session) -> list[str]:
    """返回所有流量测点归属的泵站名（去重），供前端按站筛选。"""
    rows = (
        db.query(ScadaPoint.node_id)
        .filter(
            ScadaPoint.deleted == 0,
            ScadaPoint.status == 1,
            (
                ScadaPoint.tag_name.ilike("%flow%")
                | ScadaPoint.tag_name.ilike("%流量%")
                | ScadaPoint.description.ilike("%流量%")
            ),
        )
        .distinct()
        .all()
    )
    # 从 node_id 提取可读站名：如 "ns=2;s=PS02.PUMP01.Flow" → "PS02"
    out = set()
    for (node_id,) in rows:
        if not node_id:
            continue
        if ";" in node_id:
            # OPC UA NodeId：ns=2;s=PS02.PUMP01.Flow → PS02
            parts = node_id.split(";")[-1].split(".")
            if parts:
                out.add(parts[0])
        elif ":" in node_id:
            out.add(node_id.split(":")[0])
        else:
            out.add(node_id)
    return sorted(out)


def pump_units(db: Session) -> list[dict[str, Any]]:
    """功率推流所需的机组台账：功率测点 tag / 机组名 / 额定功率 kW。"""
    rows = (
        db.query(Equipment)
        .filter(Equipment.deleted == 0, Equipment.unit_no.isnot(None))
        .order_by(Equipment.unit_no)
        .all()
    )
    return [
        {
            "tag_name": f"M{int(r.unit_no)}电机P",
            "unit_name": r.name or f"{int(r.unit_no)}号机组",
            "rated_power_kw": float(r.rated_power_kw or 0),
        }
        for r in rows
    ]


def _load_series(
    db: Session,
    tags: list[str],
    start_ms: int,
    end_ms: int,
) -> dict[str, list[tuple[int, float]]]:
    """读取若干 tag 的数值时序，按时间升序返回 {tag: [(ts_ms, value)]}。"""
    out: dict[str, list[tuple[int, float]]] = {t: [] for t in tags}
    rows = (
        db.query(ScadaTagData.tag_name, ScadaTagData.ts_ms, ScadaTagData.value_num)
        .filter(
            ScadaTagData.tag_name.in_(tags),
            ScadaTagData.ts_ms >= start_ms,
            ScadaTagData.ts_ms < end_ms,
            ScadaTagData.value_num.isnot(None),
        )
        .order_by(ScadaTagData.ts_ms)
        .all()
    )
    for tag, ts, v in rows:
        out.setdefault(tag, []).append((int(ts), float(v)))
    return out


def _head_series(
    series: dict[str, list[tuple[int, float]]],
) -> list[tuple[int, float]]:
    """扬程时序 H(t) = 后池水位 - 前池水位（m），低于下限按下限计。"""
    fore = series.get(FOREPOOL_LEVEL_TAG) or []
    back = series.get(BACKPOOL_LEVEL_TAG) or []
    if not fore or not back:
        return []
    back_ts = [t for t, _ in back]
    out: list[tuple[int, float]] = []
    for ts, f in fore:
        i = bisect.bisect_left(back_ts, ts)
        cand = [j for j in (i - 1, i) if 0 <= j < len(back_ts)]
        if not cand:
            continue
        j = min(cand, key=lambda k: abs(back_ts[k] - ts))
        out.append((ts, max(back[j][1] - f, MIN_HEAD_M)))
    return out


def _power_flow_by_day(
    db: Session,
    start: date,
    end: date,
) -> dict[str, dict[str, float]]:
    """功率推流：Q_i(t) = η·P_i(t) / (ρ·g·H(t))，按本地自然日梯形积分得供水量 m³/日。

    返回 {日期: {机组名: 供水量 m³}}；无水位或功率历史的日子不出现在结果中。
    """
    units = pump_units(db)
    if not units:
        return {}
    start_ms = _ms(datetime.combine(start, datetime.min.time()))
    end_ms = _ms(datetime.combine(end + timedelta(days=1), datetime.min.time()))
    series = _load_series(
        db,
        [u["tag_name"] for u in units] + [FOREPOOL_LEVEL_TAG, BACKPOOL_LEVEL_TAG],
        start_ms,
        end_ms,
    )
    heads = _head_series(series)
    if not heads:
        return {}
    head_ts = [t for t, _ in heads]
    head_val = [h for _, h in heads]

    def head_at(ts: int) -> float:
        i = bisect.bisect_left(head_ts, ts)
        cand = [j for j in (i - 1, i) if 0 <= j < len(head_ts)]
        if not cand:
            return 0.0
        j = min(cand, key=lambda k: abs(head_ts[k] - ts))
        return head_val[j]

    out: dict[str, dict[str, float]] = defaultdict(dict)
    for u in units:
        points = series.get(u["tag_name"]) or []
        if not points:
            continue
        stop_kw = u["rated_power_kw"] * STOP_POWER_RATIO
        buckets: dict[str, list[tuple[int, float]]] = defaultdict(list)
        for ts, p in points:
            # P 低于停机阈值按 0 计，避免噪声放大成流量
            q = 0.0 if p <= stop_kw else PUMP_EFFICIENCY * (p * KW_TO_WATT) / (
                WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * head_at(ts)
            )
            day_key = datetime.fromtimestamp(ts / 1000).date().isoformat()
            buckets[day_key].append((ts, q))
        for day_key, qs in buckets.items():
            # 梯形法对流量积分（m³/s × s = m³）
            vol = 0.0
            for (t1, q1), (t2, q2) in zip(qs, qs[1:]):
                vol += 0.5 * (q1 + q2) * ((t2 - t1) / 1000.0)
            out[day_key][u["unit_name"]] = round(vol, 2)
    return dict(out)


def energy_kwh_by_hour(
    db: Session,
    start: date,
    end: date,
) -> dict[tuple[str, int], float]:
    """按本地小时对有功功率梯形积分，得到真实的峰/谷/平分段电量。

    返回 {(本地日期, 小时): kWh}；每日合计与 energy_record 的日汇总一致。
    功率采样约 2.6 分钟一个点，梯形片段按中点归属小时，跨小时误差可忽略。
    """
    units = pump_units(db)
    if not units:
        return {}
    start_ms = _ms(datetime.combine(start, datetime.min.time()))
    end_ms = _ms(datetime.combine(end + timedelta(days=1), datetime.min.time()))
    series = _load_series(db, [u["tag_name"] for u in units], start_ms, end_ms)
    out: dict[tuple[str, int], float] = defaultdict(float)
    for u in units:
        points = series.get(u["tag_name"]) or []
        for (t1, p1), (t2, p2) in zip(points, points[1:]):
            kwh = 0.5 * (p1 + p2) * ((t2 - t1) / 1000.0) / 3600.0
            mid = datetime.fromtimestamp((t1 + t2) / 2000.0)  # ms → s 后取本地时间
            out[(mid.date().isoformat(), mid.hour)] += kwh
    return dict(out)


def _water_by_day_from_power(
    db: Session,
    start: date,
    end: date,
) -> dict[str, float]:
    by_unit = _power_flow_by_day(db, start, end)
    result: dict[str, float] = {}
    cur = start
    while cur <= end:
        key = cur.isoformat()
        result[key] = round(sum(by_unit.get(key, {}).values()), 2)
        cur += timedelta(days=1)
    return result


def _flow_to_m3h(value: float, unit: str | None) -> float:
    """把任意单位流量统一换算为 m³/h。

    支持单位（大小写不敏感）：
    - m³/h, m3/h, m³/h, m3/h, CMD, m3/d, m³/d → 直接返回或按日转小时
    - m³/s, m3/s → ×3600
    - L/s, l/s → ×3.6
    - L/min, l/min → ×0.06
    - 其他/空 → 按 m³/h 处理（兼容未配置单位的旧数据）
    """
    if not unit:
        return value
    u = unit.strip().lower().replace("³", "3")
    if u in ("m3/h", "m³/h", "m3h", "m³h"):
        return value
    if u in ("m3/s", "m³/s", "m3s", "m³s"):
        return value * 3600.0
    if u in ("l/s", "l/s", "ls"):
        return value * 3.6
    if u in ("l/min", "lmin"):
        return value * 0.06
    if u in ("m3/d", "m³/d", "cmd", "m3d", "m³d"):
        return value / 24.0
    # 默认按 m³/h
    return value


def _water_by_day_from_flow(
    db: Session,
    start: date,
    end: date,
    station: str | None = None,
) -> dict[str, float]:
    """按流量测点日均值×24 计算供水量，支持按泵站过滤。

    多站场景下必须指定 station，否则会把不同泵站流量直接相加。
    每个测点按自身 unit 自动换算为 m³/h 后再聚合。
    """
    points = flow_points(db, station=station)
    if not points:
        return {}
    # tag → unit 映射，用于后续单位换算
    unit_map = {p.tag_name: p.unit for p in points}
    tags = list(unit_map.keys())
    start_ms = _ms(datetime.combine(start, datetime.min.time()))
    end_ms = _ms(datetime.combine(end + timedelta(days=1), datetime.min.time()))
    rows = (
        db.query(
            _local_day_expr(ScadaTagData.ts_ms).label("d"),
            ScadaTagData.tag_name,
            func.avg(ScadaTagData.value_num).label("avg_v"),
        )
        .filter(
            ScadaTagData.tag_name.in_(tags),
            ScadaTagData.ts_ms >= start_ms,
            ScadaTagData.ts_ms < end_ms,
            ScadaTagData.value_num.isnot(None),
        )
        .group_by("d", ScadaTagData.tag_name)
        .all()
    )
    day_rate: dict[str, float] = defaultdict(float)
    for d, tag, avg_v in rows:
        if d is not None and avg_v is not None:
            # 按测点单位换算为 m³/h 后再累加
            day_rate[d] += _flow_to_m3h(float(avg_v), unit_map.get(tag))

    result: dict[str, float] = {}
    cur = start
    while cur <= end:
        key = cur.isoformat()
        if key in day_rate:
            result[key] = round(day_rate[key] * 24, 2)
        cur += timedelta(days=1)
    return result


def water_actual_by_day(
    db: Session,
    start: date,
    end: date,
    station: str | None = None,
) -> dict[str, float]:
    """按日估算供水量（m³/日）。

    - station 为 None 时：优先按功率推流（机组级），避免多站流量直接相加；
      若机组功率历史缺失，再回退到全部流量测点（兼容单站场景）。
    - station 指定时：只统计该泵站流量测点。
    """
    if station is None:
        # 默认按机组功率推流，保证多站接入后口径仍然正确
        result = _water_by_day_from_power(db, start, end)
        if any(v > 0 for v in result.values()):
            return result
        # 机组功率无历史时，回退到流量测点（单站场景）
        return _water_by_day_from_flow(db, start, end)

    # 指定泵站：按流量测点统计
    return _water_by_day_from_flow(db, start, end, station=station)


def water_actual_by_tag(
    db: Session,
    day: date,
    tags: Optional[list[str]] = None,
    station: str | None = None,
) -> dict[str, float]:
    """按测点/机组给出当日供水量（m³/日）。

    指定 tags 或流量测点有历史时按流量测点；否则回退到功率推流，改用机组名作为 key。
    支持 station 过滤，避免多站测点混在一组对比。
    每个测点按自身 unit 自动换算为 m³/h 后再计算日水量。
    """
    if not tags:
        points = flow_points(db, station=station)
        tags = [p.tag_name for p in points] if points else ["PLC1.Flow", "PLC2.Flow"]
    # 查询 tags 对应的 unit，用于单位换算
    unit_map: dict[str, str | None] = {}
    if tags:
        for p in (
            db.query(ScadaPoint)
            .filter(ScadaPoint.tag_name.in_(tags), ScadaPoint.deleted == 0)
            .all()
        ):
            unit_map[p.tag_name] = p.unit
    start_ms = _ms(datetime.combine(day, datetime.min.time()))
    end_ms = _ms(datetime.combine(day + timedelta(days=1), datetime.min.time()))
    rows = (
        db.query(
            ScadaTagData.tag_name,
            func.avg(ScadaTagData.value_num).label("avg_v"),
        )
        .filter(
            ScadaTagData.tag_name.in_(tags),
            ScadaTagData.ts_ms >= start_ms,
            ScadaTagData.ts_ms < end_ms,
            ScadaTagData.value_num.isnot(None),
        )
        .group_by(ScadaTagData.tag_name)
        .all()
    )
    if not rows:
        # 流量测点无历史：按机组维度返回功率推流结果（key 为机组名）
        by_unit = _power_flow_by_day(db, day, day).get(day.isoformat(), {})
        return {k: round(v, 2) for k, v in by_unit.items()}
    out = {}
    for t, avg_v in rows:
        if avg_v is not None:
            # 按测点单位换算为 m³/h 后再乘 24 得日水量
            out[t] = round(_flow_to_m3h(float(avg_v), unit_map.get(t)) * 24, 2)
        else:
            out[t] = 0.0
    for t in tags:
        out.setdefault(t, 0.0)
    return out


def energy_by_day(
    db: Session,
    start: date,
    end: date,
    unit_id: Optional[int] = None,
) -> dict[str, float]:
    q = (
        db.query(
            func.date(EnergyRecord.record_time).label("d"),
            func.sum(EnergyRecord.electricity_kwh).label("kwh"),
        )
        .filter(
            EnergyRecord.deleted == 0,
            EnergyRecord.record_time >= datetime.combine(start, datetime.min.time()),
            EnergyRecord.record_time
            < datetime.combine(end + timedelta(days=1), datetime.min.time()),
        )
        .group_by("d")
    )
    if unit_id is not None:
        q = q.filter(EnergyRecord.unit_id == unit_id)
    agg = {d: float(kwh or 0) for d, kwh in q.all()}
    # fill zeros
    cur = start
    out: dict[str, float] = {}
    while cur <= end:
        k = cur.isoformat()
        out[k] = round(agg.get(k, 0.0), 3)
        cur += timedelta(days=1)
    return out


def energy_by_unit(
    db: Session,
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    q = db.query(EnergyRecord).filter(
        EnergyRecord.deleted == 0,
        EnergyRecord.record_time >= datetime.combine(start, datetime.min.time()),
        EnergyRecord.record_time
        < datetime.combine(end + timedelta(days=1), datetime.min.time()),
    )
    agg: dict[int, dict[str, Any]] = {}
    for r in q.all():
        if r.unit_id not in agg:
            agg[r.unit_id] = {
                "unit_id": r.unit_id,
                "unit_name": r.unit_name or str(r.unit_id),
                "electricity_kwh": 0.0,
            }
        agg[r.unit_id]["electricity_kwh"] += float(r.electricity_kwh or 0)
        if r.unit_name:
            agg[r.unit_id]["unit_name"] = r.unit_name
    items = list(agg.values())
    for it in items:
        it["electricity_kwh"] = round(it["electricity_kwh"], 3)
    items.sort(key=lambda x: x["electricity_kwh"], reverse=True)
    return items


def active_price(db: Session, on_date: Optional[date] = None) -> Optional[ElectricityPrice]:
    on_date = on_date or date.today()
    rows = (
        db.query(ElectricityPrice)
        .filter(
            ElectricityPrice.deleted == 0,
            ElectricityPrice.status == 1,
            ElectricityPrice.effective_from <= on_date,
        )
        .order_by(ElectricityPrice.effective_from.desc())
        .all()
    )
    for p in rows:
        if p.effective_to is None or p.effective_to >= on_date:
            return p
    return None


def period_of_hour(hour: int, price: ElectricityPrice) -> str:
    peak = parse_hours(price.peak_hours)
    valley = parse_hours(price.valley_hours)
    if hour in peak:
        return "peak"
    if hour in valley:
        return "valley"
    return "normal"


def calc_electricity_fee(
    db: Session,
    start: date,
    end: date,
) -> dict[str, Any]:
    price = active_price(db, start)
    if not price:
        return {
            "has_price": False,
            "total_fee": 0,
            "peak_fee": 0,
            "valley_fee": 0,
            "normal_fee": 0,
            "peak_kwh": 0,
            "valley_kwh": 0,
            "normal_kwh": 0,
            "total_kwh": 0,
            "daily": [],
        }

    peak_kwh = valley_kwh = normal_kwh = 0.0
    daily: dict[str, dict[str, float]] = defaultdict(
        lambda: {"peak_kwh": 0.0, "valley_kwh": 0.0, "normal_kwh": 0.0, "total_kwh": 0.0}
    )

    hourly = energy_kwh_by_hour(db, start, end)
    if hourly:
        # 有历史功率时序：按真实小时电量分峰/谷/平，口径与 energy_record 日汇总一致
        for (day_key, hour), kwh in hourly.items():
            period = period_of_hour(hour, price)
            daily[day_key]["total_kwh"] += kwh
            if period == "peak":
                peak_kwh += kwh
                daily[day_key]["peak_kwh"] += kwh
            elif period == "valley":
                valley_kwh += kwh
                daily[day_key]["valley_kwh"] += kwh
            else:
                normal_kwh += kwh
                daily[day_key]["normal_kwh"] += kwh
    else:
        # 无历史功率时序：回退到 energy_record 的日汇总（记录时间统一为 12:00）
        rows = (
            db.query(EnergyRecord)
            .filter(
                EnergyRecord.deleted == 0,
                EnergyRecord.record_time >= datetime.combine(start, datetime.min.time()),
                EnergyRecord.record_time
                < datetime.combine(end + timedelta(days=1), datetime.min.time()),
            )
            .all()
        )
        for r in rows:
            kwh = float(r.electricity_kwh or 0)
            period = period_of_hour(r.record_time.hour, price)
            day_key = r.record_time.date().isoformat()
            daily[day_key]["total_kwh"] += kwh
            if period == "peak":
                peak_kwh += kwh
                daily[day_key]["peak_kwh"] += kwh
            elif period == "valley":
                valley_kwh += kwh
                daily[day_key]["valley_kwh"] += kwh
            else:
                normal_kwh += kwh
                daily[day_key]["normal_kwh"] += kwh

    pp, vp, np_ = float(price.peak_price), float(price.valley_price), float(price.normal_price)
    peak_fee = peak_kwh * pp
    valley_fee = valley_kwh * vp
    normal_fee = normal_kwh * np_
    total_kwh = peak_kwh + valley_kwh + normal_kwh
    total_fee = peak_fee + valley_fee + normal_fee

    daily_list = []
    cur = start
    while cur <= end:
        k = cur.isoformat()
        d = daily.get(k, {"peak_kwh": 0, "valley_kwh": 0, "normal_kwh": 0, "total_kwh": 0})
        fee = (
            d["peak_kwh"] * pp
            + d["valley_kwh"] * vp
            + d["normal_kwh"] * np_
        )
        daily_list.append(
            {
                "date": k,
                "total_kwh": round(d["total_kwh"], 3),
                "total_fee": round(fee, 2),
                "peak_kwh": round(d["peak_kwh"], 3),
                "valley_kwh": round(d["valley_kwh"], 3),
                "normal_kwh": round(d["normal_kwh"], 3),
            }
        )
        cur += timedelta(days=1)

    return {
        "has_price": True,
        "price": {
            "id": price.id,
            "name": price.name,
            "peak_price": float(price.peak_price),
            "valley_price": float(price.valley_price),
            "normal_price": float(price.normal_price),
            "peak_hours": price.peak_hours,
            "valley_hours": price.valley_hours,
        },
        "total_fee": round(total_fee, 2),
        "peak_fee": round(peak_fee, 2),
        "valley_fee": round(valley_fee, 2),
        "normal_fee": round(normal_fee, 2),
        "peak_kwh": round(peak_kwh, 3),
        "valley_kwh": round(valley_kwh, 3),
        "normal_kwh": round(normal_kwh, 3),
        "total_kwh": round(total_kwh, 3),
        "daily": daily_list,
    }


def water_energy_ratio(
    db: Session,
    start: date,
    end: date,
    unit_id: Optional[int] = None,
) -> dict[str, Any]:
    water = water_actual_by_day(db, start, end)
    energy = energy_by_day(db, start, end, unit_id=unit_id)
    labels = []
    water_series = []
    energy_series = []
    ratio_series = []
    cur = start
    while cur <= end:
        k = cur.isoformat()
        labels.append(k)
        w = water.get(k, 0.0)
        e = energy.get(k, 0.0)
        water_series.append(w)
        energy_series.append(e)
        ratio_series.append(round(e / w, 4) if w > 0 else None)
        cur += timedelta(days=1)

    total_w = sum(water_series)
    total_e = sum(energy_series)
    return {
        "labels": labels,
        "water_m3": water_series,
        "energy_kwh": energy_series,
        "ratio": ratio_series,
        "summary": {
            "water_m3": round(total_w, 2),
            "energy_kwh": round(total_e, 3),
            "ratio": round(total_e / total_w, 4) if total_w > 0 else None,
            "unit": "kWh/m³",
        },
    }
