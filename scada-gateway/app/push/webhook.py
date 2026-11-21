"""将采样推送到主业务系统 Ingest API。"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings
from app.store.sample import Sample

logger = logging.getLogger("scada-gateway.webhook")


def push_samples_to_main(samples: list[Sample], write_history: bool = True) -> dict[str, Any]:
    settings = get_settings()
    url = (settings.main_app_webhook_url or "").strip()
    if not url or not samples:
        return {"skipped": True, "reason": "no_webhook_or_empty"}

    token = settings.main_app_webhook_token or settings.gateway_token
    payload = {
        "samples": [s.to_dict() for s in samples],
        "write_history": write_history,
    }
    headers = {
        "Content-Type": "application/json",
        "X-Gateway-Token": token,
    }
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.post(url, json=payload, headers=headers)
            if r.status_code >= 400:
                logger.warning(
                    "webhook failed status=%s body=%s", r.status_code, r.text[:300]
                )
                return {
                    "ok": False,
                    "status_code": r.status_code,
                    "body": r.text[:500],
                }
            return {"ok": True, "status_code": r.status_code, "data": r.json()}
    except Exception as exc:  # noqa: BLE001
        logger.warning("webhook error: %s", exc)
        return {"ok": False, "error": str(exc)}
