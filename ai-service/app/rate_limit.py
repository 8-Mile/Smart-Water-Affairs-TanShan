"""简易按用户限流。"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock


class SlidingWindowLimiter:
    def __init__(self, max_calls: int = 30, window_sec: int = 60) -> None:
        self.max_calls = max_calls
        self.window_sec = window_sec
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window_sec:
                q.popleft()
            if len(q) >= self.max_calls:
                return False
            q.append(now)
            return True

    def remaining(self, key: str) -> int:
        now = time.time()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window_sec:
                q.popleft()
            return max(0, self.max_calls - len(q))


# 默认：每用户每分钟 20 次对话
chat_limiter = SlidingWindowLimiter(max_calls=20, window_sec=60)
