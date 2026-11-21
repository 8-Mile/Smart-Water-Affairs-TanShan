"""Gateway → 主站采样镜像接口（服务间 Token，非用户 JWT）。"""

from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.deps import DbSession
from app.core.response import ok
from app.services.scada_ingest import ingest_samples

router = APIRouter(prefix="/internal/scada", tags=["scada-ingest"])


class IngestBody(BaseModel):
    samples: list[dict[str, Any]] = Field(default_factory=list)
    write_history: bool = True


def _check_ingest_token(x_gateway_token: str | None) -> None:
    settings = get_settings()
    expected = settings.scada_ingest_token or settings.scada_gateway_token
    if not expected:
        # 未配置时拒绝（避免裸奔）
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置 SCADA ingest token",
        )
    if not x_gateway_token or x_gateway_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 Gateway Token",
        )


@router.post("/samples")
def receive_samples(
    body: IngestBody,
    db: DbSession,
    x_gateway_token: str | None = Header(default=None, alias="X-Gateway-Token"),
):
    _check_ingest_token(x_gateway_token)
    if not body.samples:
        return ok({"accepted": 0, "tags": []}, message="empty")
    result = ingest_samples(db, body.samples, write_history=body.write_history)
    return ok(result, message="ingested")
