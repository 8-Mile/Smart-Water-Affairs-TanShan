from fastapi import APIRouter

from app.api import (
    ai,
    alarm,
    archive,
    archive_internal,
    audit,
    auth,
    dashboard,
    dispatch,
    energy,
    equipment,
    health,
    inspection,
    maintenance,
    notification,
    org,
    rbac,
    repair,
    scada,
    scada_ingest,
    water_supply,
    ws,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(ai.router)
api_router.include_router(dashboard.router)
api_router.include_router(org.router, prefix="/system", tags=["system-org"])
api_router.include_router(rbac.router, prefix="/system", tags=["system-rbac"])
api_router.include_router(equipment.router, tags=["equipment"])
api_router.include_router(scada.router)
api_router.include_router(scada_ingest.router)
api_router.include_router(alarm.router)
api_router.include_router(repair.router)
api_router.include_router(inspection.router)
api_router.include_router(maintenance.router)
api_router.include_router(water_supply.router)
api_router.include_router(energy.router)
api_router.include_router(dispatch.router)
api_router.include_router(archive.router)
api_router.include_router(archive_internal.router)
api_router.include_router(audit.router)
api_router.include_router(notification.router)
api_router.include_router(ws.router)
