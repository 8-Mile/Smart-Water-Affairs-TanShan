"""
按历史时序重建统计数据脚本。

用途：
    1. 清理 energy_record 中 unit_id=1/2/3 的测试假数据；
    2. 按 scada_tag_data 的 M1~M5电机P 对每个有数据的本地自然日做梯形积分，
       重算每日每机组耗电量 kWh，upsert 到 energy_record；
    3. 复用 calc_energy_efficiency.py 重算 energy_efficiency_daily；
    4. 清理旧供水计划，按"投运机组设计能力"重新生成每日供水计划。

用法：
    python tools/rebuild_stats_from_history.py [--dry-run]

口径说明：
    - 日耗电量 kWh = ∫P(kW)dt / 3600，P 采样间隔按实际时间戳做梯形积分；
    - 供水计划 m³/日 = 当日历史最大同时投运台数 × 额定流量(m³/s) × 86400；
      "投运"判定为 P > 5% 额定功率（与 analytics_service 推流口径一致）；
    - 日期切分按本地时区自然日（与统计接口 _local_day_expr 一致）。
"""
from __future__ import annotations

import argparse
import bisect
import importlib.util
import os
import sys
from datetime import datetime, time as dtime, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
TOOLS_DIR = Path(__file__).resolve().parent
DB_PATH = BACKEND_DIR / "water_ops.db"

# 强制指向后端库：从项目根执行时 CWD 相对路径会落到错误库
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.schema_sync import ensure_schema  # noqa: E402
from app.services import analytics_service as analytics  # noqa: E402

# 视为测试数据的机组 ID
FAKE_UNIT_IDS = (1, 2, 3)
# 投运功率阈值（与推流估算保持一致：P > 5% 额定功率）
STOP_POWER_RATIO = analytics.STOP_POWER_RATIO
POWER_TAG = "M{n}电机P"
PLAN_REMARK = "按投运机组设计能力自动生成"


def _local_offset_seconds() -> int:
    off = datetime.now().astimezone().utcoffset() or timedelta(0)
    return int(off.total_seconds())


def _day_of(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000).date().isoformat()


