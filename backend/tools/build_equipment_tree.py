"""
创建设备树结构：
- 机组 → 电机/励磁系统/水泵/轴承组/开关柜（5个子设备）
- 闸门 → 各闸孔子设备
并重新分配测点、重新生成告警规则到子设备。
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.models.equipment import Equipment
from app.models.scada import ScadaPoint
from app.models.alarm import AlarmRule, Alarm

TYPE_ELECTRIC = 3   # 电气类
TYPE_PUMP = 1       # 主机组类
TYPE_AUX = 4        # 辅机类
TYPE_GATE = 2       # 闸门类


def classify_unit_point(tag_name: str, n: int) -> str:
    """根据测点名返回子设备名称。"""
    prefix = f"M{n}"
    t = tag_name
    # 励磁系统
    if t.startswith(f"{prefix}励磁"):
        return "励磁系统"
    # 水泵
    if "叶片" in t or "真空" in t:
        return "水泵"
    # 轴承组
    if "温度" in t or "油槽" in t or "油池" in t or "冷却水" in t or "油位" in t:
        return "轴承组"
    # 电机
    if (t.startswith(f"{prefix}电机") or t == f"{prefix}机组运行时间"
            or "断路器" in t or "电机柜" in t or "电机综保" in t
            or "电机PLC" in t or "电机保护" in t or "电机就地" in t):
        return "电机"
    # 开关柜（后台操作、机组状态等）
    return "开关柜"


UNIT_SUB_DEFS = [
    {"name": "电机", "type_id": TYPE_ELECTRIC},
    {"name": "励磁系统", "type_id": TYPE_ELECTRIC},
    {"name": "水泵", "type_id": TYPE_PUMP},
    {"name": "轴承组", "type_id": TYPE_AUX},
    {"name": "开关柜", "type_id": TYPE_ELECTRIC},
]


def build_unit_tree(db, unit: Equipment):
    n = unit.unit_no
    sub_ids = {}
    for sd in UNIT_SUB_DEFS:
        sub = Equipment(
            name=f"{unit.name}-{sd['name']}",
            code=f"{unit.code}-{sd['name'][:2].upper()}",
            type_id=sd["type_id"],
            parent_id=unit.id,
            running_status=unit.running_status,
            location_id=unit.location_id,
        )
        db.add(sub)
        db.flush()
        sub_ids[sd["name"]] = sub.id

    points = db.query(ScadaPoint).filter(
        ScadaPoint.equipment_id == unit.id, ScadaPoint.deleted == 0
    ).all()
    for p in points:
        sub_name = classify_unit_point(p.tag_name, n)
        p.equipment_id = sub_ids[sub_name]

    return sub_ids


def build_gate_tree(db, gate: Equipment):
    points = db.query(ScadaPoint).filter(
        ScadaPoint.equipment_id == gate.id, ScadaPoint.deleted == 0
    ).all()

    hole_pattern = re.compile(r"^(DHXZ|ZQZ|PLZ)(\d+)孔")
    holes = {}
    for p in points:
        m = hole_pattern.match(p.tag_name)
        if m:
            hole_key = f"{m.group(1)}{m.group(2)}孔"
            holes.setdefault(hole_key, []).append(p)

    sub_ids = {}
    for hole_key, hole_points in holes.items():
        sub = Equipment(
            name=f"{gate.name}-{hole_key}",
            code=f"{gate.code}-{hole_key}",
            type_id=TYPE_GATE,
            parent_id=gate.id,
            running_status=gate.running_status,
            location_id=gate.location_id,
        )
        db.add(sub)
        db.flush()
        sub_ids[hole_key] = sub.id
        for p in hole_points:
            p.equipment_id = sub.id

    return sub_ids


def main():
    db = SessionLocal()
    try:
        units = db.query(Equipment).filter(
            Equipment.deleted == 0, Equipment.unit_no.isnot(None)
        ).order_by(Equipment.unit_no).all()
        gates = db.query(Equipment).filter(
            Equipment.deleted == 0, Equipment.type_id == TYPE_GATE
        ).all()

        print(f"机组: {len(units)} 台, 闸门: {len(gates)} 个")

        all_sub_ids = []
        for u in units:
            sub_ids = build_unit_tree(db, u)
            all_sub_ids.extend(sub_ids.values())
            print(f"  {u.name}: {len(sub_ids)} 个子设备")

        for g in gates:
            sub_ids = build_gate_tree(db, g)
            all_sub_ids.extend(sub_ids.values())
            print(f"  {g.name}: {len(sub_ids)} 个闸孔子设备")

        # 清理旧告警规则和记录
        db.query(AlarmRule).delete()
        db.query(Alarm).delete()
        db.flush()
        print("已清理旧告警规则和记录")

        # 为测点生成告警规则
        all_equip_ids = set(all_sub_ids) | {e.id for e in units} | {e.id for e in gates}
        points = db.query(ScadaPoint).filter(
            ScadaPoint.deleted == 0,
            ScadaPoint.equipment_id.in_(all_equip_ids),
        ).all()
        print(f"共 {len(points)} 个测点")

        rules_created = 0
        for p in points:
            # 温度测点 → Hi/HiHi
            if p.point_category == "temperature":
                db.add_all([
                    AlarmRule(name=f"{p.tag_name}温度高Hi", equipment_id=p.equipment_id,
                              point_refs=str(p.id), alarm_type_code="TEMP_ALERT",
                              alarm_level=2, trigger_logic="any", compare_op="gt",
                              threshold="100", enabled=1),
                    AlarmRule(name=f"{p.tag_name}温度高高HiHi", equipment_id=p.equipment_id,
                              point_refs=str(p.id), alarm_type_code="TEMP_ALERT",
                              alarm_level=3, trigger_logic="any", compare_op="gt",
                              threshold="105", enabled=1),
                ])
                rules_created += 2
            # 电压越限
            elif p.point_category == "electrical" and "电压" in p.tag_name:
                db.add(AlarmRule(name=f"{p.tag_name}电压越限", equipment_id=p.equipment_id,
                                 point_refs=str(p.id), alarm_type_code="ELEC_ALERT",
                                 alarm_level=2, trigger_logic="any", compare_op="gt",
                                 threshold="6.6", enabled=1))
                rules_created += 1
            # 电流越限
            elif p.point_category == "electrical" and "电流" in p.tag_name:
                db.add(AlarmRule(name=f"{p.tag_name}电流越限", equipment_id=p.equipment_id,
                                 point_refs=str(p.id), alarm_type_code="ELEC_ALERT",
                                 alarm_level=2, trigger_logic="any", compare_op="gt",
                                 threshold="66", enabled=1))
                rules_created += 1
            # 水位异常
            elif "水位" in p.tag_name or "液位" in p.tag_name:
                db.add(AlarmRule(name=f"{p.tag_name}液位异常", equipment_id=p.equipment_id,
                                 point_refs=str(p.id), alarm_type_code="LEVEL_ABN",
                                 alarm_level=2, trigger_logic="any", compare_op="gt",
                                 threshold="4.5", enabled=1))
                rules_created += 1

        db.commit()
        print(f"\n完成: {len(all_sub_ids)} 个子设备, {rules_created} 条告警规则")

    except Exception as e:
        db.rollback()
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
