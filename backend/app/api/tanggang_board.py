"""Controlled A2UI: component/data whitelists + explicit publishing to real pages.

All widgets read only from one browser-local SIM scenario, never from a
real SCADA endpoint and never execute JavaScript supplied by the user/LLM.
"""
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, DbSession, collect_user_perms, require_perm
from app.core.response import ok
from app.models.tanggang_board import TanggangBoard, TanggangBoardRevision
from app.models.rbac import Role

router = APIRouter(prefix="/tanggang/boards", tags=["tanggang-a2ui"])
TARGETS = {
    "/port/water/supply": "大机供水保障",
    "/port/operations/monitor": "主动智能监护",
}
METRICS = {
    "supply-demand", "supply-capacity", "supply-shortage", "pool-forecast",
    "monitor-risk", "monitor-rule-count", "supply-coverage",
}
KINDS = {"metric", "terminal-table", "monitor-rules", "plan-comparison"}


class WidgetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    kind: Literal["metric", "terminal-table", "monitor-rules", "plan-comparison"]
    metric: Literal[
        "supply-demand", "supply-capacity", "supply-shortage", "pool-forecast",
        "monitor-risk", "monitor-rule-count", "supply-coverage",
    ] | None = None

    @model_validator(mode="after")
    def valid_widget(self):
        if (self.kind == "metric") != (self.metric is not None):
            raise PydanticCustomError("invalid_widget", "指标组件必须且只能指定白名单指标")
        return self


class BoardBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=2, max_length=80)
    target_path: Literal["/port/water/supply", "/port/operations/monitor"]
    widgets: list[WidgetBody] = Field(min_length=1, max_length=8)
    version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_items(self):
        self.title = self.title.strip()
        if len(self.title) < 2:
            raise PydanticCustomError("invalid_title", "看板名称至少2个字符")
        keys = [w.id for w in self.widgets]
        if len(keys) != len(set(keys)):
            raise PydanticCustomError("duplicate_widgets", "同一看板组件编号不能重复")
        return self


class VersionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)


class PublishBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allowed_role_codes: list[str] = Field(min_length=1, max_length=20)
    version: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_roles(self):
        if len(set(self.allowed_role_codes)) != len(self.allowed_role_codes):
            raise PydanticCustomError("duplicate_roles", "目标角色不能重复")
        if any(not x or len(x) > 32 for x in self.allowed_role_codes):
            raise PydanticCustomError("invalid_role", "角色编码无效")
        return self


def _snapshot(board: TanggangBoard) -> dict:
    return {
        "id": board.id, "title": board.title, "target_path": board.target_path,
        "owner_id": board.owner_id, "widgets": json.loads(board.widgets_json),
        "status": board.status,
        "allowed_role_codes": json.loads(board.allowed_roles_json),
        "version": board.version, "created_at": board.created_at,
        "updated_at": board.updated_at,
        "data_mode": "SIM", "field_verified": False,
    }


def _rev(db: Session, board: TanggangBoard, action: str, actor_id: int):
    db.add(TanggangBoardRevision(
        board_id=board.id, action=action, version=board.version,
        snapshot_json=json.dumps(_snapshot(board), ensure_ascii=False, default=str),
        actor_id=actor_id,
    ))


def _one(db: Session, board_id: int) -> TanggangBoard:
    board = db.query(TanggangBoard).filter(TanggangBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="看板不存在")
    return board


def _can_manage(db: Session, user) -> bool:
    return "sys:menu:manage" in collect_user_perms(db, user)


def _require_owner_or_manager(db: Session, user, board: TanggangBoard):
    if board.owner_id != user.id and not _can_manage(db, user):
        raise HTTPException(status_code=403, detail="无权编辑该看板")


def _require_version(board: TanggangBoard, version: int | None):
    if version is None or board.version != version:
        raise HTTPException(status_code=409, detail="看板版本已更新，请刷新后重新编辑")


def _check_role_codes(db: Session, roles: list[str]):
    rows = db.query(Role.code).filter(
        Role.code.in_(roles), Role.deleted == 0, Role.status == 1,
    ).all()
    if set(roles) != {x[0] for x in rows}:
        raise HTTPException(status_code=400, detail="目标角色不存在或已删除")


@router.get("/catalog")
def catalog(_: CurrentUser):
    return ok({
        "targets": [{"path": path, "label": label} for path, label in TARGETS.items()],
        "metrics": [
            {"id": "supply-demand", "label": "演示用水需求"},
            {"id": "supply-capacity", "label": "假设可分配能力"},
            {"id": "supply-shortage", "label": "模拟供水缺口"},
            {"id": "pool-forecast", "label": "假设期末储量"},
            {"id": "monitor-risk", "label": "模拟监护状态"},
            {"id": "monitor-rule-count", "label": "模拟规则命中数"},
            {"id": "supply-coverage", "label": "模拟需求覆盖率"},
        ],
        "kinds": ["metric", "terminal-table", "monitor-rules", "plan-comparison"],
        "source_mode": "SIM", "stage": "DOCUMENT_BASED_DEMO",
    })


