"""把主站点位表同步到 SCADA Gateway 的 gw_points（真机 OPC UA 联调前置步骤）。

主站 `scada_points`（点位表，1377 条）是现场真实点表，gateway 订阅需要的是自己的
`gw_points`。本脚本按 `tag_name` 做幂等 upsert，只搬运订阅必需字段，不触碰主站数据。

用法（在 scada-gateway 目录下执行，确保读到 .env 里的 DATABASE_URL）：

    cd scada-gateway
    python tools/sync_points_from_main.py --dry-run       # 先看会改多少
    python tools/sync_points_from_main.py                 # 正式同步（source=opcua）
    python tools/sync_points_from_main.py --include-disabled --prune

参数：
    --main-db        主站 SQLite 路径，默认 <repo>/backend/water_ops.db
    --gateway-db     覆盖 gateway 数据库路径（默认取 .env DATABASE_URL）
    --source         gw_points.source 写入值，真机联调用 opcua（默认），本地仿真用 mock
    --include-disabled  连主站未启用的点一起同步
    --prune          把 gateway 中本脚本管辖但主站已不存在的点置为 enabled=0
    --dry-run        只统计不落库
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GATEWAY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAIN_DB = REPO_ROOT / "backend" / "water_ops.db"

# 主站 value_type 有 number/float/bool，gateway 只认 number/bool/string
VALUE_TYPE_MAP = {
    "number": "number",
    "float": "number",
    "double": "number",
    "int": "number",
    "integer": "number",
    "bool": "bool",
    "boolean": "bool",
    "string": "string",
}


def load_main_points(main_db: Path, include_disabled: bool) -> dict[str, dict]:
    """读取主站点位表，返回 {tag_name: 点内容}。"""
    if not main_db.exists():
        raise SystemExit(f"主站数据库不存在：{main_db}")

    sql = (
        "SELECT tag_name, node_id, value_type, unit, description,"
        " sim_base, sim_amplitude, sim_period_sec, enabled"
        " FROM scada_points WHERE deleted = 0"
    )
    if not include_disabled:
        sql += " AND enabled = 1"
    sql += " ORDER BY id"

    con = sqlite3.connect(main_db)
    try:
        rows = con.execute(sql).fetchall()
    finally:
        con.close()

    points: dict[str, dict] = {}
    skipped = 0
    for tag, node, vtype, unit, desc, sb, sa, sp, enabled in rows:
        if not tag or not node:
            skipped += 1
            continue
        points[str(tag)] = {
            "tag_name": str(tag),
            "node_id": str(node),
            "value_type": VALUE_TYPE_MAP.get(str(vtype or "number").lower(), "number"),
            "unit": (unit or "")[:32] or None,
            "description": (desc or "")[:255] or None,
            "sim_base": float(sb or 0),
            "sim_amplitude": float(sa or 1),
            "sim_period_sec": float(sp or 60),
            "enabled": 1 if int(enabled or 0) else 0,
        }
    if skipped:
        print(f"跳过缺 tag_name/node_id 的点 {skipped} 条")
    return points


def main() -> int:
    parser = argparse.ArgumentParser(description="主站点位表 → gateway gw_points")
    parser.add_argument("--main-db", default=str(DEFAULT_MAIN_DB))
    parser.add_argument("--gateway-db", default=None)
    parser.add_argument("--source", default="opcua", choices=["opcua", "mock"])
    parser.add_argument("--include-disabled", action="store_true")
    parser.add_argument("--prune", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    main_db = Path(args.main_db).expanduser().resolve()
    points = load_main_points(main_db, args.include_disabled)
    print(f"主站启用点位 {len(points)} 条（{main_db}）")

    if args.gateway_db:
        os.environ["DATABASE_URL"] = f"sqlite:///{Path(args.gateway_db).expanduser().resolve()}"

    sys.path.insert(0, str(GATEWAY_ROOT))
    from app.core.config import get_settings  # noqa: E402
    from app.core.database import SessionLocal, init_db  # noqa: E402
    from app.store.models import GwPoint  # noqa: E402

    settings = get_settings()
    print(f"gateway 数据库 {settings.database_url}，source={args.source}")

    if args.dry_run:
        print(f"[dry-run] 将 upsert {len(points)} 条到 gw_points（未落库）")
        if args.prune:
            print("[dry-run] --prune 已启用：主站不存在的点会被置为 enabled=0")
        return 0

    init_db()
    db = SessionLocal()
    created = updated = unchanged = disabled = 0
    try:
        existing = {p.tag_name: p for p in db.query(GwPoint).all()}
        for idx, (tag, data) in enumerate(points.items(), 1):
            row = existing.get(tag)
            if row is None:
                db.add(GwPoint(source=args.source, **data))
                created += 1
            else:
                changed = (
                    row.node_id != data["node_id"]
                    or row.value_type != data["value_type"]
                    or row.unit != data["unit"]
                    or row.description != data["description"]
                    or row.source != args.source
                    or int(row.enabled) != data["enabled"]
                )
                if changed:
                    row.node_id = data["node_id"]
                    row.value_type = data["value_type"]
                    row.unit = data["unit"]
                    row.description = data["description"]
                    row.source = args.source
                    row.sim_base = data["sim_base"]
                    row.sim_amplitude = data["sim_amplitude"]
                    row.sim_period_sec = data["sim_period_sec"]
                    row.enabled = data["enabled"]
                    updated += 1
                else:
                    unchanged += 1
            if idx % 200 == 0:
                db.commit()

        if args.prune:
            for tag, row in existing.items():
                if tag not in points and row.source == args.source and int(row.enabled):
                    row.enabled = 0
                    disabled += 1

        db.commit()
    finally:
        db.close()

    print(f"完成：新增 {created}，更新 {updated}，未变 {unchanged}，停用 {disabled}")
    print("下一步：gateway 配置 OPCUA_ENDPOINT 后调用 POST /api/v1/runtime/start")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
