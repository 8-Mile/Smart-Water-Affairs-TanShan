"""种子测点（对齐主站 DEFAULT_SCADA_POINTS）。"""

from sqlalchemy.orm import Session

from app.store.models import GwPoint

DEFAULT_POINTS = [
    {
        "tag_name": "PLC1.Flow",
        "node_id": "ns=1;i=686",
        "value_type": "number",
        "unit": "m³/h",
        "description": "1# 流量",
        "sim_base": 120,
        "sim_amplitude": 15,
        "sim_period_sec": 30,
    },
    {
        "tag_name": "PLC2.Flow",
        "node_id": "ns=1;i=681",
        "value_type": "number",
        "unit": "m³/h",
        "description": "2# 流量",
        "sim_base": 100,
        "sim_amplitude": 12,
        "sim_period_sec": 40,
    },
    {
        "tag_name": "700",
        "node_id": "ns=1;i=700",
        "value_type": "number",
        "unit": "℃",
        "description": "1#泵轴承温度",
        "sim_base": 55,
        "sim_amplitude": 8,
        "sim_period_sec": 25,
    },
    {
        "tag_name": "701",
        "node_id": "ns=1;i=701",
        "value_type": "number",
        "unit": "A",
        "description": "1#泵电流",
        "sim_base": 80,
        "sim_amplitude": 10,
        "sim_period_sec": 20,
    },
    {
        "tag_name": "702",
        "node_id": "ns=1;i=702",
        "value_type": "bool",
        "unit": "",
        "description": "1#泵运行状态",
        "sim_base": 0.5,
        "sim_amplitude": 1,
        "sim_period_sec": 50,
    },
    {
        "tag_name": "703",
        "node_id": "ns=1;i=703",
        "value_type": "number",
        "unit": "m",
        "description": "前池液位",
        "sim_base": 3.2,
        "sim_amplitude": 0.4,
        "sim_period_sec": 60,
    },
    {
        "tag_name": "Gate1_Status",
        "node_id": "ns=1;s=Gate1_Status",
        "value_type": "bool",
        "unit": "",
        "description": "1#闸门状态",
        "sim_base": 0.5,
        "sim_amplitude": 1,
        "sim_period_sec": 80,
    },
    {
        "tag_name": "Gate1_Opening",
        "node_id": "ns=1;s=Gate1_Opening",
        "value_type": "number",
        "unit": "%",
        "description": "1#闸门开度",
        "sim_base": 40,
        "sim_amplitude": 20,
        "sim_period_sec": 90,
    },
]


def seed_points(db: Session) -> int:
    if db.query(GwPoint).count() > 0:
        return 0
    for item in DEFAULT_POINTS:
        db.add(
            GwPoint(
                **item,
                source="mock",
                enabled=1,
            )
        )
    db.commit()
    return len(DEFAULT_POINTS)
