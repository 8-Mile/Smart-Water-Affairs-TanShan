"""Data provenance for engineering design, SCADA and simulations.

A live SCADA row is NOT automatically MEASURED: in mock mode it is SIM;
all other SCADA sources remain UNKNOWN until site-proven lineage is implemented.
"""
from datetime import datetime, timezone
from decimal import Decimal
import math

from app.models.scada import ScadaPoint, ScadaPointLatest

DATA_MODES = ("MEASURED", "SIM", "REF", "CALC", "AI", "UNKNOWN")
QUALITIES = ("GOOD", "STALE", "BAD", "MISSING", "OFFLINE")


def point_envelope(point: ScadaPoint, latest: ScadaPointLatest | None, *,
                   runtime_mode: str, now_ms: int | None = None,
                   stale_after_ms: int = 300_000) -> dict:
    now = int(datetime.now(timezone.utc).timestamp() * 1000) if now_ms is None else now_ms
    mode = "SIM" if runtime_mode == "mock" else "UNKNOWN"
    if not latest or latest.ts_ms <= 0:
        return {
            "metric_id": point.id, "asset_id": point.equipment_id,
            "value": None, "unit": point.unit,
            "data_mode": mode, "quality": "MISSING", "observed_at": None,
            "source_ref": f"scada:{point.tag_name}", "calculation_version": None,
        }
    if latest.value_type == "bool":
        value = latest.value_bool
    elif latest.value_type == "string":
        value = latest.value_str
    elif latest.value_num is not None:
        value = float(latest.value_num) if isinstance(latest.value_num, Decimal) else latest.value_num
    else:
        value = None
    # Malformed, non-finite or wildly out-of-range timestamps are invalid
    # observations, never successful zero readings or valid measured samples.
    malformed_value = isinstance(value, float) and not math.isfinite(value)
    malformed_time = latest.ts_ms > 253402300799000
    if malformed_value:
        value = None
    if malformed_value or malformed_time:
        quality = "BAD"
    elif value is None:
        quality = "MISSING"
    elif str(latest.status_name or "").lower() in ("offline", "disconnected", "timeout"):
        quality = "OFFLINE"
    elif latest.status_code != 0 or str(latest.status_name or "").lower() not in ("good", "ok"):
        quality = "BAD"
    elif now - latest.ts_ms > stale_after_ms or latest.ts_ms > now + 60_000:
        quality = "STALE"
    else:
        quality = "GOOD"
    return {
        "metric_id": point.id, "asset_id": point.equipment_id, "value": value,
        "unit": point.unit, "data_mode": mode, "quality": quality,
        "observed_at": (
            None if malformed_time else
            datetime.fromtimestamp(latest.ts_ms / 1000, tz=timezone.utc).isoformat()
        ),
        "source_ref": f"scada:{point.tag_name}", "calculation_version": None,
    }
