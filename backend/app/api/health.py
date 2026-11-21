from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import engine
from app.core.response import ok
from app.scada.simulator import scada_runtime
from app.services.scada_client import scada_gateway_client
from app.services.scheduler import ops_scheduler

router = APIRouter()


@router.get("/health")
def health():
    settings = get_settings()
    db_ok = False
    db_error = None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        db_error = str(exc)

    local = scada_runtime.status()
    scada_check: dict = {
        "mode": settings.scada_mode,
        "local_running": local.get("running"),
        "local_tick_count": local.get("tick_count"),
    }

    if settings.scada_mode == "gateway":
        gw = scada_gateway_client.health()
        scada_check["gateway_ok"] = gw.get("ok")
        scada_check["gateway"] = gw.get("data") if gw.get("ok") else {"error": gw.get("error")}
        scada_ok = bool(gw.get("ok"))
    else:
        scada_ok = True
        scada_check["ok"] = True
        scada_check["running"] = local.get("running")
        scada_check["tick_count"] = local.get("tick_count")

    status = "up" if db_ok else "degraded"
    if settings.scada_mode == "gateway" and not scada_ok:
        status = "degraded" if db_ok else status

    return ok(
        {
            "status": status,
            "app": settings.app_name,
            "env": settings.app_env,
            "version": "1.0.0",
            "checks": {
                "database": {"ok": db_ok, "error": db_error},
                "scada": {
                    "ok": scada_ok if settings.scada_mode == "gateway" else True,
                    **scada_check,
                },
                "scheduler": {
                    "ok": True,
                    "running": ops_scheduler.status().get("running"),
                },
            },
        }
    )
