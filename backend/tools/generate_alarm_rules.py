"""
告警规则批量生成脚本：基于点表阈值 + 设备额定参数 + 业务常识生成 alarm_rule。

用法：
    python tools/generate_alarm_rules.py [--dry-run] [--db <db 路径>]

生成范围：
    1. 温度告警（点表 Hi/HiHi）：定子绕组、轴瓦、油池、开关柜触头
    2. 电气越限（额定值 × 1.1）：过流、过压、过负荷
    3. 液位告警（业务阈值）：前池水位高/低、后池水位高

去重键：(equipment_id, point_refs, compare_op, threshold)，重复执行 upsert。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402
from app.core.schema_sync import ensure_schema  # noqa: E402

# 告警级别：1一类紧急 2二类重要 3三类一般
# 温度告警：Hi=三类(3) 延时30s，HiHi=二类(2) 延时10s
# 电气告警：过流/过负荷=二类(2) 延时5s，过压=三类(3) 延时10s
# 液位告警：前池低=二类(2)，前池高=二类(2)，后池高=三类(3)

# 业务水位阈值（单位 m）
WATER_LEVEL_THRESHOLDS = {
    "FJ前池水位": [
        ("lt", -2.0, 2, "前池水位过低"),   # 防止汽蚀
        ("gt", 1.0, 2, "前池水位过高"),    # 防止漫溢
    ],
    "FJ后池水位": [
        ("gt", 2.0, 3, "后池水位过高"),
    ],
}

# 开关柜触头温度所在的公共设备名（不存在则创建）
SWITCHGEAR_DEVICE_NAME = "高压开关柜"


def main():
    ap = argparse.ArgumentParser(description="批量生成告警规则")
    ap.add_argument("--db", default=str(BACKEND_DIR / "water_ops.db"), help="目标 SQLite 数据库路径")
    ap.add_argument("--dry-run", action="store_true", help="只统计不写入")
    args = ap.parse_args()

    if not args.dry_run:
        ensure_schema()

    rules: list[dict] = []  # 待生成规则
    seen_keys: set[tuple] = set()  # 去重

    def add_rule(equipment_id, point_refs, name, alarm_type_code, alarm_level,
                 compare_op, threshold, delay_sec, remark):
        key = (equipment_id, point_refs, compare_op, str(threshold))
        if key in seen_keys:
            return
        seen_keys.add(key)
        rules.append(
            {
                "name": name,
                "equipment_id": equipment_id,
                "point_refs": point_refs,
                "alarm_type_code": alarm_type_code,
                "alarm_level": alarm_level,
                "trigger_logic": "any",
                "compare_op": compare_op,
                "threshold": str(threshold),
                "delay_sec": delay_sec,
                "debounce_sec": 60,
                "suppress_push_sec": 300,
                "enabled": 1,
                "remark": remark,
            }
        )

    with engine.connect() as c:
        # —— 1. 温度类：点表 Hi / HiHi ——
        temp_points = c.execute(
            text(
                """
                SELECT id, tag_name, equipment_id, hi, hihi FROM scada_points
                WHERE deleted=0 AND point_category='temperature'
                  AND (hi IS NOT NULL OR hihi IS NOT NULL)
                """
            )
        ).fetchall()
        for pid, tn, eid, hi, hihi in temp_points:
            if eid is None:
                continue
            if hi is not None:
                add_rule(eid, tn, f"{tn}温度高Hi", "TEMP_ALERT", 3, "gt", hi, 30,
                         f"点表Hi={hi}")
            if hihi is not None:
                add_rule(eid, tn, f"{tn}温度高高HiHi", "TEMP_ALERT", 2, "gt", hihi, 10,
                         f"点表HiHi={hihi}")

        # —— 2. 开关柜触头温度（other类，含"触头"，有 Hi）——
        sw_points = c.execute(
            text(
                """
                SELECT id, tag_name, equipment_id, hi FROM scada_points
                WHERE deleted=0 AND point_category='other'
                  AND tag_name LIKE '%触头%' AND hi IS NOT NULL
                """
            )
        ).fetchall()

        # 为开关柜测点准备公共设备
        sw_device_id = None
        need_sw_device = any(p[2] is None for p in sw_points)
        if need_sw_device:
            existing = c.execute(
                text("SELECT id FROM eq_equipment WHERE deleted=0 AND name=:n"),
                {"n": SWITCHGEAR_DEVICE_NAME},
            ).fetchone()
            if existing:
                sw_device_id = existing[0]
            elif not args.dry_run:
                # 创建开关柜公共设备
                from datetime import datetime
                c.execute(
                    text(
                        """
                        INSERT INTO eq_equipment
                            (name, code, type_id, status, deleted,
                             running_status, maintain_status, continuous_run_hours,
                             created_at, updated_at)
                        VALUES (:n, 'SWG-001', 3, 1, 0, 'stopped', 'normal', 0.0, :now, :now)
                        """
                    ),
                    {"n": SWITCHGEAR_DEVICE_NAME, "now": datetime.now()},
                )
                sw_device_id = c.execute(
                    text("SELECT last_insert_rowid()")
                ).fetchone()[0]
                # 回填开关柜测点 equipment_id
                c.execute(
                    text(
                        "UPDATE scada_points SET equipment_id=:eid "
                        "WHERE deleted=0 AND tag_name LIKE '%触头%' AND equipment_id IS NULL"
                    ),
                    {"eid": sw_device_id},
                )
                c.commit()
            else:
                # dry-run 占位
                sw_device_id = -1

        for pid, tn, eid, hi in sw_points:
            eid = eid if eid is not None else sw_device_id
            if eid is None:
                continue
            add_rule(eid, tn, f"{tn}触头温度高", "TEMP_ALERT", 3, "gt", hi, 30,
                     f"点表Hi={hi}")

        # —— 3. 电气越限：额定值 × 1.1 ——
        units = c.execute(
            text(
                """
                SELECT id, unit_no, rated_current_a, rated_voltage_kv, rated_power_kw
                FROM eq_equipment WHERE deleted=0 AND unit_no IS NOT NULL
                ORDER BY unit_no
                """
            )
        ).fetchall()
        for eq_id, unit_no, rated_i, rated_u, rated_p in units:
            if rated_i:
                th_i = round(float(rated_i) * 1.1, 1)
                for ph in ("A", "B", "C"):
                    tn = f"M{unit_no}电机I{ph}"
                    add_rule(eq_id, tn, f"{tn}过流", "ELEC_ALERT", 2, "gt", th_i, 5,
                             f"额定{rated_i}A×1.1={th_i}A")
            if rated_u:
                th_u = round(float(rated_u) * 1.1, 2)
                for uv in ("UAB", "UBC", "UAC"):
                    tn = f"M{unit_no}电机{uv}"
                    add_rule(eq_id, tn, f"{tn}过压", "ELEC_ALERT", 3, "gt", th_u, 10,
                             f"额定{rated_u}kV×1.1={th_u}kV")
            if rated_p:
                th_p = round(float(rated_p) * 1.1, 1)
                tn = f"M{unit_no}电机P"
                add_rule(eq_id, tn, f"{tn}过负荷", "ELEC_ALERT", 2, "gt", th_p, 10,
                         f"额定{rated_p}kW×1.1={th_p}kW")

        # —— 4. 液位告警：前池/后池水位 ——
        for tag, thresholds in WATER_LEVEL_THRESHOLDS.items():
            pt = c.execute(
                text("SELECT id, equipment_id FROM scada_points WHERE deleted=0 AND tag_name=:tn"),
                {"tn": tag},
            ).fetchone()
            if not pt:
                continue
            eid = pt[1]
            if eid is None:
                continue
            for op, th, lvl, suffix in thresholds:
                add_rule(eid, tag, f"{tag}{suffix}", "LEVEL_ABN", lvl, op, th, 5,
                         f"业务阈值")

    # 统计
    by_type: dict[str, int] = {}
    by_level: dict[int, int] = {}
    for r in rules:
        by_type[r["alarm_type_code"]] = by_type.get(r["alarm_type_code"], 0) + 1
        by_level[r["alarm_level"]] = by_level.get(r["alarm_level"], 0) + 1

    print(f"[INFO] 待生成规则：{len(rules)} 条")
    print(f"[INFO] 按类型：{by_type}")
    print(f"[INFO] 按级别：{by_level}")

    if args.dry_run:
        print("[DRY-RUN] 未写入数据库")
        if sw_points and sw_device_id == 0:
            print(f"[DRY-RUN] 将为 {len(sw_points)} 个开关柜触头测点创建公共设备 '{SWITCHGEAR_DEVICE_NAME}'")
        return

    # upsert：(equipment_id, point_refs, compare_op, threshold) 唯一
    sql = text(
        """
        INSERT INTO alarm_rule (
            name, equipment_id, point_refs, alarm_type_code, alarm_level,
            trigger_logic, compare_op, threshold, delay_sec, debounce_sec,
            suppress_push_sec, enabled, remark, status, deleted
        ) VALUES (
            :name, :equipment_id, :point_refs, :alarm_type_code, :alarm_level,
            :trigger_logic, :compare_op, :threshold, :delay_sec, :debounce_sec,
            :suppress_push_sec, :enabled, :remark, 1, 0
        )
        ON CONFLICT(equipment_id, point_refs, compare_op, threshold) DO UPDATE SET
            name=excluded.name,
            alarm_type_code=excluded.alarm_type_code,
            alarm_level=excluded.alarm_level,
            delay_sec=excluded.delay_sec,
            remark=excluded.remark,
            enabled=excluded.enabled,
            updated_at=CURRENT_TIMESTAMP
        """
    )

    # 检查唯一索引
    with engine.begin() as conn:
        idx = conn.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='alarm_rule' "
                "AND name='idx_rule_uniq'"
            )
        ).fetchone()
        if not idx:
            print("[INFO] 创建唯一索引 idx_rule_uniq(equipment_id, point_refs, compare_op, threshold)")
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX idx_rule_uniq ON alarm_rule("
                    "equipment_id, point_refs, compare_op, threshold)"
                )
            )

    with engine.begin() as conn:
        conn.execute(sql, rules)

    print(f"[OK] 已生成/更新 {len(rules)} 条告警规则")


if __name__ == "__main__":
    main()
