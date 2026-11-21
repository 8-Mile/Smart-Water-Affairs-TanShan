import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func

from app.core.config import get_settings
from app.core.crud import get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.archive import Archive, ArchiveCategory, ArchiveFavorite

# Path already imported above

router = APIRouter(prefix="/archives", tags=["archives"])

CATEGORIES = {
    "DOC-DRAWING": "设备图纸",
    "DOC-POLICY": "管理制度",
    "DOC-STANDARD": "技术标准",
    "DOC-ACCEPTANCE": "验收资料",
    "DOC-OTHER": "其他资料",
}

ALLOWED_EXT = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".dwg",
    ".dxf",
    ".txt",
    ".zip",
    ".rar",
}


def _upload_root() -> Path:
    settings = get_settings()
    root = Path(settings.upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_name(name: str) -> str:
    name = os.path.basename(name or "file")
    name = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", name)
    return name[:180] or "file"


def _out(a: Archive, favorited: bool = False) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "category_code": a.category_code,
        "category_name": a.category_name or CATEGORIES.get(a.category_code),
        "file_name": a.file_name,
        "file_size": a.file_size,
        "file_format": a.file_format,
        "content_type": a.content_type,
        "uploader_name": a.uploader_name,
        "upload_time": a.upload_time,
        "updated_at": a.updated_at,
        "description": a.description,
        "download_count": a.download_count,
        "favorited": favorited,
        "status": a.status,
        "archive_no": a.archive_no,
        "source": a.source,
        "related_order": a.related_order,
        "related_equipment": a.related_equipment,
        "related_matter": a.related_matter,
    }


def _cat_out(c: ArchiveCategory, children: list | None = None, count: int | None = None) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "code": c.code,
        "count": c.count if count is None else count,
        "sort": c.sort,
        "children": children or [],
    }


def _find_category(db, code: str | None) -> ArchiveCategory | None:
    if not code:
        return None
    return (
        db.query(ArchiveCategory)
        .filter(ArchiveCategory.deleted == 0, ArchiveCategory.code == code)
        .first()
    )


@router.get("/categories")
def categories(db: DbSession, _: CurrentUser):
    """返回层级分类树（parent_id=0 为顶层）；计数按实际档案实时聚合，
    保证与右侧档案列表 / KPI 统计三处数字一致（不再使用分类表里人工填写的 count）。"""
    rows = (
        db.query(ArchiveCategory)
        .filter(ArchiveCategory.deleted == 0)
        .order_by(ArchiveCategory.sort, ArchiveCategory.id)
        .all()
    )
    # 实际档案按分类码计数（仅统计未删除档案）
    code_counts = dict(
        db.query(Archive.category_code, func.count(Archive.id))
        .filter(Archive.deleted == 0)
        .group_by(Archive.category_code)
        .all()
    )
    grouped: dict[int, list[ArchiveCategory]] = {}
    for c in rows:
        grouped.setdefault(c.parent_id, []).append(c)

    def cat_count(c: ArchiveCategory) -> int:
        # 有子分类则为父节点，汇总子树；否则为叶子，取该分类码下的实际档案数
        children = grouped.get(c.id, [])
        if children:
            return sum(cat_count(ch) for ch in children)
        return code_counts.get(c.code, 0) if c.code else 0

    def build(parent_id: int) -> list[dict]:
        return [
            _cat_out(c, build(c.id), cat_count(c)) for c in grouped.get(parent_id, [])
        ]

    return ok(build(0))


@router.post("/categories")
def create_category(body: dict, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("archive:category:create")),
):
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入分类名称")
    parent_id = int(body.get("parent_id") or 0)
    if parent_id:
        get_or_404(db, ArchiveCategory, parent_id)
    dup = (
        db.query(ArchiveCategory)
        .filter(
            ArchiveCategory.deleted == 0,
            ArchiveCategory.parent_id == parent_id,
            ArchiveCategory.name == name,
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=400, detail="同级已存在同名分类")
    code = (body.get("code") or "").strip() or f"CAT-{uuid.uuid4().hex[:8]}"
    sort = (
        db.query(func.max(ArchiveCategory.sort))
        .filter(ArchiveCategory.deleted == 0, ArchiveCategory.parent_id == parent_id)
        .scalar()
        or 0
    )
    obj = ArchiveCategory(
        name=name,
        code=code,
        parent_id=parent_id,
        count=int(body.get("count") or 0),
        sort=sort + 1,
        status=1,
        deleted=0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_cat_out(obj))


@router.put("/categories/{item_id}")
def update_category(item_id: int, body: dict, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("archive:category:update")),
):
    obj = get_or_404(db, ArchiveCategory, item_id)
    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="请输入分类名称")
        dup = (
            db.query(ArchiveCategory)
            .filter(
                ArchiveCategory.deleted == 0,
                ArchiveCategory.parent_id == obj.parent_id,
                ArchiveCategory.name == name,
                ArchiveCategory.id != item_id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status_code=400, detail="同级已存在同名分类")
        obj.name = name
    if "count" in body and body["count"] is not None:
        obj.count = int(body["count"])
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_cat_out(obj))


