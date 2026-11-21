"""
点表导入脚本：从力控 DZZDB.xls（实为 xlsx）导入测点到 scada_points。

用法：
    python tools/import_dzzdb_points.py --xls <DZZDB.xls 路径> [--dry-run] [--db <db 路径>]

功能：
    - 解析 IO_FLOAT / IO_INT32 / IO_INT64 / IO_DOUBLE / IO_DISC / IO_STRING 六个工作表
    - 按 TagName 前缀 M1~M5 识别机组号，无 M 前缀为公共测点
    - 按 TagName 关键词自动归类 point_category
    - 导入 tag_id / 量程 / Hi-Lo-HiHi-LoLo 阈值 / alarm_group / io_access / his_rec_interval
    - tag_name 为唯一键，重复执行走 upsert（INSERT OR REPLACE）

注意：
    - 点表 MaxValue 若 >= 1e8 视为无限制（力控默认值），不写入量程
    - Hi/Lo/HiHi/LoLo 仅在对应 *Enabled=true 时取值
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# 允许以 backend 为根导入 app
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402
from app.core.schema_sync import ensure_schema  # noqa: E402

# 点表工作表 → value_type
SHEET_VALUE_TYPE = {
    "IO_FLOAT": "number",
    "IO_DOUBLE": "number",
    "IO_INT32": "number",
    "IO_INT64": "number",
    "IO_DISC": "bool",
    "IO_STRING": "string",
}

# 测点分类：温度/水力按关键词匹配，其余 M 前缀模拟量归电气
CATEGORY_KEYWORDS = [
    ("temperature", ["温度"]),
    ("hydraulic", ["水位", "压力", "流量", "液位", "角度", "扬程", "油位", "油压"]),
]

# 机组号识别：TagName 以 M + 数字 开头
UNIT_RE = re.compile(r"^M(\d+)")


def parse_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in ("true", "1", "yes")


def parse_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_int(v):
    f = parse_float(v)
    return int(f) if f is not None else None


def detect_category(tag_name: str, sheet: str) -> str:
    if sheet == "IO_DISC":
        return "switch"
    for cat, kws in CATEGORY_KEYWORDS:
        if any(kw in tag_name for kw in kws):
            return cat
    # 剩余模拟量：带 M 前缀的机组测点（UAB/IA/P/Q/F/COS/励磁/运行时间等）归电气
    if UNIT_RE.match(tag_name):
        return "electrical"
    return "other"


def unit_no_of(tag_name: str) -> int | None:
    m = UNIT_RE.match(tag_name)
    return int(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser(description="导入力控 DZZDB 点表到 scada_points")
    ap.add_argument(
        "--xls",
        default="/Users/8-mile/Desktop/项目集合/天津项目集合/大张庄管理处泵站-陈/数据来源/DZZDB.xls",
        help="DZZDB.xls 文件路径",
    )
    ap.add_argument("--db", default=str(BACKEND_DIR / "water_ops.db"), help="目标 SQLite 数据库路径")
    ap.add_argument("--dry-run", action="store_true", help="只统计不写入")
    args = ap.parse_args()

    xls_path = Path(args.xls)
    if not xls_path.exists():
        sys.exit(f"[ERR] 点表文件不存在: {xls_path}")

    # 把 DZZDB.xls（实为 xlsx）复制一份到临时 .xlsx，避免 openpyxl 按扩展名校验
    import shutil
    import tempfile

    tmp_xlsx = Path(tempfile.gettempdir()) / "dzzdb_import.xlsx"
    shutil.copyfile(xls_path, tmp_xlsx)

    import openpyxl

    wb = openpyxl.load_workbook(str(tmp_xlsx), read_only=True, data_only=True)

    # 确保表结构含新字段
    if not args.dry_run:
        ensure_schema()

    rows_to_insert: list[dict] = []
    stats = {"sheets": 0, "total": 0, "by_unit": {}, "by_category": {}, "by_sheet": {}}

    for sheet, vt in SHEET_VALUE_TYPE.items():
        if sheet not in wb.sheetnames:
            continue
        ws = wb[sheet]
        stats["sheets"] += 1
        sheet_count = 0
        # 用表头名定位列，兼容不同工作表列数差异
        header = [str(c or "").strip() for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
        col = {name: i for i, name in enumerate(header)}

        def gv(name):
            """按表头名取当前行的值；列不存在返回 None。"""
            return row[col[name]] if name in col and col[name] < len(row) else None

        for row in ws.iter_rows(min_row=2, values_only=True):
            tag_id = to_int(gv("TagID"))
            tag_name = str(gv("TagName") or "").strip()
            if not tag_name or tag_id is None:
                continue

            max_v = parse_float(gv("MaxValue"))
            min_v = parse_float(gv("MinValue"))
            if max_v is not None and max_v >= 1e8:
                max_v = None
            if min_v is not None and min_v <= -1e8:
                min_v = None

            unit = str(gv("EngineerUnits") or "").strip() or None
            his_rec_interval = to_int(gv("HisRecInterval"))
            alarm_group = str(gv("AlarmGroup") or "").strip() or None
            io_access = str(gv("IOAccess") or "").strip() or None

            hihi = parse_float(gv("HiHiLimit")) if parse_bool(gv("HiHiEnabled")) else None
            hi = parse_float(gv("HiLimit")) if parse_bool(gv("HiEnabled")) else None
            lo = parse_float(gv("LoLimit")) if parse_bool(gv("LoEnabled")) else None
            lolo = parse_float(gv("LoLoLimit")) if parse_bool(gv("LoLoEnabled")) else None

            unit_no = unit_no_of(tag_name)
            category = detect_category(tag_name, sheet)
            node_id = "PLC1"  # 力控点表未分区节点，统一占位；后续按 IOAccess 前缀细分

            rows_to_insert.append(
                {
                    "tag_name": tag_name,
                    "node_id": node_id,
                    "value_type": vt,
                    "unit": unit,
                    "description": str(gv("Description") or "").strip() or None,
                    "sim_base": 0,
                    "sim_amplitude": 1,
                    "sim_period_sec": 60,
                    "enabled": 1,
                    "tag_id": tag_id,
                    "equipment_id": None,
                    "point_category": category,
                    "min_value": min_v,
                    "max_value": max_v,
                    "hi": hi,
                    "lo": lo,
                    "hihi": hihi,
                    "lolo": lolo,
                    "alarm_group": alarm_group,
                    "his_rec_interval": his_rec_interval,
                    "io_access": io_access,
                }
            )
            sheet_count += 1
            stats["total"] += 1
            key = f"M{unit_no}" if unit_no else "公共"
            stats["by_unit"][key] = stats["by_unit"].get(key, 0) + 1
            stats["by_category"][category] = stats["by_category"].get(category, 0) + 1
        stats["by_sheet"][sheet] = sheet_count

    wb.close()
    tmp_xlsx.unlink(missing_ok=True)

    print(f"[INFO] 解析完成：{stats['sheets']} 个工作表，共 {stats['total']} 个测点")
    print(f"[INFO] 按工作表：{stats['by_sheet']}")
    print(f"[INFO] 按机组：{stats['by_unit']}")
    print(f"[INFO] 按分类：{stats['by_category']}")

    if args.dry_run:
        print("[DRY-RUN] 未写入数据库")
        return

    # tag_name 唯一键，upsert（status/deleted 由 ORM default 定义，原生 SQL 需显式提供）
    sql = text(
        """
        INSERT INTO scada_points (
            tag_name, node_id, value_type, unit, description,
            sim_base, sim_amplitude, sim_period_sec, enabled,
            status, deleted,
            tag_id, equipment_id, point_category,
            min_value, max_value, hi, lo, hihi, lolo,
            alarm_group, his_rec_interval, io_access
        ) VALUES (
            :tag_name, :node_id, :value_type, :unit, :description,
            :sim_base, :sim_amplitude, :sim_period_sec, :enabled,
            1, 0,
            :tag_id, :equipment_id, :point_category,
            :min_value, :max_value, :hi, :lo, :hihi, :lolo,
            :alarm_group, :his_rec_interval, :io_access
        )
        ON CONFLICT(tag_name) DO UPDATE SET
            node_id=excluded.node_id,
            value_type=excluded.value_type,
            unit=excluded.unit,
            description=excluded.description,
            tag_id=excluded.tag_id,
            point_category=excluded.point_category,
            min_value=excluded.min_value,
            max_value=excluded.max_value,
            hi=excluded.hi,
            lo=excluded.lo,
            hihi=excluded.hihi,
            lolo=excluded.lolo,
            alarm_group=excluded.alarm_group,
            his_rec_interval=excluded.his_rec_interval,
            io_access=excluded.io_access,
            updated_at=CURRENT_TIMESTAMP
        """
    )

    with engine.begin() as conn:
        conn.execute(sql, rows_to_insert)

    print(f"[OK] 已导入/更新 {len(rows_to_insert)} 条测点到 {args.db}")


if __name__ == "__main__":
    main()
