"""Six CAD-backed Tanggang business-system identities.

These identifiers are a contract shared with the frontend; no physical water-network
connectivity is implied by putting a facility into one or more systems.
"""
SYSTEMS = {
    "fog": "射雾器除尘",
    "middle": "中压供水",
    "mineral": "含矿污水处理",
    "rain": "雨水收集",
    "pool": "水池供水",
    "domestic": "生活污水提升与外送",
}
SYSTEM_IDS = frozenset(SYSTEMS)