@router.delete("/categories/{item_id}")
def delete_category(item_id: int, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("archive:category:delete")),
):
    obj = get_or_404(db, ArchiveCategory, item_id)
    child = (
        db.query(ArchiveCategory)
        .filter(
            ArchiveCategory.deleted == 0,
            ArchiveCategory.parent_id == item_id,
        )
        .first()
    )
    if child:
        raise HTTPException(status_code=400, detail="请先删除该分类下的子分类")
    if obj.code:
        used = (
            db.query(Archive)
            .filter(Archive.deleted == 0, Archive.category_code == obj.code)
            .first()
        )
        if used:
            raise HTTPException(status_code=400, detail="该分类下仍有文档，无法删除")
    soft_delete(db, obj)
    return ok(True)


@router.get("/stats")
def stats(db: DbSession, _: CurrentUser):
    """档案统计：总量、本月/今日新增、分类计数及环比趋势（供首页/档案页 KPI 卡消费）。"""
    base = db.query(Archive).filter(Archive.deleted == 0)
    total = base.count()

    today = date.today()
    today_start_dt = datetime.combine(today, datetime.min.time())
    yesterday_start_dt = today_start_dt - timedelta(days=1)
    month_start_dt = today_start_dt.replace(day=1)

    def count_since(start: datetime, end: datetime | None = None, category_code: str | None = None) -> int:
        q = db.query(func.count(Archive.id)).filter(
            Archive.deleted == 0, Archive.upload_time >= start
        )
        if end is not None:
            q = q.filter(Archive.upload_time < end)
        if category_code:
            q = q.filter(Archive.category_code == category_code)
        return q.scalar() or 0

    def pct(cur: int, prev: int) -> float | None:
        """环比增幅（%）：上一期基数为 0 时返回 None，由前端显示占位。"""
        if not prev:
            return None
        return round((cur - prev) / prev * 100, 1)

    month_new = count_since(month_start_dt)
    today_new = count_since(today_start_dt)
    yesterday_new = count_since(yesterday_start_dt, today_start_dt)

    by_cat = []
    cat_total: dict[str, int] = {}
    cat_month_new: dict[str, int] = {}
    for code, name in CATEGORIES.items():
        c = count_since(datetime.min, None, code)
        cat_total[code] = c
        cat_month_new[code] = count_since(month_start_dt, None, code)
        by_cat.append(
            {
                "code": code,
                "name": name,
                "count": c,
                "ratio": round(c / total * 100, 1) if total else 0,
            }
        )

    def cat_trend(code: str) -> float | None:
        # 该分类总量 vs 上月末总量（上月末 = 总量 − 本月新增）
        return pct(cat_total[code], cat_total[code] - cat_month_new[code])

    return ok(
        {
            "total": total,
            "month_new": month_new,
            "today_new": today_new,
            "by_category": by_cat,
            # 环比：累计总量对比上月末（上月末 = 总量 − 本月新增）；今日对比昨日
            "trend": {
                "total": pct(total, total - month_new),
                "today": pct(today_new, yesterday_new),
                "drawing": cat_trend("DOC-DRAWING"),
                "standard": cat_trend("DOC-STANDARD"),
            },
        }
    )


@router.get("")
def list_archives(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    category_code: str | None = None,
    category_codes: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    favorite_only: bool = False,
):
    q = db.query(Archive).filter(Archive.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (Archive.name.like(like))
            | (Archive.file_name.like(like))
            | (Archive.description.like(like))
        )
    if category_code:
        q = q.filter(Archive.category_code == category_code)
    elif category_codes:
        # 左侧分类树点击：按当前节点的多个叶子分类码过滤
        codes = [c.strip() for c in category_codes.split(",") if c.strip()]
        if codes:
            q = q.filter(Archive.category_code.in_(codes))
    if start_date:
        q = q.filter(Archive.upload_time >= f"{start_date} 00:00:00")
    if end_date:
        q = q.filter(Archive.upload_time <= f"{end_date} 23:59:59")
    if favorite_only:
        fav_ids = [
            f.archive_id
            for f in db.query(ArchiveFavorite)
            .filter(ArchiveFavorite.user_id == current_user.id)
            .all()
        ]
        if not fav_ids:
            return ok({"items": [], "total": 0, "page": page, "page_size": page_size})
        q = q.filter(Archive.id.in_(fav_ids))
    q = q.order_by(Archive.upload_time.desc(), Archive.id.desc())
    result = paginate(q, page, page_size)
    fav_set = {
        f.archive_id
        for f in db.query(ArchiveFavorite)
        .filter(
            ArchiveFavorite.user_id == current_user.id,
            ArchiveFavorite.archive_id.in_([i.id for i in result["items"]] or [-1]),
        )
        .all()
    }
    result["items"] = [_out(i, favorited=i.id in fav_set) for i in result["items"]]
    return ok(result)


