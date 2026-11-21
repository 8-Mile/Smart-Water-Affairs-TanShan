"""
日报 ETL 脚本：把 5 份机组运行日报（x1~x5运行日报1.xls）导入 scada_tag_data 历史时序表。

用法：
    python tools/import_daily_reports.py [--dir <日报目录>] [--dry-run] [--db <db 路径>]

功能：
    - 读取 5 份日报（x1=1号机组 … x5=5号机组），同构 sheet=Report2
    - 按列号映射到测点 tag_name（前/后池水位为公共测点，其余按机组号 M{n} 前缀）
    - 时间戳：日报日期（r2c1）+ 序号等间隔分布（86400s / 552 条）
    - 批量写入 scada_tag_data（约 5 × 552 × 23 ≈ 6.3 万条）
    - 重复执行安全：先按 tag_name 与 ts_ms 去重，再 upsert

注意：
    - 运行日报是真 BIFF .xls，用 xlrd 读取（非 openpyxl）
    - 列映射固定按列号（日报模板固定，列顺序稳定）
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402

# 日报列号（0-based）→ 测点 tag_name 模板（{n} 替换为机组号）
# 列 0 是时间序号，不入库
COL_TAG_MAP: dict[int, str] = {
    1: "FJ前池水位",          # 公共
    2: "FJ后池水位",          # 公共
    3: "M{n}电机UAB",         # 定子电压
    4: "M{n}电机IA",          # 定子电流
    5: "M{n}电机P",           # 有功功率
    6: "M{n}电机Q",           # 无功功率
    7: "M{n}电机COS",         # 功率因数
    8: "M{n}励磁电压",
    9: "M{n}励磁电流",
    10: "M{n}叶片角度",
    11: "M{n}定子绕组A相温度1",
    12: "M{n}定子绕组A相温度2",
    13: "M{n}定子绕组B相温度1",
    14: "M{n}定子绕组B相温度2",
    15: "M{n}定子绕组C相温度1",
    16: "M{n}定子绕组C相温度2",
    17: "M{n}上导轴瓦温度1",
    18: "M{n}上导轴瓦温度2",
    19: "M{n}下导轴瓦温度1",
    20: "M{n}下导轴瓦温度2",
    21: "M{n}推力轴瓦温度1",
    22: "M{n}推力轴瓦温度2",
    23: "M{n}上油池温度",
    24: "M{n}下油池温度",
}

# 5 份日报 → 机组号
REPORT_UNITS = {"x1": 1, "x2": 2, "x3": 3, "x4": 4, "x5": 5}


def parse_float(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    # 日报中 0.0 是有效值（停机时电流/功率为 0），不过滤
    return f


def main():
    ap = argparse.ArgumentParser(description="导入机组运行日报到 scada_tag_data")
    ap.add_argument(
        "--dir",
        default="/Users/8-mile/Desktop/项目集合/天津项目集合/大张庄管理处泵站-陈/数据来源/历史报表存档",
        help="日报目录",
    )
    ap.add_argument("--db", default=str(BACKEND_DIR / "water_ops.db"), help="目标 SQLite 数据库路径")
    ap.add_argument("--dry-run", action="store_true", help="只统计不写入")
    args = ap.parse_args()

    import xlrd

    report_dir = Path(args.dir)
    if not report_dir.exists():
        sys.exit(f"[ERR] 日报目录不存在: {report_dir}")

    # 预加载测点 node_id，避免逐行查库
    with engine.connect() as c:
        node_map = dict(c.execute(text("SELECT tag_name, node_id FROM scada_points")).fetchall())
    print(f"[INFO] 已加载 {len(node_map)} 个测点的 node_id")

    # 校验映射的 tag_name 是否都存在
    missing_tags = set()
    for n in range(1, 6):
        for col, tpl in COL_TAG_MAP.items():
            tn = tpl.format(n=n) if "{n}" in tpl else tpl
            if tn not in node_map:
                missing_tags.add(tn)
    if missing_tags:
        print(f"[WARN] 以下测点在 scada_points 中不存在（将跳过）: {sorted(missing_tags)}")
    else:
        print("[INFO] 所有映射测点均存在于 scada_points")

    all_rows: list[dict] = []
    stats = {"files": 0, "data_rows": 0, "records": 0, "skipped": 0}

    for fname, unit_no in REPORT_UNITS.items():
        xls_path = report_dir / f"{fname}运行日报1.xls"
        if not xls_path.exists():
            print(f"[WARN] 文件不存在，跳过: {xls_path}")
            continue

        wb = xlrd.open_workbook(str(xls_path))
        ws = wb.sheet_by_name("Report2")
        stats["files"] += 1

        # 日期在 r2c1
        date_str = str(ws.cell_value(2, 1)).strip()
        try:
            base_date = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            print(f"[WARN] {fname} 日期解析失败: {date_str!r}，跳过")
            continue

        # 552 条数据等间隔分布在 86400 秒内
        n_data = ws.nrows - 5  # r5..r556
        interval_sec = 86400.0 / n_data if n_data > 0 else 0
        print(f"[INFO] {fname}(机组{unit_no}) 日期={date_str} 数据行数={n_data} 间隔={interval_sec:.2f}s")

        for i in range(n_data):
            row_idx = 5 + i
            row = [ws.cell_value(row_idx, c) for c in range(ws.ncols)]
            # 时间戳 = 基准日期 00:00 + i * interval
            ts = base_date + timedelta(seconds=i * interval_sec)
            ts_ms = int(ts.timestamp() * 1000)

            for col, tpl in COL_TAG_MAP.items():
                tn = tpl.format(n=unit_no) if "{n}" in tpl else tpl
                if tn in missing_tags:
                    stats["skipped"] += 1
                    continue
                val = parse_float(row[col]) if col < len(row) else None
                if val is None:
                    stats["skipped"] += 1
                    continue
                all_rows.append(
                    {
                        "tag_name": tn,
                        "node_id": node_map.get(tn, "PLC1"),
                        "value_type": "number",
                        "value_num": val,
                        "value_bool": None,
                        "value_str": None,
                        "status_code": 0,
                        "status_name": "Good",
                        "ts_ms": ts_ms,
                    }
                )
                stats["records"] += 1
            stats["data_rows"] += 1

    print(f"[INFO] 解析完成：{stats['files']} 文件，{stats['data_rows']} 数据行，{stats['records']} 条时序记录，跳过 {stats['skipped']}")

    if args.dry_run:
        print("[DRY-RUN] 未写入数据库")
        return

    # upsert：(tag_name, ts_ms) 唯一
    sql = text(
        """
        INSERT INTO scada_tag_data (
            tag_name, node_id, value_type, value_num, value_bool, value_str,
            status_code, status_name, ts_ms, created_at
        ) VALUES (
            :tag_name, :node_id, :value_type, :value_num, :value_bool, :value_str,
            :status_code, :status_name, :ts_ms, CURRENT_TIMESTAMP
        )
        ON CONFLICT(tag_name, ts_ms) DO UPDATE SET
            value_num=excluded.value_num,
            node_id=excluded.node_id,
            status_code=excluded.status_code,
            status_name=excluded.status_name
        """
    )

    # 检查是否有 (tag_name, ts_ms) 唯一索引，没有则建
    with engine.begin() as conn:
        idx = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='scada_tag_data' AND name='idx_tag_ts'")
        ).fetchone()
        if not idx:
            print("[INFO] 创建唯一索引 idx_tag_ts(tag_name, ts_ms)")
            conn.execute(text("CREATE UNIQUE INDEX idx_tag_ts ON scada_tag_data(tag_name, ts_ms)"))

    # 分批写入（每批 5000）
    batch_size = 5000
    with engine.begin() as conn:
        for i in range(0, len(all_rows), batch_size):
            batch = all_rows[i : i + batch_size]
            conn.execute(sql, batch)
            print(f"[INFO] 已写入 {min(i + batch_size, len(all_rows))}/{len(all_rows)}")

    print(f"[OK] 已导入 {len(all_rows)} 条时序记录到 {args.db}")


if __name__ == "__main__":
    main()
