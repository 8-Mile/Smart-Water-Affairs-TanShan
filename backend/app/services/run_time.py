"""启停事件的统一时长计算引擎。

口径（全系统唯一）：
- 启停事件 `eq_run_event` 是唯一事实源，不按台账累计小时反推连续时长。
- 相邻的不同类型事件闭合一段；最后一个事件延续到 now，形成未闭合段。
- 连续同类型事件视为同一段（起点取最早），避免重复事件重置起点。
- 累计运行 / 累计停机均包含未闭合段。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

EVENT_START = "start"
EVENT_STOP = "stop"


@dataclass
class RunTimeSummary:
    """单个（或合并口径的）事件序列的时长汇总。"""

    start_count: int = 0
    stop_count: int = 0
    total_run_seconds: float = 0.0
    total_stop_seconds: float = 0.0
    # 当前连续段：running / stopped / None（无事件）
    current_state: str | None = None
    current_since: datetime | None = None
    current_seconds: float = 0.0
    segments: list[dict[str, Any]] = field(default_factory=list)

    @property
    def total_run_hours(self) -> float:
        return round(self.total_run_seconds / 3600.0, 2)

    @property
    def total_stop_hours(self) -> float:
        return round(self.total_stop_seconds / 3600.0, 2)

    @property
    def current_hours(self) -> float:
        return round(self.current_seconds / 3600.0, 2)

    def as_dict(self, *, equipment_id: int | None = None, equipment_name: str | None = None) -> dict:
        data = {
            "start_count": self.start_count,
            "stop_count": self.stop_count,
            "run_hours": self.total_run_hours,
            "stop_hours": self.total_stop_hours,
            "current_state": self.current_state,
            "current_since": self.current_since.isoformat() if self.current_since else None,
            "current_hours": self.current_hours,
            "current_seconds": int(max(0, self.current_seconds)),
        }
        if equipment_id is not None:
            data["equipment_id"] = equipment_id
        if equipment_name is not None:
            data["equipment_name"] = equipment_name
        return data


def summarize_run_events(
    events: Iterable[Any],
    *,
    now: datetime | None = None,
) -> RunTimeSummary:
    """把启停事件序列折算为累计运行/停机 + 当前连续段。

    `events` 只要求具备 `event_type` / `event_time` 属性（支持 ORM 对象与字典）。
    """
    now = now or datetime.now()

    def _type(e: Any) -> str | None:
        v = e.get("event_type") if isinstance(e, dict) else getattr(e, "event_type", None)
        return v if v in (EVENT_START, EVENT_STOP) else None

    def _time(e: Any) -> datetime | None:
        v = e.get("event_time") if isinstance(e, dict) else getattr(e, "event_time", None)
        return v if isinstance(v, datetime) else None

    def _id(e: Any) -> int:
        v = e.get("id") if isinstance(e, dict) else getattr(e, "id", None)
        return v if isinstance(v, int) else 0

    ordered = sorted(
        (e for e in events if _type(e) and _time(e)),
        key=lambda e: (_time(e), _id(e)),
    )
    summary = RunTimeSummary()
    summary.start_count = sum(1 for e in ordered if _type(e) == EVENT_START)
    summary.stop_count = sum(1 for e in ordered if _type(e) == EVENT_STOP)
    if not ordered:
        return summary

    def _accumulate(state: str, seconds: float) -> None:
        if state == EVENT_START:
            summary.total_run_seconds += seconds
        else:
            summary.total_stop_seconds += seconds

    prev_type = _type(ordered[0])
    prev_start = _time(ordered[0])
    # 事件时间乱序保护：首条之后的负跨度归零
    for e in ordered[1:]:
        typ, evt_time = _type(e), _time(e)
        if typ == prev_type:
            # 同态重复：保持最早起点，不重置
            continue
        span = max(0.0, (evt_time - prev_start).total_seconds())
        summary.segments.append(
            {"state": prev_type, "start": prev_start, "end": evt_time, "seconds": span, "open": False}
        )
        _accumulate(prev_type, span)
        prev_type, prev_start = typ, evt_time

    tail = max(0.0, (now - prev_start).total_seconds())
    summary.segments.append(
        {"state": prev_type, "start": prev_start, "end": now, "seconds": tail, "open": True}
    )
    _accumulate(prev_type, tail)
    summary.current_state = "running" if prev_type == EVENT_START else "stopped"
    summary.current_since = prev_start
    summary.current_seconds = tail
    return summary