@router.get("/latest")
def latest(db: DbSession, current_user: CurrentUser, limit: int = Query(8, ge=1, le=50)):
    rows = (
        db.query(Archive)
        .filter(Archive.deleted == 0)
        .order_by(Archive.upload_time.desc())
        .limit(limit)
        .all()
    )
    fav_set = {
        f.archive_id
        for f in db.query(ArchiveFavorite)
        .filter(
            ArchiveFavorite.user_id == current_user.id,
            ArchiveFavorite.archive_id.in_([r.id for r in rows] or [-1]),
        )
        .all()
    }
    return ok([_out(r, favorited=r.id in fav_set) for r in rows])


@router.post("/upload")
async def upload(
    db: DbSession,
    current_user: CurrentUser,
    name: str = Form(...),
    category_code: str = Form(...),
    description: str | None = Form(None),
    source: str | None = Form(None),
    related_order: str | None = Form(None),
    related_equipment: str | None = Form(None),
    related_matter: str | None = Form(None),
    archive_no: str | None = Form(None),
    file: UploadFile = File(...),
    _perm: None = Depends(require_perm("archive:upload")),
):
    cat = _find_category(db, category_code)
    if not cat:
        raise HTTPException(status_code=400, detail="文档类型无效")
    # 运维记录下的工单档案由工单验收后系统自动归档，禁止人工上传
    if category_code.startswith("DOC-ORDER"):
        raise HTTPException(status_code=400, detail="工单档案由系统自动归档，不可人工上传")
    settings = get_settings()
    raw_name = file.filename or "file.bin"
    ext = Path(raw_name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {ext or '无扩展名'}",
        )

    content = await file.read()
    size = len(content)
    max_bytes = int(settings.upload_max_mb) * 1024 * 1024
    if size > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"文件不能超过 {settings.upload_max_mb}MB",
        )
    if size == 0:
        raise HTTPException(status_code=400, detail="文件为空")

    day = datetime.now().strftime("%Y%m%d")
    stored = f"{day}/{uuid.uuid4().hex}{ext}"
    dest = _upload_root() / stored
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(content)

    ctype = file.content_type or mimetypes.guess_type(raw_name)[0] or "application/octet-stream"
    # 档案编号未指定时自动生成：DA + 年月日 + 3位序号
    if not archive_no:
        seq = db.query(func.count(Archive.id)).filter(
            Archive.upload_time >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        ).scalar() or 0
        archive_no = f"DA{day}{seq + 1:03d}"
    obj = Archive(
        name=name.strip() or _safe_name(raw_name),
        category_code=category_code,
        category_name=cat.name,
        file_path=stored,
        file_name=_safe_name(raw_name),
        file_size=size,
        file_format=ext.lstrip("."),
        content_type=ctype,
        uploader_id=current_user.id,
        uploader_name=current_user.display_name,
        description=description,
        download_count=0,
        status=1,
        deleted=0,
        archive_no=archive_no,
        source=source or "人工上传",
        related_order=related_order,
        related_equipment=related_equipment,
        related_matter=related_matter,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    # 阶段 6：异步通知 AI 服务建立向量索引
    try:
        from app.services.ai_index import trigger_index_async

        trigger_index_async(obj.id)
    except Exception:  # noqa: BLE001
        pass
    return ok(_out(obj))


@router.put("/{item_id}")
def update_meta(item_id: int, body: dict, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("archive:update")),
):
    obj = get_or_404(db, Archive, item_id)
    if "name" in body and body["name"]:
        obj.name = str(body["name"]).strip()
    if "category_code" in body and body["category_code"]:
        code = body["category_code"]
        cat = _find_category(db, code)
        if not cat:
            raise HTTPException(status_code=400, detail="文档类型无效")
        obj.category_code = code
        obj.category_name = cat.name
    if "description" in body:
        obj.description = body["description"]
    if "source" in body:
        obj.source = body["source"]
    if "related_order" in body:
        obj.related_order = body["related_order"]
    if "related_equipment" in body:
        obj.related_equipment = body["related_equipment"]
    if "related_matter" in body:
        obj.related_matter = body["related_matter"]
    if "archive_no" in body:
        obj.archive_no = body["archive_no"]
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_out(obj))


