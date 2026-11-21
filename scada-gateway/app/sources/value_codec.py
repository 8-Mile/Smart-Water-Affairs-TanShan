"""OPC 原始值 → Sample 字段。"""

from __future__ import annotations

from typing import Any

from app.store.sample import Sample


def build_sample(
    *,
    point_id: int,
    tag_name: str,
    node_id: str,
    value_type: str,
    raw: Any,
    ts_ms: int,
    status_code: int = 0,
    status_name: str = "Good",
) -> Sample:
    sample = Sample(
        point_id=point_id,
        tag_name=tag_name,
        node_id=node_id,
        value_type=value_type or "number",
        ts_ms=ts_ms,
        status_code=status_code,
        status_name=status_name,
    )
    vt = sample.value_type
    if vt == "bool":
        if isinstance(raw, str):
            b = raw.lower() in ("1", "true", "yes", "on")
        else:
            b = bool(raw)
        sample.value_bool = b
        sample.value_num = 1.0 if b else 0.0
    elif vt == "string":
        sample.value_str = str(raw) if raw is not None else ""
        try:
            sample.value_num = float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            sample.value_num = None
    else:
        try:
            sample.value_num = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            sample.value_str = str(raw)
            sample.value_type = "string"
    return sample


def python_to_opc_value(value: Any, value_type: str) -> Any:
    if value_type == "bool":
        if isinstance(value, str):
            return value.lower() in ("1", "true", "yes", "on")
        return bool(value)
    if value_type == "string":
        return str(value)
    return float(value)
