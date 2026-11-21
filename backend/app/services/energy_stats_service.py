"""机组能耗 / 能效按有功功率历史时序重算。

供后台调度器（ops_scheduler）每日自动调用，也供手工补算：
    - energy_record：每机组每日耗电量 kWh（梯形积分）
    - energy_efficiency_daily：运行时长、供水量、单耗、负荷率、理论效率

口径与 `analytics_service` 的功率推流一致：
    - 耗电量 kWh = ∫P(kW)dt / 3600（梯形积分）
    - 供水量 m³ = ∫Q dt，Q = η·P/(ρ·g·H)，H = 后池水位 − 前池水位
"""

from __future__ import annotations

import bisect
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.analytics import EnergyEfficiencyDaily, EnergyRecord
from app.models.equipment import Equipment
from app.services import analytics_service as analytics

RUN_THRESHOLD_KW = 50.0  # 低于此功率视为停机（与 tools/calc_energy_efficiency.py 一致）
POWER_TAG = "M{n}电机P"
ENERGY_REMARK = "自动计算(功率积分)"
EFFICIENCY_REMARK = "自动计算(日报时序积分)"


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def recalc_day(db: Session, day: date) -> dict:
    """重算指定自然日的机组能耗与能效，返回汇总。

    幂等：同一天重复调用只覆盖当日记录，不产生重复行。
    当日无功率历史时返回 units=0，且不改动已有记录。
    """
    units = (
        db.query(Equipment)
        .filter(Equipment.deleted == 0, Equipment.unit_no.isnot(None))
        .order_by(Equipment.unit_no)
        .all()
    )
    if not units:
        return {"day": day.isoformat(), "units": 0, "electricity_kwh": 0.0}

    start = datetime.combine(day, datetime.min.time())
    start_ms = _ms(start)
    end_ms = _ms(start + timedelta(days=1))
    tags = [POWER_TAG.format(n=int(u.unit_no)) for u in units] + [
        analytics.FOREPOOL_LEVEL_TAG,
        analytics.BACKPOOL_LEVEL_TAG,
    ]
    series = analytics._load_series(db, tags, start_ms, end_ms)

    heads = analytics._head_series(series)
    head_ts = [t for t, _ in heads]
    head_val = [h for _, h in heads]

    def head_at(ts: int) -> float:
        if not heads:
            return analytics.MIN_HEAD_M
        i = bisect.bisect_left(head_ts, ts)
        cand = [j for j in (i - 1, i) if 0 <= j < len(head_ts)]
        if not cand:
            return analytics.MIN_HEAD_M
        j = min(cand, key=lambda k: abs(head_ts[k] - ts))
        return head_val[j]

    results: list[dict] = []
    for u in units:
        points = series.get(POWER_TAG.format(n=int(u.unit_no))) or []
        if not points:
            continue
        n = len(points)
        dt_h = 86400.0 / max(n, 1) / 3600.0

        # 耗电量：梯形积分
        electricity_kwh = 0.0
        for (t1, p1), (t2, p2) in zip(points, points[1:]):
            electricity_kwh += 0.5 * (p1 + p2) * ((t2 - t1) / 1000.0) / 3600.0

        run_count = sum(1 for _, p in points if p > RUN_THRESHOLD_KW)
        run_hours = run_count * dt_h

        # 供水量：∫Q dt
        qs = [
            (
                ts,
                0.0
                if p <= RUN_THRESHOLD_KW
                else analytics.PUMP_EFFICIENCY * (p * analytics.KW_TO_WATT)
                / (analytics.WATER_DENSITY_KG_M3 * analytics.GRAVITY_M_S2 * head_at(ts)),
            )
            for ts, p in points
        ]
        water_m3 = 0.0
        for (t1, q1), (t2, q2) in zip(qs, qs[1:]):
            water_m3 += 0.5 * (q1 + q2) * ((t2 - t1) / 1000.0)

        unit_consumption = electricity_kwh / water_m3 if water_m3 > 0 else 0.0
        avg_power_kw = electricity_kwh / run_hours if run_hours > 0 else 0.0
        rated_p = float(u.rated_power_kw or 0)
        load_rate = avg_power_kw / rated_p * 100 if rated_p > 0 else 0.0

        total_hours = n * dt_h
        avg_q = water_m3 / (total_hours * 3600) if total_hours > 0 else 0.0
        avg_h = sum(head_at(ts) for ts, _ in points) / n if n else 0.0
        water_power_kw = (
            analytics.WATER_DENSITY_KG_M3 * analytics.GRAVITY_M_S2 * avg_q * avg_h
        ) / 1000.0
        efficiency = (
            min(water_power_kw / avg_power_kw * 100, 100) if avg_power_kw > 0 else 0.0
        )

        results.append(
            {
                "unit_id": u.id,
                "unit_name": u.name or f"{int(u.unit_no)}号机组",
                "electricity_kwh": round(electricity_kwh, 3),
                "run_hours": round(run_hours, 3),
                "water_m3": round(water_m3, 3),
                "unit_consumption": round(unit_consumption, 5),
                "avg_power_kw": round(avg_power_kw, 2),
                "load_rate": round(load_rate, 2),
                "efficiency": round(efficiency, 2),
                "sample_count": n,
            }
        )

    if not results:
        return {"day": day.isoformat(), "units": 0, "electricity_kwh": 0.0}

    record_time = datetime.combine(day, datetime.min.time()).replace(hour=12)
    day_start = datetime.combine(day, datetime.min.time())
    day_end = day_start + timedelta(days=1)
    for r in results:
        # 覆盖当日同机组耗电量：按自然日范围删除，兼容历史记录时间格式差异
        db.query(EnergyRecord).filter(
            EnergyRecord.unit_id == r["unit_id"],
            EnergyRecord.record_time >= day_start,
            EnergyRecord.record_time < day_end,
            EnergyRecord.deleted == 0,
        ).delete(synchronize_session=False)
        db.add(
            EnergyRecord(
                record_time=record_time,
                unit_id=r["unit_id"],
                unit_name=r["unit_name"],
                electricity_kwh=r["electricity_kwh"],
                remark=ENERGY_REMARK,
                status=1,
                deleted=0,
            )
        )

        ee = (
            db.query(EnergyEfficiencyDaily)
            .filter(
                EnergyEfficiencyDaily.stat_date == day,
                EnergyEfficiencyDaily.unit_id == r["unit_id"],
            )
            .first()
        )
        if not ee:
            ee = EnergyEfficiencyDaily(stat_date=day, unit_id=r["unit_id"], deleted=0)
            db.add(ee)
        ee.unit_name = r["unit_name"]
        ee.electricity_kwh = r["electricity_kwh"]
        ee.run_hours = r["run_hours"]
        ee.water_m3 = r["water_m3"]
        ee.unit_consumption = r["unit_consumption"]
        ee.avg_power_kw = r["avg_power_kw"]
        ee.load_rate = r["load_rate"]
        ee.efficiency = r["efficiency"]
        ee.sample_count = r["sample_count"]
        ee.remark = EFFICIENCY_REMARK
        ee.status = 1

    db.commit()
    return {
        "day": day.isoformat(),
        "units": len(results),
        "electricity_kwh": round(sum(r["electricity_kwh"] for r in results), 3),
    }
