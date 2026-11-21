"""
机组日能效自动计算脚本：从 scada_tag_data 的有功功率时序积分耗电量，
并估算供水量、单耗、负荷率、理论效率，写入 energy_record + energy_efficiency_daily。

用法：
    python tools/calc_energy_efficiency.py [--date YYYY-MM-DD] [--dry-run] [--db <db>]

计算逻辑：
    - 耗电量 kWh = Σ(P_kW × Δt_h)，Δt = 86400/552 s
    - 运行判定：P > 50 kW（约额定 8%）视为运行
    - 供水量 m³ = ∫Q(t)dt（梯形积分），Q = η·P/(ρ·g·H)，H = 后池水位 − 前池水位
      （与数据统计页 `analytics_service` 的功率推流口径一致，不再用「运行时长×额定流量」）
    - 单耗 kWh/m³ = 耗电量 / 供水量
    - 负荷率 % = 平均功率 / 额定功率 × 100
    - 理论效率 % = min(水功率/轴功率 × 100, 100)，水功率 = ρg·Q_avg·H_avg/1000

幂等：按 (stat_date, unit_id) upsert。
"""
from __future__ import annotations

import argparse
import bisect
import sys
from datetime import date, datetime, time as dtime, timedelta
from decimal import Decimal
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402
from app.core.schema_sync import ensure_schema  # noqa: E402
# 确保模型注册到 Base.metadata，create_all 才能建表
from app.models.analytics import EnergyEfficiencyDaily  # noqa: F401, E402

# 物理常数
G = 9.81  # m/s²
RHO = 1000  # kg/m³
KW_TO_WATT = 1000.0  # 有功功率按 kW 存储
PUMP_EFFICIENCY = 0.85  # 机组综合效率（与 analytics_service 保持一致）
MIN_HEAD_M = 0.1  # 扬程下限
FOREPOOL_LEVEL_TAG = "FJ前池水位"
BACKPOOL_LEVEL_TAG = "FJ后池水位"

# 运行判定阈值（kW）：低于此值视为停机
RUN_THRESHOLD_KW = 50.0


