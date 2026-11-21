"""主站访问 SCADA Gateway 的 HTTP 客户端。"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from app.core.config import get_settings


class ScadaGatewayClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def enabled(self) -> bool:
        return self.settings.scada_mode == "gateway" and bool(
            self.settings.scada_gateway_url
        )

    def _headers(self) -> dict[str, str]:
        return {"X-Gateway-Token": self.settings.scada_gateway_token}

    def _url(self, path: str) -> str:
        base = self.settings.scada_gateway_url.rstrip("/")
        prefix = self.settings.scada_gateway_api_prefix.rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        return f"{base}{prefix}{path}"

    def health(self) -> dict[str, Any]:
        if not self.settings.scada_gateway_url:
            return {"ok": False, "error": "SCADA_GATEWAY_URL 未配置"}
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(self._url("/health"), headers=self._headers())
                if r.status_code != 200:
                    return {"ok": False, "error": f"HTTP {r.status_code}", "body": r.text}
                data = r.json()
                return {"ok": True, "data": data.get("data", data)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}

    def runtime_status(self) -> dict[str, Any]:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(self._url("/runtime/status"), headers=self._headers())
            r.raise_for_status()
            return r.json().get("data") or {}

    def runtime_start(
        self, mode: str = "mock", interval_sec: Optional[float] = None
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"mode": mode}
        if interval_sec is not None:
            body["interval_sec"] = interval_sec
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                self._url("/runtime/start"),
                headers=self._headers(),
                json=body,
            )
            r.raise_for_status()
            return r.json().get("data") or {}

    def runtime_stop(self) -> dict[str, Any]:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(self._url("/runtime/stop"), headers=self._headers())
            r.raise_for_status()
            return r.json().get("data") or {}

    def inject(
        self,
        *,
        point_id: Optional[int] = None,
        tag_name: Optional[str] = None,
        value: Any,
        value_type: Optional[str] = None,
        write_history: bool = True,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "value": value,
            "write_history": write_history,
        }
        if point_id is not None:
            payload["point_id"] = point_id
        if tag_name is not None:
            payload["tag_name"] = tag_name
        if value_type is not None:
            payload["value_type"] = value_type
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                self._url("/inject"),
                headers=self._headers(),
                json=payload,
            )
            r.raise_for_status()
            return r.json().get("data") or {}

    def list_points(self) -> list[dict[str, Any]]:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(self._url("/points"), headers=self._headers())
            r.raise_for_status()
            return r.json().get("data") or []

    def list_latest(
        self, tag_name: str | None = None, limit: int = 500
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if tag_name:
            params["tag_name"] = tag_name
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                self._url("/latest"),
                headers=self._headers(),
                params=params,
            )
            r.raise_for_status()
            return r.json().get("data") or []

    def list_history(
        self,
        tag_name: str,
        from_ts: int | None = None,
        to_ts: int | None = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"tag_name": tag_name, "limit": limit}
        if from_ts is not None:
            params["from_ts"] = from_ts
        if to_ts is not None:
            params["to_ts"] = to_ts
        with httpx.Client(timeout=15.0) as client:
            r = client.get(
                self._url("/history"),
                headers=self._headers(),
                params=params,
            )
            r.raise_for_status()
            return r.json().get("data") or []


scada_gateway_client = ScadaGatewayClient()
