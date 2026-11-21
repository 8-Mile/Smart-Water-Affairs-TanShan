from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def require_gateway_token(
    x_gateway_token: str | None = Header(default=None, alias="X-Gateway-Token"),
) -> None:
    """服务间鉴权。开发环境若 token 为空配置则放行（不推荐）。"""
    expected = get_settings().gateway_token
    if not expected:
        return
    if not x_gateway_token or x_gateway_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 Gateway Token",
        )