@router.get("/mine")
def my_boards(db: DbSession, user: CurrentUser):
    q = db.query(TanggangBoard)
    if not _can_manage(db, user):
        q = q.filter(TanggangBoard.owner_id == user.id)
    return ok([_snapshot(b) for b in q.order_by(TanggangBoard.updated_at.desc(), TanggangBoard.id.desc()).limit(100).all()])


@router.get("/published")
def published_boards(
    db: DbSession, user: CurrentUser,
    target_path: str = Query(..., max_length=128),
):
    if target_path not in TARGETS:
        raise HTTPException(status_code=400, detail="不支持的看板发布位置")
    rows = db.query(TanggangBoard).filter(
        TanggangBoard.status == "published",
        TanggangBoard.target_path == target_path,
    ).order_by(TanggangBoard.id.asc()).limit(30).all()
    return ok([_snapshot(x) for x in rows
               if user.role_code in json.loads(x.allowed_roles_json)])


@router.get("/roles")
def available_roles(db: DbSession, user: CurrentUser):
    if not _can_manage(db, user):
        raise HTTPException(status_code=403, detail="没有看板发布权限")
    return ok([{"code": x.code, "name": x.name} for x in
               db.query(Role).filter(Role.deleted == 0, Role.status == 1)
               .order_by(Role.id.asc()).all()])


@router.get("/{board_id}")
def board_detail(board_id: int, db: DbSession, user: CurrentUser):
    b = _one(db, board_id)
    if b.owner_id != user.id and not _can_manage(db, user):
        if b.status != "published" or user.role_code not in json.loads(b.allowed_roles_json):
            raise HTTPException(status_code=403, detail="无权查看该看板")
    return ok(_snapshot(b))


@router.post("")
def create_board(body: BoardBody, db: DbSession, user: CurrentUser):
    b = TanggangBoard(
        title=body.title, target_path=body.target_path, owner_id=user.id,
        updated_by=user.id, widgets_json=json.dumps([w.model_dump() for w in body.widgets]),
        status="draft", allowed_roles_json="[]", version=1,
    )
    db.add(b)
    db.flush()
    _rev(db, b, "create", user.id)
    db.commit()
    db.refresh(b)
    return ok(_snapshot(b))


@router.put("/{board_id}")
def update_board(board_id: int, body: BoardBody, db: DbSession, user: CurrentUser):
    b = _one(db, board_id)
    _require_owner_or_manager(db, user, b)
    _require_version(b, body.version)
    if b.status == "published":
        raise HTTPException(status_code=409, detail="已发布看板不可直接修改，请先撤回")
    b.title = body.title
    b.target_path = body.target_path
    b.widgets_json = json.dumps([w.model_dump() for w in body.widgets])
    b.updated_by = user.id
    b.version += 1
    _rev(db, b, "update", user.id)
    db.commit()
    db.refresh(b)
    return ok(_snapshot(b))


@router.post("/{board_id}/publish")
def publish_board(
    board_id: int, body: PublishBody, db: DbSession, user: CurrentUser,
    _perm = Depends(require_perm("sys:menu:manage")),
):
    b = _one(db, board_id)
    _require_version(b, body.version)
    _check_role_codes(db, body.allowed_role_codes)
    b.status = "published"
    b.allowed_roles_json = json.dumps(body.allowed_role_codes)
    b.updated_by = user.id
    b.version += 1
    _rev(db, b, "publish", user.id)
    db.commit()
    db.refresh(b)
    return ok(_snapshot(b))


@router.post("/{board_id}/revoke")
def revoke_board(
    board_id: int, body: VersionBody, db: DbSession, user: CurrentUser,
    _perm = Depends(require_perm("sys:menu:manage")),
):
    b = _one(db, board_id)
    _require_version(b, body.version)
    b.status = "draft"
    b.allowed_roles_json = "[]"
    b.updated_by = user.id
    b.version += 1
    _rev(db, b, "revoke", user.id)
    db.commit()
    db.refresh(b)
    return ok(_snapshot(b))


@router.get("/{board_id}/history")
def board_history(board_id: int, db: DbSession, user: CurrentUser):
    b = _one(db, board_id)
    _require_owner_or_manager(db, user, b)
    rows = db.query(TanggangBoardRevision).filter(
        TanggangBoardRevision.board_id == board_id,
    ).order_by(TanggangBoardRevision.version.desc()).limit(100).all()
    return ok([{
        "version":r.version,"action":r.action,"actor_id":r.actor_id,
        "created_at":r.created_at, "snapshot":json.loads(r.snapshot_json),
    } for r in rows])
