"""数据源抽象。"""

from __future__ import annotations

from typing import Any, Callable, Protocol

from app.store.sample import Sample

# samples 回调：收到一批 Sample 后由 runtime 写库/推送
OnSamples = Callable[[list[Sample]], None]


class DataSource(Protocol):
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def status(self) -> dict[str, Any]: ...