@router.delete("/{item_id}")
def delete_archive(item_id: int, db: DbSession, current_user: CurrentUser,
    _perm: None = Depends(require_perm("archive:delete")),
):
    obj = get_or_404(db, Archive, item_id)
    soft_delete(db, obj)
    try:
        from app.services.ai_index import trigger_delete_async

        trigger_delete_async(item_id)
    except Exception:  # noqa: BLE001
        pass
    # 不强制删物理文件，保留审计；可选清理
    return ok(True)


@router.get("/{item_id}/download")
def download(
    item_id: int,
    db: DbSession,
    current_user: CurrentUser,
    _perm: None = Depends(require_perm("archive:download")),
):
    obj = get_or_404(db, Archive, item_id)
    path = _upload_root() / obj.file_path
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在或已丢失")
    # 防路径穿越
    try:
        path.resolve().relative_to(_upload_root())
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径") from None

    obj.download_count = (obj.download_count or 0) + 1
    db.add(obj)
    db.commit()

    return FileResponse(
        path=str(path),
        filename=obj.file_name,
        media_type=obj.content_type or "application/octet-stream",
    )


# ---------- 在线预览：LibreOffice 统一转 PDF（内网离线可用） ----------
_PREVIEW_OFFICE_EXTS = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"}
_PREVIEW_DIRECT_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp"}
_conv_lock = threading.Lock()


def _soffice_bin() -> str:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    mac = Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
    if mac.exists():
        return str(mac)
    raise HTTPException(status_code=500, detail="服务端未安装 LibreOffice，无法预览该文档")


def _convert_to_pdf(src: Path, cache_path: Path) -> Path:
    """将源文档转换为 PDF 并缓存（转换串行执行，避免多个 soffice 抢 CPU）。"""
    if cache_path.exists():
        return cache_path
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="arc_prev_") as td:
        work = Path(td)
        # 统一临时文件名防止输出重名；独立 profile 避免与其它 soffice 实例冲突
        src_copy = work / f"src{src.suffix.lower()}"
        shutil.copy2(src, src_copy)
        cmd = [
            _soffice_bin(),
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            f"-env:UserInstallation=file://{work / 'profile'}",
            "--outdir",
            str(work),
            str(src_copy),
        ]
        try:
            with _conv_lock:
                subprocess.run(cmd, capture_output=True, timeout=120, check=True)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="文档转换超时，请稍后重试") from None
        except subprocess.CalledProcessError:
            raise HTTPException(status_code=500, detail="文档转换失败") from None
        out = work / "src.pdf"
        if not out.exists():
            raise HTTPException(status_code=500, detail="文档转换失败")
        shutil.move(str(out), str(cache_path))
    return cache_path


@router.get("/{item_id}/preview")
def preview(item_id: int, db: DbSession, current_user: CurrentUser):
    """在线预览：Office 文档转 PDF 返回；PDF/图片直接返回原文件。"""
    obj = get_or_404(db, Archive, item_id)
    ext = f".{(obj.file_format or '').lower().lstrip('.')}"
    path = _upload_root() / obj.file_path
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在或已丢失")

    if ext in _PREVIEW_DIRECT_EXTS:
        return FileResponse(
            path=str(path), media_type=obj.content_type or "application/octet-stream"
        )
    if ext not in _PREVIEW_OFFICE_EXTS:
        raise HTTPException(status_code=400, detail="该格式暂不支持在线预览，请下载后查看")

    # 缓存键含文件大小，同名重传自动失效
    cache = _upload_root() / "pdf_cache" / f"{obj.id}_{obj.file_size}.pdf"
    pdf = _convert_to_pdf(path, cache)
    return FileResponse(
        path=str(pdf),
        media_type="application/pdf",
        filename=f"{obj.name}.pdf",
    )


@router.post("/{item_id}/favorite")
def toggle_favorite(item_id: int, db: DbSession, current_user: CurrentUser):
    get_or_404(db, Archive, item_id)
    fav = (
        db.query(ArchiveFavorite)
        .filter(
            ArchiveFavorite.user_id == current_user.id,
            ArchiveFavorite.archive_id == item_id,
        )
        .first()
    )
    if fav:
        db.delete(fav)
        db.commit()
        return ok({"favorited": False})
    db.add(ArchiveFavorite(user_id=current_user.id, archive_id=item_id))
    db.commit()
    return ok({"favorited": True})
