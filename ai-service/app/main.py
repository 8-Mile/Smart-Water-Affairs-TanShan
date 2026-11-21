from fastapi import FastAPI

from app.api.router import router
from app.core.config import get_settings

APP_VERSION = "0.1.0"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=APP_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.include_router(router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
