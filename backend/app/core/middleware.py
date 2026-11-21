"""审计日志中间件 + 简易登录限流。"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.archive import OperationLog

# path 前缀跳过审计（高频/健康）
SKIP_AUDIT_PREFIX = (
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    # 服务间/网关高频内部接口（SCADA 秒级上报、档案内部读取），不属于人工操作
    "/api/v1/internal",
)

# 审计详情解析：路径前缀 → 业务模块（与前端菜单命名保持一致）
MODULE_PREFIXES: tuple[tuple[str, str], ...] = (
    ("/api/v1/auth", "登录认证"),
    ("/api/v1/alarms", "告警中心"),
    ("/api/v1/repairs", "维修工单"),
    ("/api/v1/scada", "实时监控"),
    ("/api/v1/equipment", "设备资产"),
    ("/api/v1/maintenance", "设备维护"),
    ("/api/v1/inspections", "设备巡检"),
    ("/api/v1/water", "供水统计"),
    ("/api/v1/energy", "耗能分析"),
    ("/api/v1/archives", "档案管理"),
    ("/api/v1/notifications", "消息通知"),
    ("/api/v1/ai", "智能助手"),
    ("/api/v1/audit", "操作日志"),
    ("/api/v1/system", "系统管理"),
)

# 路径末段动词 → 中文动作名；未命中时按 HTTP 方法兜底
ACTION_LABELS: dict[str, str] = {
    "create": "新增",
    "update": "修改",
    "delete": "删除",
    "dispatch": "派单",
    "auto-dispatch": "自动派发",
    "claim": "认领",
    "reject": "驳回",
    "reject_dispatch": "驳回派单",
    "repair-handle": "转维修工单",
    "copy": "复制",
    "preview": "预览",
    "favorite": "收藏",
    "complete": "完工提交",
    "accept": "验收",
    "handle": "处理",
    "cancel": "取消",
    "assign": "分配",
    "status": "状态变更",
    "import": "导入",
    "export": "导出",
    "upload": "上传",
    "download": "下载",
    "read": "标记已读",
    "read-all": "全部已读",
    "reset-password": "重置密码",
    "change-password": "修改密码",
    "reindex": "重建索引",
    "index": "建立索引",
    "test": "连接测试",
}

METHOD_FALLBACK: dict[str, str] = {
    "POST": "新增",
    "PUT": "修改",
    "PATCH": "修改",
    "DELETE": "删除",
}


def resolve_module(path: str) -> str | None:
    """按路径前缀解析业务模块名。"""
    for prefix, name in MODULE_PREFIXES:
        if path.startswith(prefix):
            return name
    return None


def build_detail(method: str, path: str) -> str | None:
    """生成审计详情：`模块 · 动作`，解析失败返回 None。

    业务对象名称由查询接口（/audit/operation-logs）按路径 ID 反查后追加，
    避免日志里出现无法理解的 `#164`。
    """
    module = resolve_module(path)
    if not module:
        return None
    try:
        segments = [s for s in path.split("?")[0].split("/") if s and s != "api" and s != "v1"]
        tail = segments[-1] if segments else ""
        if path.endswith("/auth/login"):
            action = "用户登录"
        elif "/download" in path:
            action = "下载"
        else:
            action = ACTION_LABELS.get(tail) or METHOD_FALLBACK.get(method.upper(), method.upper())
        return f"{module} · {action}"
    except Exception:  # noqa: BLE001
        return module


class LoginRateLimitMiddleware(BaseHTTPMiddleware):
    """登录接口简易限流：同 IP 窗口内最多 N 次。"""

    def __init__(self, app, max_attempts: int = 20, window_sec: int = 300):
        super().__init__(app)
        self.max_attempts = max_attempts
        self.window_sec = window_sec
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        is_login = request.method == "POST" and path.endswith("/auth/login")
        if is_login:
            ip = request.client.host if request.client else "unknown"
            now = time.time()
            with self._lock:
                q = self._hits[ip]
                while q and now - q[0] > self.window_sec:
                    q.popleft()
                if len(q) >= self.max_attempts:
                    return JSONResponse(
                        status_code=429,
                        content={
                            "code": 429,
                            "message": "登录尝试过于频繁，请稍后再试",
                            "data": None,
                        },
                    )
            response = await call_next(request)
            # 仅统计失败登录，避免集成测试/正常使用成功登录触发限流
            if response.status_code in (401, 400, 403):
                with self._lock:
                    self._hits[ip].append(time.time())
            return response
        return await call_next(request)


class OperationLogMiddleware(BaseHTTPMiddleware):
    """记录写操作与关键读操作审计。"""

    WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if any(path.startswith(p) for p in SKIP_AUDIT_PREFIX):
            return await call_next(request)

        method = request.method.upper()
        # 默认只记写操作 + 登录 + 下载
        should_log = method in self.WRITE_METHODS or path.endswith("/auth/login") or "/download" in path
        if not should_log:
            return await call_next(request)

        start = time.time()
        response: Response = await call_next(request)
        duration = int((time.time() - start) * 1000)

        try:
            self._write_log(request, response.status_code, duration)
        except Exception:  # noqa: BLE001
            pass
        return response

    def _write_log(self, request: Request, status_code: int, duration_ms: int) -> None:
        settings = get_settings()
        username = None
        user_id = None
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1]
            try:
                payload = jwt.decode(
                    token,
                    settings.jwt_secret,
                    algorithms=[settings.jwt_algorithm],
                )
                username = payload.get("sub")
                user_id = payload.get("uid")
            except JWTError:
                pass
        if not username:
            # 登录接口无令牌，由 auth 路由写入待记录的用户名
            username = getattr(request.state, "audit_username", None)

        ip = request.client.host if request.client else None
        ua = (request.headers.get("user-agent") or "")[:255]
        db = SessionLocal()
        try:
            db.add(
                OperationLog(
                    user_id=int(user_id) if user_id is not None else None,
                    username=str(username) if username else None,
                    method=request.method.upper(),
                    path=str(request.url.path)[:255],
                    status_code=status_code,
                    ip=ip,
                    user_agent=ua,
                    duration_ms=duration_ms,
                    detail=build_detail(request.method, str(request.url.path)),
                )
            )
            db.commit()
        finally:
            db.close()


# 生产环境 CSP：仅允许同源资源；Element Plus 运行时注入内联样式，style-src 需 unsafe-inline；
# 预览使用 blob: 地址（frame/img/worker），因此放行 blob:
PROD_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-src 'self' blob:; "
    "worker-src 'self' blob:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """统一安全响应头：防 MIME 嗅探、点击劫持、Referer 泄露；生产再加 CSP 与 HSTS。"""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        if get_settings().is_prod:
            headers.setdefault("Content-Security-Policy", PROD_CSP)
            # 仅在真实 HTTPS 请求下发 HSTS，避免本地 HTTP 调试被浏览器强制升级
            if request.url.scheme == "https":
                headers.setdefault(
                    "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
                )
        return response