def load_units(conn) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT id, unit_no, name, rated_power_kw, rated_flow_m3s
            FROM eq_equipment
            WHERE deleted=0 AND unit_no IS NOT NULL
            ORDER BY unit_no
            """
        )
    ).fetchall()
    return [
        {
            "id": int(r[0]),
            "unit_no": int(r[1]),
            "name": r[2] or f"{int(r[1])}号机组",
            "energy_name": f"大张庄{int(r[1])}号机组",
            "rated_power_kw": float(r[3] or 0),
            "rated_flow_m3s": float(r[4] or 0),
            "tag": POWER_TAG.format(n=int(r[1])),
        }
        for r in rows
    ]


def history_days(conn, tags: list[str]) -> list[str]:
    """返回有功功率测点有数据的本地自然日（升序）。"""
    offsets = _local_offset_seconds()
    placeholders = ",".join(f":t{i}" for i in range(len(tags)))
    params = {f"t{i}": t for i, t in enumerate(tags)}
    rows = conn.execute(
        text(
            f"""
            SELECT strftime('%Y-%m-%d', ts_ms/1000, 'unixepoch',
                            '{offsets} seconds') AS d
            FROM scada_tag_data
            WHERE tag_name IN ({placeholders}) AND value_num IS NOT NULL
            GROUP BY d ORDER BY d
            """
        ),
        params,
    ).fetchall()
    return [r[0] for r in rows if r[0]]


def load_power(conn, tag: str, day: str) -> list[tuple[int, float]]:
    stat = datetime.fromisoformat(day)
    start_ms = int(datetime.combine(stat, datetime.min.time()).timestamp() * 1000)
    end_ms = int((datetime.combine(stat, datetime.min.time()) + timedelta(days=1)).timestamp() * 1000)
    rows = conn.execute(
        text(
            """
            SELECT ts_ms, value_num FROM scada_tag_data
            WHERE tag_name=:tag AND ts_ms >= :s AND ts_ms < :e AND value_num IS NOT NULL
            ORDER BY ts_ms
            """
        ),
        {"tag": tag, "s": start_ms, "e": end_ms},
    ).fetchall()
    return [(int(r[0]), float(r[1])) for r in rows]


def integrate_kwh(points: list[tuple[int, float]]) -> float:
    """耗电量 kWh = ∫P(kW)dt/3600（梯形法，dt 为相邻采样时间差）。"""
    kwh = 0.0
    for (t1, p1), (t2, p2) in zip(points, points[1:]):
        kwh += 0.5 * (p1 + p2) * ((t2 - t1) / 1000.0) / 3600.0
    return kwh


def max_running_units(series: dict[str, list[tuple[int, float]]], units: list[dict]) -> int:
    """当日历史最大同时投运台数（P > 5% 额定功率视为投运）。"""
    stop_kw = {u["tag"]: u["rated_power_kw"] * STOP_POWER_RATIO for u in units}
    flags: dict[str, dict[int, bool]] = {}
    stamps: dict[str, list[int]] = {}
    all_ts: set[int] = set()
    for tag, pts in series.items():
        flags[tag] = {t: p > stop_kw.get(tag, 0.0) for t, p in pts}
        stamps[tag] = [t for t, _ in pts]
        all_ts.update(stamps[tag])

    def running_at(tag: str, ts: int) -> bool:
        flag_map = flags[tag]
        if ts in flag_map:
            return flag_map[ts]
        ts_list = stamps[tag]
        if not ts_list:
            return False
        i = bisect.bisect_left(ts_list, ts)
        cand = [j for j in (i - 1, i) if 0 <= j < len(ts_list)]
        if not cand:
            return False
        nearest = ts_list[min(cand, key=lambda k: abs(ts_list[k] - ts))]
        return flag_map.get(nearest, False)

    best = 0
    for ts in sorted(all_ts):
        cnt = sum(1 for tag in series if running_at(tag, ts))
        best = max(best, cnt)
    return best


def load_calc_module():
    """复用 calc_energy_efficiency.py（tools 不是包，按文件路径导入）。"""
    path = TOOLS_DIR / "calc_energy_efficiency.py"
    spec = importlib.util.spec_from_file_location("calc_energy_efficiency", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_efficiency(calc_mod, day: str, dry_run: bool) -> None:
    """调用能效脚本 main()，复用其 energy_efficiency_daily 计算与 upsert 逻辑。"""
    backup = sys.argv
    sys.argv = ["calc_energy_efficiency.py", "--date", day]
    if dry_run:
        sys.argv.append("--dry-run")
    try:
        calc_mod.main()
    finally:
        sys.argv = backup


def main() -> None:
    ap = argparse.ArgumentParser(description="按历史时序重建供水/能耗统计")
    ap.add_argument("--dry-run", action="store_true", help="只计算与预览，不写库/不调用能效脚本")
    args = ap.parse_args()

    print(f"[INFO] 数据库: {DB_PATH}")

    with engine.connect() as conn:
        units = load_units(conn)
        if not units:
            print("[WARN] 未找到带 unit_no 的机组台账，退出")
            return
        days = history_days(conn, [u["tag"] for u in units])
        if not days:
            print("[WARN] 有功功率测点无历史数据，退出")
            return
        print(f"[INFO] 机组 {len(units)} 台；有历史的自然日: {', '.join(days)}")

        # 每日每机组耗电量
        kwh_by_day: dict[str, dict[str, float]] = {}
        for day in days:
            kwh_by_day[day] = {}
            for u in units:
                pts = load_power(conn, u["tag"], day)
                kwh_by_day[day][u["id"]] = integrate_kwh(pts)

        # 每日最大投运台数与供水计划
        plan_by_day: dict[str, float] = {}
        concurrent_by_day: dict[str, int] = {}
        rated_flow = max((u["rated_flow_m3s"] for u in units), default=0.0)
        for day in days:
            series = {u["tag"]: load_power(conn, u["tag"], day) for u in units}
            series = {k: v for k, v in series.items() if v}
            cnt = max_running_units(series, units)
            concurrent_by_day[day] = cnt
            plan_by_day[day] = cnt * rated_flow * 86400

        fake_count = conn.execute(
            text(
                "SELECT COUNT(*) FROM energy_record "
                f"WHERE unit_id IN ({','.join(str(i) for i in FAKE_UNIT_IDS)})"
            )
        ).scalar_one()
        old_plan_count = conn.execute(
            text("SELECT COUNT(*) FROM water_supply_plan WHERE deleted=0 AND plan_type='day'")
        ).scalar_one()

    print(f"[INFO] 将删除 energy_record 测试数据 {fake_count} 条 (unit_id in {FAKE_UNIT_IDS})")
    print(f"[INFO] 将逻辑删除旧日供水计划 {old_plan_count} 条并重建")

    # —— 能效表：复用 calc_energy_efficiency.py（先跑，后面的 energy_record 覆盖其电耗）——
    if not args.dry_run:
        ensure_schema()
        calc_mod = load_calc_module()
        for day in days:
            print(f"\n[INFO] 重算能效 energy_efficiency_daily: {day}")
            run_efficiency(calc_mod, day, dry_run=False)

    # —— 组装 energy_record / water_supply_plan 写入 ——
    er_rows = []
    for day in days:
        stat = datetime.fromisoformat(day)
        record_time = datetime.combine(stat, dtime(12, 0, 0))
        for u in units:
            er_rows.append(
                {
                    "rt": record_time,
                    "uid": u["id"],
                    "uname": u["energy_name"],
                    "kwh": round(kwh_by_day[day][u["id"]], 3),
                }
            )

    if not args.dry_run:
        with engine.begin() as conn:
            # 1) 清理测试假数据
            conn.execute(
                text(
                    "DELETE FROM energy_record "
                    f"WHERE unit_id IN ({','.join(str(i) for i in FAKE_UNIT_IDS)})"
                )
            )
            # 2) 幂等重写当日机组电耗（先删同日同机组，再插入）
            for row in er_rows:
                conn.execute(
                    text(
                        "DELETE FROM energy_record "
                        "WHERE record_time=:rt AND unit_id=:uid AND deleted=0"
                    ),
                    {"rt": row["rt"], "uid": row["uid"]},
                )
                conn.execute(
                    text(
                        """
                        INSERT INTO energy_record
                            (record_time, unit_id, unit_name, electricity_kwh,
                             remark, status, deleted)
                        VALUES (:rt, :uid, :uname, :kwh, '自动计算(功率积分)', 1, 0)
                        """
                    ),
                    row,
                )
            # 3) 逻辑删除旧日计划，重建
            conn.execute(
                text(
                    "UPDATE water_supply_plan SET deleted=1, updated_at=CURRENT_TIMESTAMP "
                    "WHERE deleted=0 AND plan_type='day'"
                )
            )
            for day in days:
                conn.execute(
                    text(
                        """
                        INSERT INTO water_supply_plan
                            (plan_type, plan_date, plan_value, remark, status, deleted)
                        VALUES ('day', :d, :v, :remark, 1, 0)
                        """
                    ),
                    {"d": day, "v": round(plan_by_day[day], 2), "remark": PLAN_REMARK},
                )

    # —— 汇总输出（供水量取统计接口同一口径，便于人工核对）——
    db = SessionLocal()
    try:
        print("\n[汇总] 每日每机组耗电量 / 供水量估算 / 供水计划")
        print(
            f"{'日期':<12}{'机组':<14}{'电耗kWh':>12}{'投运台数':>10}"
            f"{'供水量m³':>14}{'日计划m³':>16}"
        )
        for day in days:
            water = analytics.water_actual_by_day(
                db, datetime.fromisoformat(day).date(), datetime.fromisoformat(day).date()
            ).get(day, 0.0)
            for u in units:
                print(
                    f"{day:<12}{u['name']:<14}"
                    f"{kwh_by_day[day][u['id']]:>12.1f}"
                    f"{concurrent_by_day[day]:>10}"
                    f"{water:>14.1f}"
                    f"{plan_by_day[day]:>16.1f}"
                )
        total_water = sum(
            analytics.water_actual_by_day(
                db,
                datetime.fromisoformat(days[0]).date(),
                datetime.fromisoformat(days[-1]).date(),
            ).values()
        )
        print(f"\n[汇总] 区间日供水量合计（m³）: {total_water:.1f}")
    finally:
        db.close()

    if args.dry_run:
        print("\n[DRY-RUN] 未写入数据库，未调用能效脚本")
    else:
        print(f"\n[OK] energy_record 写入 {len(er_rows)} 条；供水计划 {len(days)} 条")


if __name__ == "__main__":
    main()
