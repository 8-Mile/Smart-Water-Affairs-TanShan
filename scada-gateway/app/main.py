from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.router import router
from app.bootstrap import seed_points
from app.core.config import get_settings
from app.core.database import SessionLocal, init_db
from app.retention import retention_worker
from app.runtime import gateway_runtime

APP_VERSION = "0.3.0"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        seed_points(db)
    finally:
        db.close()

    settings = get_settings()
    # mock | opcua 均可 auto_start
    if settings.auto_start and settings.source_mode in ("mock", "opcua"):
        gateway_runtime.start(
            mode=settings.source_mode,
            interval_sec=settings.sim_interval_sec,
        )
    retention_worker.start()
    try:
        yield
    finally:
        retention_worker.stop()
        gateway_runtime.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=APP_VERSION,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.include_router(router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
