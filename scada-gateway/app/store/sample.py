from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class Sample:
    point_id: int
    tag_name: str
    node_id: str
    value_type: str
    value_num: Optional[float] = None
    value_bool: Optional[bool] = None
    value_str: Optional[str] = None
    status_code: int = 0
    status_name: str = "Good"
    ts_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "point_id": self.point_id,
            "tag_name": self.tag_name,
            "node_id": self.node_id,
            "value_type": self.value_type,
            "value_num": self.value_num,
            "value_bool": self.value_bool,
            "value_str": self.value_str,
            "status_code": self.status_code,
            "status_name": self.status_name,
            "ts_ms": self.ts_ms,
        }
