"""
设备台账重建脚本：用现场 5 台机组 + 公共设备替换演示数据，并回填测点关联。

用法：
    python tools/rebuild_equipment.py [--dry-run]

动作：
    1. ensure_schema() 补齐 eq_equipment 新字段
    2. 软删除现有演示设备（deleted=1）
    3. 新建 5 台机组（大张庄1~5号轴流泵）+ 5 台公共设备
    4. 回填 scada_points.equipment_id：
       - M1~M5 前缀 → 对应机组
       - FJ前池水位/集水廊道 → 前池水位监测站
       - FJ后池水位 → 后池水位监测站
       - DHXZ / PLZ / ZQZ → 1/2/3 号工作闸门
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

# 机组额定参数（由运行日报反推：P≈540kW, U≈6.16kV, I≈56A, H≈1.4m, Q≈30m³/s, 叶片角 -6°~+4°）
UNIT_RATED = dict(
    pump_type="轴流泵",
    rated_power_kw=630.0,
    rated_current_a=60.0,
    rated_voltage_kv=6.0,
    rated_head_m=2.5,
    rated_flow_m3s=30.0,
    blade_angle_min=-6.0,
    blade_angle_max=4.0,
    maintain_term_days=90,
)

# 5 台机组（当天运行状态来自日报：1号运行、2号停机、3号运行、4号停机、5号运行）
UNITS = [
    {"unit_no": 1, "name": "大张庄1号机组", "code": "DZZ-UNIT-01", "running_status": "running", "continuous_run_hours": 3120.5},
    {"unit_no": 2, "name": "大张庄2号机组", "code": "DZZ-UNIT-02", "running_status": "stopped", "continuous_run_hours": 0.0},
    {"unit_no": 3, "name": "大张庄3号机组", "code": "DZZ-UNIT-03", "running_status": "running", "continuous_run_hours": 2876.0},
    {"unit_no": 4, "name": "大张庄4号机组", "code": "DZZ-UNIT-04", "running_status": "stopped", "continuous_run_hours": 0.0},
    {"unit_no": 5, "name": "大张庄5号机组", "code": "DZZ-UNIT-05", "running_status": "running", "continuous_run_hours": 1540.2},
]

# 公共设备
COMMON_EQUIP = [
    {"name": "前池水位监测站", "code": "DZZ-LVL-FRONT", "type_id": 5, "prefix": "FJ前池", "extra_tags": ["FJ集水廊道水位"]},
    {"name": "后池水位监测站", "code": "DZZ-LVL-BACK", "type_id": 5, "prefix": "FJ后池"},
    {"name": "1号工作闸门", "code": "DZZ-GATE-01", "type_id": 2, "prefix": "DHXZ"},
    {"name": "2号工作闸门", "code": "DZZ-GATE-02", "type_id": 2, "prefix": "PLZ"},
    {"name": "3号工作闸门", "code": "DZZ-GATE-03", "type_id": 2, "prefix": "ZQZ"},
]


def main():
    ap = argparse.ArgumentParser(description="重建设备台账为 5 台机组 + 公共设备")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.dry_run:
        ensure_schema()

    with engine.begin() as conn:
        # 1. 软删除现有演示设备
        old = conn.execute(text("SELECT id, name FROM eq_equipment WHERE deleted=0")).fetchall()
        print(f"[INFO] 软删除现有 {len(old)} 台设备：{[r[1] for r in old]}")
        if not args.dry_run:
            conn.execute(text("UPDATE eq_equipment SET deleted=1 WHERE deleted=0"))

        # 2. 新建 5 台机组
        new_ids = {}
        for u in UNITS:
            print(f"[INFO] 新建机组：{u['name']} ({u['code']}) running={u['running_status']}")
            if not args.dry_run:
                r = conn.execute(
                    text(
                        """
                        INSERT INTO eq_equipment (
                            name, code, type_id, location_id, manufacturer_id,
                            running_status, maintain_status, continuous_run_hours,
                            maintain_term_days, status, deleted,
                            unit_no, pump_type,
                            rated_power_kw, rated_current_a, rated_voltage_kv,
                            rated_head_m, rated_flow_m3s,
                            blade_angle_min, blade_angle_max
                        ) VALUES (
                            :name, :code, 1, 1, NULL,
                            :running_status, 'normal', :continuous_run_hours,
                            :maintain_term_days, 1, 0,
                            :unit_no, :pump_type,
                            :rated_power_kw, :rated_current_a, :rated_voltage_kv,
                            :rated_head_m, :rated_flow_m3s,
                            :blade_angle_min, :blade_angle_max
                        )
                        """
                    ),
                    {**u, **UNIT_RATED},
                )
                new_ids[f"M{u['unit_no']}"] = r.lastrowid

        # 3. 新建公共设备
        for c in COMMON_EQUIP:
            print(f"[INFO] 新建公共设备：{c['name']} ({c['code']})")
            if not args.dry_run:
                r = conn.execute(
                    text(
                        """
                        INSERT INTO eq_equipment (
                            name, code, type_id, location_id,
                            running_status, maintain_status, continuous_run_hours,
                            status, deleted
                        ) VALUES (
                            :name, :code, :type_id, 1,
                            'running', 'normal', 0, 1, 0
                        )
                        """
                    ),
                    c,
                )
                new_ids[c["code"]] = r.lastrowid

        if args.dry_run:
            print("[DRY-RUN] 未写入数据库")
            return

        # 4. 回填 scada_points.equipment_id
        # 4.1 机组测点：tag_name LIKE 'M%' → 按 M1~M5 匹配
        for unit_no in range(1, 6):
            eid = new_ids[f"M{unit_no}"]
            cur = conn.execute(
                text(
                    "UPDATE scada_points SET equipment_id=:eid "
                    "WHERE deleted=0 AND tag_name LIKE :prefix AND equipment_id IS NULL"
                ),
                {"eid": eid, "prefix": f"M{unit_no}%"},
            )
            print(f"[INFO] M{unit_no} 机组关联 {cur.rowcount} 个测点 → 设备 {eid}")

        # 4.2 公共设备测点
        for c in COMMON_EQUIP:
            eid = new_ids[c["code"]]
            cur = conn.execute(
                text(
                    "UPDATE scada_points SET equipment_id=:eid "
                    "WHERE deleted=0 AND tag_name LIKE :prefix AND equipment_id IS NULL"
                ),
                {"eid": eid, "prefix": f"{c['prefix']}%"},
            )
            print(f"[INFO] {c['name']} 关联 {cur.rowcount} 个测点 → 设备 {eid}")
            # 额外标签（如集水廊道水位归前池）
            for tag in c.get("extra_tags", []):
                conn.execute(
                    text(
                        "UPDATE scada_points SET equipment_id=:eid "
                        "WHERE deleted=0 AND tag_name=:tag AND equipment_id IS NULL"
                    ),
                    {"eid": eid, "tag": tag},
                )

        # 5. 统计
        total_linked = conn.execute(
            text("SELECT COUNT(*) FROM scada_points WHERE deleted=0 AND equipment_id IS NOT NULL")
        ).scalar()
        total_pts = conn.execute(
            text("SELECT COUNT(*) FROM scada_points WHERE deleted=0")
        ).scalar()
        print(f"[OK] 设备-测点关联完成：{total_linked}/{total_pts} 个测点已绑定设备")


if __name__ == "__main__":
    main()