def main():
    ap = argparse.ArgumentParser(description="计算机组日能效指标")
    ap.add_argument("--date", default="2026-10-28", help="统计日期 YYYY-MM-DD")
    ap.add_argument("--db", default=str(BACKEND_DIR / "water_ops.db"), help="数据库路径")
    ap.add_argument("--dry-run", action="store_true", help="只计算不写入")
    args = ap.parse_args()

    stat_date = date.fromisoformat(args.date)
    # 记录时间取当天正午，且带微秒以兼容 ORM DateTime 比较
    day_start = datetime.combine(stat_date, datetime.min.time())
    record_time = datetime.combine(stat_date, dtime(12, 0, 0, 0))
    day_end = day_start + timedelta(days=1)
    start_ms = int(day_start.timestamp() * 1000)
    end_ms = int(day_end.timestamp() * 1000)

    if not args.dry_run:
        ensure_schema()

    results: list[dict] = []

    with engine.connect() as c:
        # 读取 5 个机组的额定参数
        units = c.execute(
            text(
                """
                SELECT id, unit_no, name, rated_power_kw, rated_flow_m3s, rated_head_m
                FROM eq_equipment WHERE deleted=0 AND unit_no IS NOT NULL ORDER BY unit_no
                """
            )
        ).fetchall()

        # 当日前后池水位（用于扬程 H = 后池 − 前池）
        level_rows = c.execute(
            text(
                """
                SELECT tag_name, ts_ms, value_num FROM scada_tag_data
                WHERE tag_name IN (:f, :b) AND ts_ms >= :s AND ts_ms < :e
                  AND value_num IS NOT NULL
                ORDER BY ts_ms
                """
            ),
            {"f": FOREPOOL_LEVEL_TAG, "b": BACKPOOL_LEVEL_TAG, "s": start_ms, "e": end_ms},
        ).fetchall()
        fore = [(int(ts), float(v)) for tag, ts, v in level_rows if tag == FOREPOOL_LEVEL_TAG]
        back = [(int(ts), float(v)) for tag, ts, v in level_rows if tag == BACKPOOL_LEVEL_TAG]

        def _nearest(series: list[tuple[int, float]], ts: int) -> float:
            """按时间取最近一个值（水位 2.6min 一采，误差可忽略）。"""
            if not series:
                return 0.0
            i = bisect.bisect_left(series, (ts, float("-inf")))
            cand = [j for j in (i - 1, i) if 0 <= j < len(series)]
            j = min(cand, key=lambda k: abs(series[k][0] - ts))
            return series[j][1]

        def head_at(ts: int) -> float:
            return max(_nearest(back, ts) - _nearest(fore, ts), MIN_HEAD_M)

        for eq_id, unit_no, eq_name, rated_p, rated_q, rated_h in units:
            tag = f"M{unit_no}电机P"
            # 读取当日有功功率时序（带时间戳，供积分与扬程取值）
            rows = c.execute(
                text(
                    """
                    SELECT ts_ms, value_num FROM scada_tag_data
                    WHERE tag_name=:tag AND ts_ms >= :s AND ts_ms < :e AND value_num IS NOT NULL
                    ORDER BY ts_ms
                    """
                ),
                {"tag": tag, "s": start_ms, "e": end_ms},
            ).fetchall()

            if not rows:
                print(f"[WARN] {tag} 无数据，跳过")
                continue

            samples = [(int(ts), float(v)) for ts, v in rows]
            values = [v for _, v in samples]
            n = len(values)
            # 采样间隔（秒）：日报 552 点/天，但仿真数据可能更多，用实际点数推算
            interval_sec = 86400.0 / max(n, 1)
            dt_h = interval_sec / 3600.0

            # 耗电量（kWh）= Σ P × Δt
            electricity_kwh = sum(v * dt_h for v in values)

            # 运行判定
            run_values = [v for v in values if v > RUN_THRESHOLD_KW]
            run_count = len(run_values)
            run_hours = run_count * dt_h

            # 供水量（m³）= ∫Q(t)dt，Q = η·P/(ρ·g·H)，P≤阈值按 0 计
            stop_kw = RUN_THRESHOLD_KW
            qs = [
                (ts, 0.0 if v <= stop_kw else PUMP_EFFICIENCY * (v * KW_TO_WATT)
                 / (RHO * G * head_at(ts)))
                for ts, v in samples
            ]
            water_m3 = 0.0
            for (t1, q1), (t2, q2) in zip(qs, qs[1:]):
                water_m3 += 0.5 * (q1 + q2) * ((t2 - t1) / 1000.0)

            # 单耗
            unit_consumption = electricity_kwh / water_m3 if water_m3 > 0 else 0

            # 平均功率（运行时段）
            avg_power_kw = electricity_kwh / run_hours if run_hours > 0 else 0

            # 负荷率
            rated_p_f = float(rated_p or 0)
            load_rate = (avg_power_kw / rated_p_f * 100) if rated_p_f > 0 else 0

            # 理论效率 = 水功率/轴功率，平均流量取全时段积分量 / 采样总时长，扬程取运行时段均值
            total_hours = n * dt_h
            avg_q = (water_m3 / (total_hours * 3600)) if total_hours > 0 else 0
            avg_h = (sum(head_at(ts) for ts, _ in samples) / n) if n else 0
            water_power_kw = (RHO * G * avg_q * avg_h) / 1000
            efficiency = min(water_power_kw / avg_power_kw * 100, 100) if avg_power_kw > 0 else 0

            results.append(
                {
                    "stat_date": stat_date.isoformat(),
                    "unit_id": eq_id,
                    "unit_name": eq_name,
                    "electricity_kwh": round(electricity_kwh, 3),
                    "run_hours": round(run_hours, 3),
                    "water_m3": round(water_m3, 3),
                    "unit_consumption": round(unit_consumption, 5),
                    "avg_power_kw": round(avg_power_kw, 2),
                    "load_rate": round(load_rate, 2),
                    "efficiency": round(efficiency, 2),
                    "sample_count": n,
                    "remark": "自动计算(日报时序积分)",
                }
            )
            print(
                f"[INFO] {eq_name}(M{unit_no}) 样本={n} 运行={run_count}点/"
                f"{run_hours:.1f}h 电耗={electricity_kwh:.1f}kWh "
                f"供水={water_m3:.0f}m³ 单耗={unit_consumption:.4f}kWh/m³ "
                f"负荷率={load_rate:.1f}% 效率={efficiency:.1f}%"
            )

    if not results:
        print("[WARN] 无计算结果")
        return

    if args.dry_run:
        print(f"\n[DRY-RUN] 共 {len(results)} 台机组，未写入数据库")
        return

    # —— 写入 energy_record（耗电量）——
    er_sql = text(
        """
        INSERT INTO energy_record
            (record_time, unit_id, unit_name, electricity_kwh, remark, status, deleted)
        VALUES (:rt, :uid, :uname, :kwh, :remark, 1, 0)
        """
    )
    # —— 写入 energy_efficiency_daily（完整指标）——
    ee_sql = text(
        """
        INSERT INTO energy_efficiency_daily
            (stat_date, unit_id, unit_name, electricity_kwh, run_hours, water_m3,
             unit_consumption, avg_power_kw, load_rate, efficiency, sample_count,
             remark, status, deleted)
        VALUES (:stat_date, :unit_id, :unit_name, :electricity_kwh, :run_hours, :water_m3,
             :unit_consumption, :avg_power_kw, :load_rate, :efficiency, :sample_count,
             :remark, 1, 0)
        ON CONFLICT(stat_date, unit_id) DO UPDATE SET
            unit_name=excluded.unit_name,
            electricity_kwh=excluded.electricity_kwh,
            run_hours=excluded.run_hours,
            water_m3=excluded.water_m3,
            unit_consumption=excluded.unit_consumption,
            avg_power_kw=excluded.avg_power_kw,
            load_rate=excluded.load_rate,
            efficiency=excluded.efficiency,
            sample_count=excluded.sample_count,
            remark=excluded.remark,
            updated_at=CURRENT_TIMESTAMP
        """
    )

    er_rows = [
        {
            "rt": record_time,
            "uid": r["unit_id"],
            "uname": r["unit_name"],
            "kwh": float(r["electricity_kwh"]),
            "remark": "自动计算(日报时序积分)",
        }
        for r in results
    ]

    with engine.begin() as conn:
        # 创建唯一索引（如不存在）
        idx = conn.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='energy_efficiency_daily' AND name='idx_ee_date_unit'"
            )
        ).fetchone()
        if not idx:
            conn.execute(
                text("CREATE UNIQUE INDEX idx_ee_date_unit ON energy_efficiency_daily(stat_date, unit_id)")
            )
        # 先删除同日同机组的旧 energy_record（避免重复），再插入
        for r in results:
            conn.execute(
                text(
                    "DELETE FROM energy_record WHERE record_time=:rt AND unit_id=:uid AND deleted=0"
                ),
                {"rt": record_time, "uid": r["unit_id"]},
            )
        conn.execute(er_sql, er_rows)
        conn.execute(ee_sql, results)

    print(f"\n[OK] 已写入 {len(results)} 台机组的能效数据")
    print(f"  energy_record: {len(results)} 条耗电量记录")
    print(f"  energy_efficiency_daily: {len(results)} 条完整能效指标")


if __name__ == "__main__":
    main()
