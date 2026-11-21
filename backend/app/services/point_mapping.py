"""SCADA 点位映射规则（唯一配置源）。

现场点表沿用现有命名：机组编号前缀（M1/M2/M3…）+ 固定后缀。
新增机组或现场改名时只改本文件，快照接口与启停事件生成都从这里取规则。

    M{n}电机IA            运行电流      A
    M{n}电机P             有功功率      kW
    M{n}上导轴瓦温度1      轴承温度      ℃
    M{n}电机断路器合位     启停信号      bool（1=运行，0=停止）

点位归属设备的规则也在此维护（见 equipment_code_for_tag）：
接入时按 tag 前缀 M{机组号} + 关键字自动归到机组/子设备，无需人工绑点。
"""

from __future__ import annotations

import re
from dataclasses import dataclass


RUN_SIGNAL_TAG_SUFFIX = "电机断路器合位"


@dataclass(frozen=True)
class MetricRule:
    key: str                    # 接口字段名
    label: str                  # 前端展示名
    unit: str                   # 默认单位（点名位定义有单位时优先用点位的）
    suffixes: tuple[str, ...]   # 台账 tag_name 的匹配后缀


METRIC_RULES: tuple[MetricRule, ...] = (
    MetricRule("current", "运行电流", "A", ("电机IA",)),
    MetricRule("power", "有功功率", "kW", ("电机P",)),
    MetricRule("bearing_temp", "轴承温度", "℃", ("上导轴瓦温度1",)),
)


def resolve_metrics(entries: list[dict]) -> dict[str, dict]:
    """从快照点位条目中按规则解析关键指标。

    同一后缀可能命中多个点位（机组本身 + 子孙设备），优先在线且有值的那个。
    """
    result: dict[str, dict] = {}
    for rule in METRIC_RULES:
        candidates = [
            e for e in entries if (e.get("tag_name") or "").endswith(rule.suffixes)
        ]
        candidates.sort(
            key=lambda e: (not e.get("is_online"), e.get("value") is None)
        )
        pick = candidates[0] if candidates else None
        result[rule.key] = {
            "label": rule.label,
            "unit": (pick.get("unit") or rule.unit) if pick else rule.unit,
            "value": float(pick["value"])
            if pick and isinstance(pick.get("value"), (int, float))
            else None,
            "tag_name": pick.get("tag_name") if pick else None,
            "is_online": bool(pick and pick.get("is_online")),
        }
    return result


# ---- 点位归属设备（接入时自动绑定） ----

# tag 机组前缀：M1电机IA / M3上导轴瓦温度1 / M5电机断路器合位
UNIT_TAG_PREFIX = re.compile(r"^M(\d+)")

# 机组编码前缀：DZZ-UNIT-01 / DZZ-UNIT-03 …（与台账 code 一致）
UNIT_CODE_PREFIX = "DZZ-UNIT"

# 机组内子设备：编码后缀 → 关键字（按顺序匹配，先命中先归属）
SUBEQUIPMENT_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("-开关", ("断路器", "开关")),
    ("-励磁", ("励磁",)),
    ("-轴承", ("上导轴瓦", "下导轴瓦", "油池", "油槽", "轴承")),
    ("-调节", ("叶片", "调节")),
    ("-水泵", ("水泵", "冷却水")),
    ("-电机", ("电机",)),
)


def unit_code_for_tag(tag_name: str) -> str | None:
    """只取机组层编码（子设备缺失时的兜底）：M3xxx -> DZZ-UNIT-03。"""
    m = UNIT_TAG_PREFIX.match(tag_name or "")
    if not m:
        return None
    return f"{UNIT_CODE_PREFIX}-{int(m.group(1)):02d}"


def equipment_code_for_tag(tag_name: str) -> str | None:
    """按 tag 命名推导归属设备编码，无法识别时返回 None（保持未绑定）。

    M3电机IA        -> DZZ-UNIT-03-电机
    M3上导轴瓦温度1  -> DZZ-UNIT-03-轴承
    M3电机断路器合位 -> DZZ-UNIT-03-开关
    M3励磁电压      -> DZZ-UNIT-03-励磁
    M3其他          -> DZZ-UNIT-03（子设备无法判断时归到机组本身）
    """
    unit_code = unit_code_for_tag(tag_name)
    if not unit_code:
        return None
    m = UNIT_TAG_PREFIX.match(tag_name or "")
    rest = (tag_name or "")[m.end():]
    for suffix, keywords in SUBEQUIPMENT_RULES:
        if any(k in rest for k in keywords):
            return f"{unit_code}{suffix}"
    return unit_code
