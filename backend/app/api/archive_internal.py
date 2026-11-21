"""供 ai-service 索引档案的内部接口（服务 Token，非用户 JWT）。"""

from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.deps import DbSession
from app.core.response import ok
from app.models.archive import Archive

router = APIRouter(prefix="/internal/archives", tags=["archives-internal"])


def _check_internal_token(
    x_internal_token: str | None,
    x_ai_token: str | None,
) -> None:
    settings = get_settings()
    expected = (
        settings.ai_internal_token
        or settings.ai_service_token
        or settings.scada_gateway_token
    )
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置 internal token",
        )
    token = x_internal_token or x_ai_token
    if not token or token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 Internal Token",
        )


def _upload_root() -> Path:
    root = Path(get_settings().upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _meta(a: Archive) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "category_code": a.category_code,
        "category_name": a.category_name,
        "file_name": a.file_name,
        "file_path": a.file_path,
        "file_size": a.file_size,
        "file_format": a.file_format,
        "content_type": a.content_type,
        "description": a.description,
        "upload_time": a.upload_time,
    }


@router.get("")
def list_archives_internal(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_internal_token(x_internal_token, x_ai_token)
    q = (
        db.query(Archive)
        .filter(Archive.deleted == 0)
        .order_by(Archive.id.asc())
    )
    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [_meta(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    )


@router.get("/{archive_id}")
def get_archive_internal(
    archive_id: int,
    db: DbSession,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_internal_token(x_internal_token, x_ai_token)
    obj = (
        db.query(Archive)
        .filter(Archive.id == archive_id, Archive.deleted == 0)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="档案不存在")
    return ok(_meta(obj))


@router.get("/{archive_id}/file")
def get_archive_file(
    archive_id: int,
    db: DbSession,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    x_ai_token: str | None = Header(default=None, alias="X-AI-Token"),
):
    _check_internal_token(x_internal_token, x_ai_token)
    obj = (
        db.query(Archive)
        .filter(Archive.id == archive_id, Archive.deleted == 0)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="档案不存在")
    path = (_upload_root() / obj.file_path).resolve()
    try:
        path.relative_to(_upload_root())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="非法路径") from e
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(
        path=str(path),
        filename=obj.file_name,
        media_type=obj.content_type or "application/octet-stream",
    )
