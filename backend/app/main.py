import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.alarm_engine.ws_hub import alarm_ws_hub
from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.middleware import (
    LoginRateLimitMiddleware,
    OperationLogMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.response import fail
from app.core.schema_sync import ensure_schema
import app.models  # noqa: F401  register all models
from app.scada.simulator import scada_runtime
from app.services.bootstrap import seed_all
from app.services.scada_config import load_saved_config
from app.services.scheduler import ops_scheduler

APP_VERSION = "1.0.0"

logger = logging.getLogger(__name__)


def _check_insecure_defaults(settings) -> None:
    """生产环境拒绝出厂默认 JWT 密钥；默认管理员口令仅告警。

    安装包的种子库管理员初始口令固定为默认值（首次登录后应修改），
    若在此直接拒绝启动会导致交付包无法打开，因此不纳入阻断项。
    """
    issues = settings.insecure_defaults
    if not issues:
        return
    message = "检测到未覆盖的默认安全配置：" + "、".join(issues)
    blocking = [i for i in issues if i != "BOOTSTRAP_ADMIN_PASSWORD"]
    if settings.is_prod and blocking:
        raise RuntimeError(
            f"检测到未覆盖的默认安全配置：{'、'.join(blocking)}。"
            "生产环境（APP_ENV=prod）必须通过环境变量显式设置。"
        )
    if settings.is_prod:
        logger.warning("%s；请首次登录后立即修改管理员口令。", message)
    else:
        logger.warning("%s；当前为开发环境，仅告警，请勿用于对外部署。", message)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_schema()
    db = SessionLocal()
    try:
        seed_all(db)
        # 页面保存的 SCADA 配置优先于 .env，启动时覆盖到全局 settings
        load_saved_config(db)
    finally:
        db.close()

    try:
        alarm_ws_hub.set_loop(asyncio.get_running_loop())
    except RuntimeError:
        pass

    from app.services.user_ws import user_ws_hub

    try:
        user_ws_hub.set_loop(asyncio.get_running_loop())
    except RuntimeError:
        pass

    settings = get_settings()
    # mock：主站内置仿真；gateway：由 scada-gateway 推送，不启本地线程
    if (
        settings.scada_auto_start
        and settings.scada_mode == "mock"
    ):
        scada_runtime.start(
            mode="mock",
            interval_sec=settings.scada_sim_interval_sec,
        )
    ops_scheduler.start(interval_sec=3600)
    try:
        yield
    finally:
        ops_scheduler.stop()
        scada_runtime.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    _check_insecure_defaults(settings)
    docs_url = "/docs" if settings.enable_docs and not settings.is_prod else None
    redoc_url = "/redoc" if settings.enable_docs and not settings.is_prod else None
    openapi_url = "/openapi.json" if settings.enable_docs and not settings.is_prod else None
    # 开发环境仍可用 docs；生产用 APP_ENV=prod 关闭
    if settings.enable_docs and not settings.is_prod:
        docs_url, redoc_url, openapi_url = "/docs", "/redoc", "/openapi.json"
    elif not settings.enable_docs:
        docs_url = redoc_url = openapi_url = None

    app = FastAPI(
        title=settings.app_name,
        version=APP_VERSION,
        lifespan=lifespan,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
    )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(
        LoginRateLimitMiddleware,
        max_attempts=settings.login_rate_limit_max,
        window_sec=settings.login_rate_limit_window_sec,
    )
    if settings.enable_audit_log:
        app.add_middleware(OperationLogMiddleware)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
        detail = exc.detail
        message = detail if isinstance(detail, str) else str(detail)
        return JSONResponse(
            status_code=exc.status_code,
            content=fail(message=message, code=exc.status_code),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        _request: Request, exc: RequestValidationError
    ):
        return JSONResponse(
            status_code=422,
            content=fail(message="参数校验失败", code=422, data=exc.errors()),
        )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    # 打包部署：由同一个进程托管前端构建产物（FRONTEND_DIST 指向 dist 目录）
    dist_env = os.environ.get("FRONTEND_DIST", "").strip()
    dist_dir = Path(dist_env).resolve() if dist_env else None
    index_file = dist_dir / "index.html" if dist_dir else None

    @app.get("/")
    def root():
        if index_file and index_file.is_file():
            return FileResponse(index_file)
        return {
            "name": settings.app_name,
            "docs": "/docs" if docs_url else None,
            "api": settings.api_v1_prefix,
            "version": APP_VERSION,
            "env": settings.app_env,
        }

    if dist_dir and index_file and index_file.is_file():
        assets_dir = dist_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            # API / 文档路径不吞掉，交给原有 404 处理
            if full_path.startswith(
                ("api/", "docs", "redoc", "openapi.json")
            ):
                raise HTTPException(status_code=404, detail="Not Found")
            target = (dist_dir / full_path).resolve()
            if target.is_file() and dist_dir in target.parents:
                return FileResponse(target)
            return FileResponse(index_file)

    return app


app = create_app()
