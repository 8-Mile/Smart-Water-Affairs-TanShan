"""按 SCADA 点位表（DZZDB.xls）铺开大张庄泵站设备台账，并把点位绑定到设备。

- 设备粒度：设备级（每台泵/阀/柜/闸门/启闭机独立一条）
- 已存在的设备（如 5 台机组及其子设备、闸门孔位）按 code 跳过，不重复插入
- 点位绑定：scada_points.equipment_id 仅在该点尚未绑定时写入
- 可重复执行（幂等）

用法：
    backend/.venv/bin/python backend/tools/seed_equipment_ledger.py
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "water_ops.db"

# 设备类型：1 主机组类 2 闸门类 3 电气类 4 辅机类 5 仪器仪表类
T_UNIT, T_GATE, T_ELEC, T_AUX, T_METER = 1, 2, 3, 4, 5


def u(n: int) -> str:
    return f"DZZ-UNIT-0{n}"


# (code, name, type_id, parent_code, remark, [tag LIKE 前缀...])
# 顺序即绑定优先级：先匹配到的设备优先占用点位
DEVICES: list[tuple[str, str, int, str | None, str, list[str]]] = []


# ---------- 1. 机组子设备：叶片调节机构（图二铭牌） ----------
for n in range(1, 6):
    DEVICES.append((
        f"{u(n)}-调节",
        f"{n}号机组-叶片调节机构",
        T_AUX,
        u(n),
        "水泵叶片调节机构；型号 BYKD-BD-4-25-TS01；额定压力 4.0MPa；额定流量 25L/min；"
        "工作行程 80mm；执行标准 GB/T9652-2007；出厂编号 2019YB09（2019.9）；"
        "厂家：天津市天骄水电成套设备有限公司",
        [f"TJ{n}号叶片开度", f"M{n}后台调角", f"M{n}叶片角度正8度", f"M{n}叶片角度负6度"],
    ))

# ---------- 2. 机组子设备点位补绑（电机/励磁/水泵/轴承/开关柜已存在） ----------
UNIT_BIND: list[tuple[str, int, list[str]]] = []
for n in range(1, 6):
    UNIT_BIND += [
        (f"{u(n)}-开关", T_ELEC, [f"M{n}电机柜", f"M{n}电机断路器", f"M{n}后台合{n}#电机断路器",
                                 f"M{n}后台分{n}#电机断路器", f"WXCW2_{n}#电机柜"]),
        (f"{u(n)}-励磁", T_ELEC, [f"M{n}励磁", f"M{n}后台励磁"]),
        (f"{u(n)}-轴承", T_AUX, [f"M{n}上导轴瓦", f"M{n}下导轴瓦", f"M{n}推力轴瓦",
                                f"M{n}上油池", f"M{n}下油池", f"M{n}上油槽", f"M{n}下油槽",
                                f"M{n}油槽油位正常"]),
        (f"{u(n)}-水泵", T_UNIT, [f"M{n}叶片角度", f"M{n}真空总管压力", f"M{n}真空破坏故障"]),
        (f"{u(n)}-电机", T_ELEC, [f"M{n}"]),
    ]

# ---------- 3. 辅机：真空泵 / 真空破坏阀 / 技术供水 / 排水泵 / 自来水阀 ----------
for n in (1, 2):
    DEVICES.append((
        f"DZZ-AUX-VP-0{n}", f"{n}#真空泵", T_AUX, None,
        "抽真空系统真空泵（配机组真空破坏装置）",
        [f"FJ{n}#真空泵", f"FJ后台启动{n}号真空泵", f"FJ后台停止{n}号真空泵",
         f"FJ后台开{n}#真空泵冷却水", f"FJ后台关{n}#真空泵冷却水"],
    ))
for n in range(1, 6):
    DEVICES.append((
        f"DZZ-AUX-VBV-{n:02d}", f"{n}#真空破坏阀", T_AUX, None,
        f"{n}号机组真空破坏阀及真空支管电动阀",
        [f"FJ{n}#真空破坏阀", f"FJ{n}#抽真空完成", f"FJ{n}#真空支管电动阀",
         f"FJ后台开{n}号真空破坏阀", f"FJ后台关{n}号真空破坏阀",
         f"FJ后台开{n}号真空支关电动阀", f"FJ后台关{n}号真空支关电动阀"],
    ))
for n in range(1, 4):
    DEVICES.append((
        f"DZZ-AUX-TWP-0{n}", f"{n}#技术供水泵", T_AUX, None, "机组技术供水泵",
        [f"FJ{n}#技术供水泵", f"FJ后台启动{n}号技术供水泵", f"FJ后台停止{n}号技术供水泵"],
    ))
for n in range(1, 6):
    DEVICES.append((
        f"DZZ-AUX-TWV-{n:02d}", f"{n}#技术供水阀", T_AUX, None, f"{n}号机组技术供水电动阀",
        [f"FJ{n}#技术供水阀", f"FJ后台开{n}号技术供水阀", f"FJ后台关{n}号技术供水阀"],
    ))
for n in range(1, 5):
    DEVICES.append((
        f"DZZ-AUX-DP-0{n}", f"{n}#排水泵", T_AUX, None, "厂房集水井排水泵",
        [f"FJ{n}#排水泵", f"FJ后台启动{n}号排水泵", f"FJ后台停止{n}号排水泵"],
    ))
DEVICES.append((
    "DZZ-AUX-WSV-01", "自来水供水电动阀", T_AUX, None, "自来水供水电动阀",
    ["FJ自来水供水电动阀", "FJ后台开自来水", "FJ后台关自来水"],
))

# ---------- 4. 仪表 ----------
# 前池/后池水位沿用台账已有的水位监测站（DZZ-LVL-FRONT/BACK），此处只补点位绑定
DEVICES += [
    ("DZZ-MET-CORR", "集水廊道水位计", T_METER, None, "集水廊道水位监测",
     ["FJ集水廊道水位"]),
    ("DZZ-MET-TWP", "技术供水压力表", T_METER, None, "技术供水干管压力",
     ["FJ技术供水干管压力"]),
    ("DZZ-MET-OIL", "油系统压力开关", T_METER, None, "油系统油压监视",
     ["FJ油系统油压正常"]),
]

# ---------- 5. 启闭机 ----------
for n in range(1, 7):
    DEVICES.append((
        f"DZZ-QBJ-0{n}", f"{n}#启闭机", T_GATE, None, "闸门卷扬式启闭机",
        [f"QWJ{n}_"],
    ))
for gate_no, side in (("1", "左"), ("1", "右"), ("2", "左"), ("2", "右")):
    DEVICES.append((
        f"DZZ-QBJ-G{gate_no}{side}", f"闸门{gate_no}{side}启闭机", T_GATE, None,
        "闸门启闭机（荷重/开度/上下限监视）",
        [f"闸门{gate_no}{side}", f"{side}荷重{gate_no}"],
    ))

# ---------- 6. 净水系统 ----------
DEVICES += [
    ("DZZ-WTP-PUMP-01", "1#原水泵", T_AUX, None, "净水系统原水泵", ["A1", "A2", "A19"]),
    ("DZZ-WTP-PUMP-02", "2#原水泵", T_AUX, None, "净水系统原水泵", ["A3", "A4", "A20"]),
    ("DZZ-WTP-PUMP-03", "3#原水泵", T_AUX, None, "净水系统原水泵", ["A5", "A6", "A21"]),
    ("DZZ-WTP-BW-01", "1#反洗泵", T_AUX, None, "砂滤反洗泵", ["A7", "A8", "A22"]),
    ("DZZ-WTP-BW-02", "2#反洗泵", T_AUX, None, "砂滤反洗泵", ["A9", "A10", "A23"]),
    ("DZZ-WTP-BFV-01", "1#反洗阀", T_AUX, None, "砂滤反洗阀", ["A11", "A14", "A27", "A34", "A37"]),
    ("DZZ-WTP-BFV-02", "2#反洗阀", T_AUX, None, "砂滤反洗阀", ["A12", "A15", "A28", "A35", "A38"]),
    ("DZZ-WTP-OWV-01", "出水阀", T_AUX, None, "净水系统出水阀", ["A13", "A26", "A36", "A48", "A49", "A50", "A51"]),
    ("DZZ-WTP-PWV-01", "产水阀", T_AUX, None, "净水系统产水阀", ["A16", "A60", "A61", "A62", "A63"]),
    ("DZZ-WTP-FILT-01", "1#砂滤", T_AUX, None, "砂滤器", ["A29"]),
    ("DZZ-WTP-FILT-02", "2#砂滤", T_AUX, None, "砂滤器", ["A30"]),
    ("DZZ-WTP-TANK-01", "缓冲水箱", T_AUX, None, "缓冲水箱及液位控制", ["A31", "A32", "A39", "A40", "A41", "A42", "A43", "A44", "A45"]),
    ("DZZ-WTP-TANK-02", "泵房水箱", T_AUX, None, "泵房水箱及液位控制", ["A33", "A57", "A58", "A59"]),
    ("DZZ-WTP-TURB", "出水浊度仪", T_METER, None, "出水浊度在线监测", ["A52", "A53", "A54", "A55", "A56", "A25"]),
    ("DZZ-WTP-CTRL", "净水系统控制柜", T_ELEC, None, "净水系统 PLC 控制柜（报警/复位/缺水保护）",
     ["A17", "A18", "A24", "A46", "A47"]),
]

# ---------- 7. 电气开关柜（柜级） ----------
_ELEC = [
    ("EL-35IN-01", "1#35KV进线柜", ["GY1#35KV进线柜"]),
    ("EL-35TR-01", "1#35KV主变柜", ["GY1#35KV主变柜"]),
    ("EL-35AJ-01", "1#35KV架空兼左联柜", ["GY1#35KV架空兼左联柜"]),
    ("EL-35IN-02", "2#35KV进线柜", ["GY2#35KV进线柜"]),
    ("EL-35TR-02", "2#35KV主变柜", ["GY2#35KV主变柜"]),
    ("EL-35AJ-02", "2#35KV架空兼左联柜", ["GY2#35KV架空兼左联柜"]),
    ("EL-35ML", "35KV母联柜", ["GY35KV母联柜"]),
    ("EL-35ST", "35KV站变柜", ["GY35KV站变柜"]),
    ("EL-35FB", "35KV厂变进线柜", ["GY35KV厂变进线"]),
    ("EL-6IN-01", "1#6KV受总柜", ["GY1#6KV受总柜"]),
    ("EL-6PT-01", "1#6KV PT柜", ["GY1#6KVPT柜"]),
    ("EL-6ST-01", "1#6KV站变柜", ["GY1#6KV站变柜"]),
    ("EL-6WP-01", "1#6KV水厂出线柜", ["GY1#6KV水厂出线柜", "GY1#6kv水厂出线柜"]),
    ("EL-6IN-02", "2#6KV受总柜", ["GY2#6KV受总柜"]),
    ("EL-6PT-02", "2#6KV PT柜", ["GY2#6KVPT柜"]),
    ("EL-6ST-02", "2#6KV站变柜", ["GY2#6KV站变柜"]),
    ("EL-6WP-02", "2#6KV水厂出线柜", ["GY2#6KV水厂出线柜"]),
    ("EL-6ML", "6KV母联柜", ["GY6KV母联柜"]),
    ("EL-6XB", "6KV院内箱变出线柜", ["GY6KV院内箱变出线柜"]),
    ("EL-6ST-03", "6KV 2#站变进线柜", ["GY6KV2#站变进线"]),
    ("EL-DC", "直流屏", ["GY1#直流屏"]),
    ("EL-LV", "低压出线柜", ["GY1#低压出线"]),
    ("EL-UPS", "UPS出线柜", ["GYUPS出线"]),
    ("EL-MOT-01", "1#电机出线柜", ["GY3#电机出线柜", "WXCW2_1#电机柜"]),
    ("EL-MOT-02", "2#电机出线柜", ["GY4#电机出线柜", "WXCW2_2#电机柜"]),
    ("EL-MOT-03", "3#电机出线柜", ["GY5#电机出线柜", "WXCW2_3#电机柜"]),
    ("EL-EXC-01", "1#机励磁电源柜", ["GY3#机励磁"]),
    ("EL-EXC-02", "2#机励磁电源柜", ["GY4#机励磁"]),
    ("EL-EXC-03", "3#机励磁电源柜", ["GY5#机励磁"]),
    ("EL-WXCW-01", "1#主变出线柜", ["WXCW1_1#主变出线柜"]),
    ("EL-WXCW-02", "1#受总柜", ["WXCW1_1#受总柜"]),
    ("EL-WXCW-03", "2#主变出线柜", ["WXCW1_2#主变出线柜"]),
    ("EL-WXCW-04", "2#受总柜", ["WXCW1_2#受总柜"]),
    ("EL-WXCW-05", "35KV站变出线柜", ["WXCW1_35KV站变出线柜"]),
    ("EL-WXCW-06", "10KV联络柜", ["WXCW1_联络柜"]),
    ("EL-WXCW-07", "1#水厂出线柜", ["WXCW2_1#水厂出线柜"]),
    ("EL-WXCW-08", "2#水厂出线柜", ["WXCW2_2#水厂出线柜"]),
    ("EL-WXCW-09", "4#电机柜", ["WXCW2_4#电机柜"]),
    ("EL-WXCW-10", "5#电机柜", ["WXCW2_5#电机柜"]),
    ("EL-WXCW-11", "小变电站出线柜", ["WXCW2_小变电站出线柜"]),
    ("EL-WXCW-12", "10KV母联柜", ["WXCW2_母联柜"]),
    ("EL-WXCW-13", "1#进线柜", ["WXCW2_1#进线柜"]),
    ("EL-WXCW-14", "2#进线柜", ["WXCW2_2#进线柜"]),
    ("EL-WXCW-15", "1#站用变柜", ["WXCW2_1#站用变"]),
    ("EL-WXCW-16", "2#站用变柜", ["WXCW2_2#站用变"]),
]
for code, name, pats in _ELEC:
    DEVICES.append((f"DZZ-{code}", name, T_ELEC, None, "按 SCADA 点位表建立的高压/低压开关柜", pats))


def main() -> None:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    code_to_id = {r["code"]: r["id"] for r in cur.execute("select id, code from eq_equipment")}
    created = 0
    for code, name, type_id, parent_code, remark, _ in DEVICES:
        if code in code_to_id:
            cur.execute(
                "update eq_equipment set name=?, type_id=?, remark=?, updated_at=CURRENT_TIMESTAMP where id=?",
                (name, type_id, remark, code_to_id[code]),
            )
            continue
        parent_id = code_to_id.get(parent_code) if parent_code else None
        cur.execute(
            """insert into eq_equipment
               (name, code, type_id, parent_id, running_status, maintain_status,
                continuous_run_hours, remark, status, deleted, created_at, updated_at)
               values (?,?,?,?, 'stopped', 'normal', 0, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
            (name, code, type_id, parent_id, remark),
        )
        code_to_id[code] = cur.lastrowid
        created += 1

    # 点位绑定：按顺序占用未绑定的点
    bind_rules = [(c, pats) for c, _, _, _, _, pats in DEVICES]
    bind_rules += [(c, pats) for c, _, pats in UNIT_BIND]
    bind_rules += [
        ("DZZ-LVL-FRONT", ["FJ前池水位"]),
        ("DZZ-LVL-BACK", ["FJ后池水位"]),
    ]
    # 先把本脚本负责的点位解绑，再按优先级重绑，保证可重复执行且归属正确
    cur.execute(
        """update scada_points set equipment_id=null
           where tag_name like 'M%' or tag_name like 'GY%' or tag_name like 'WXCW%'
              or tag_name like 'FJ%' or tag_name like 'TJ%' or tag_name like 'QWJ%'
              or tag_name glob 'A[0-9]*'"""
    )
    bound = 0
    for code, pats in bind_rules:
        eid = code_to_id.get(code)
        if not eid:
            continue
        for p in pats:
            if p.startswith("A") and p[1:].isdigit():
                # A1..A63 这类短点名用精确匹配
                cur.execute(
                    "update scada_points set equipment_id=? where tag_name=? and equipment_id is null",
                    (eid, p),
                )
            else:
                cur.execute(
                    "update scada_points set equipment_id=? where tag_name like ? and equipment_id is null",
                    (eid, f"%{p}%"),
                )
            bound += cur.rowcount

    con.commit()
    total = cur.execute("select count(*) from eq_equipment where deleted=0").fetchone()[0]
    linked = cur.execute("select count(*) from scada_points where equipment_id is not null").fetchone()[0]
    allp = cur.execute("select count(*) from scada_points").fetchone()[0]
    print(f"新增设备 {created} 台，台账合计 {total} 台")
    print(f"点位绑定 {bound} 个，已绑定点位 {linked}/{allp}")


if __name__ == "__main__":
    main()
