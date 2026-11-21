from fastapi import Depends, APIRouter, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crud import ensure_unique, get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, SuperAdmin, require_perm
from app.core.response import ok
from app.models.equipment import Equipment
from app.models.scada import ScadaPoint, ScadaPointLatest, ScadaTagData
from app.scada.simulator import scada_runtime
from app.scada.writer import sample_to_dict
from app.schemas.scada import (
    EquipmentPointValue,
    ScadaConfigIn,
    ScadaConfigTestIn,
    ScadaHistoryOut,
    ScadaInjectRequest,
    ScadaLatestOut,
    ScadaPointCreate,
    ScadaPointOut,
    ScadaPointUpdate,
    ScadaRuntimeControl,
)
from app.services.scada_client import scada_gateway_client
from app.services.scada_config import (
    get_config as get_scada_config,
    save_config as save_scada_config,
    test_connection as test_scada_connection,
)
from app.services.scada_ingest import ingest_samples

router = APIRouter(prefix="/scada", tags=["scada"])


def _display_value(value_type: str, value_num, value_bool, value_str):
    if value_type == "bool":
        return value_bool
    if value_type == "string":
        return value_str
    if value_num is not None:
        return float(value_num)
    return None


def _use_gateway() -> bool:
    return get_settings().scada_mode == "gateway"


def _gateway_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"SCADA Gateway 不可用: {exc}",
    )


def _point_out(db: Session, p: ScadaPoint) -> dict:
    data = ScadaPointOut.model_validate(p).model_dump()
    data["sim_base"] = float(p.sim_base or 0)
    data["sim_amplitude"] = float(p.sim_amplitude or 0)
    data["sim_period_sec"] = float(p.sim_period_sec or 0)
    latest = (
        db.query(ScadaPointLatest)
        .filter(ScadaPointLatest.point_id == p.id)
        .first()
    )
    if latest:
        data["latest_value"] = _display_value(
            latest.value_type, latest.value_num, latest.value_bool, latest.value_str
        )
        data["latest_ts_ms"] = latest.ts_ms
        data["status_name"] = latest.status_name
    return data


def _resolve_point(db: Session, point_id: int | None, tag_name: str | None) -> ScadaPoint:
    if point_id is not None:
        p = (
            db.query(ScadaPoint)
            .filter(ScadaPoint.id == point_id, ScadaPoint.deleted == 0)
            .first()
        )
        if not p:
            raise HTTPException(status_code=404, detail="测点不存在")
        return p
    if not tag_name:
        raise HTTPException(status_code=400, detail="point_id 或 tag_name 必填其一")
    p = (
        db.query(ScadaPoint)
        .filter(ScadaPoint.tag_name == tag_name, ScadaPoint.deleted == 0)
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="测点不存在")
    return p


@router.get("/config")
def read_scada_config(db: DbSession, _: SuperAdmin):
    """读取 SCADA 接入配置（仅超级管理员）。"""
    return ok(get_scada_config(db))


@router.put("/config")
def update_scada_config(body: ScadaConfigIn, db: DbSession, user: SuperAdmin):
    """保存并立即生效（仅超级管理员）。"""
    return ok(save_scada_config(db, body, user.username), message="配置已保存并生效")


@router.post("/config/test")
def test_scada_config(body: ScadaConfigTestIn, db: DbSession, _: SuperAdmin):
    """按当前表单参数做连接测试，不落库（仅超级管理员）。"""
    return ok(test_scada_connection(db, body))


@router.get("/runtime/status")
def runtime_status(_: CurrentUser):
    if _use_gateway():
        try:
            st = scada_gateway_client.runtime_status()
            st = {**st, "source": "gateway", "mode_config": "gateway"}
            return ok(st)
        except Exception as e:  # noqa: BLE001
            raise _gateway_error(e) from e
    st = scada_runtime.status()
    st = {**st, "source": "local", "mode_config": get_settings().scada_mode}
    return ok(st)


@router.post("/runtime/start")
def runtime_start(body: ScadaRuntimeControl, _: CurrentUser,
    _perm: None = Depends(require_perm("scada:sim:control")),
):
    if _use_gateway():
        try:
            st = scada_gateway_client.runtime_start(
                mode=body.mode or "mock",
                interval_sec=body.interval_sec,
            )
            st = {**st, "source": "gateway"}
            return ok(st, message="Gateway 采集已启动")
        except Exception as e:  # noqa: BLE001
            raise _gateway_error(e) from e
    st = scada_runtime.start(mode=body.mode, interval_sec=body.interval_sec)
    return ok(st, message="仿真已启动")


@router.post("/runtime/stop")
def runtime_stop(_: CurrentUser,
    _perm: None = Depends(require_perm("scada:sim:control")),
):
    if _use_gateway():
        try:
            st = scada_gateway_client.runtime_stop()
            st = {**st, "source": "gateway"}
            return ok(st, message="Gateway 采集已停止")
        except Exception as e:  # noqa: BLE001
            raise _gateway_error(e) from e
    st = scada_runtime.stop()
    return ok(st, message="仿真已停止")


@router.post("/inject")
def inject_value(body: ScadaInjectRequest, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("scada:point:inject")),
):
    point = _resolve_point(db, body.point_id, body.tag_name)

    if _use_gateway():
        # 必须以 tag_name 注入：Gateway 与主站 point_id 不同
        try:
            gw_sample = scada_gateway_client.inject(
                tag_name=point.tag_name,
                value=body.value,
                value_type=body.value_type or point.value_type,
                write_history=body.write_history,
            )
        except Exception as e:  # noqa: BLE001
            raise _gateway_error(e) from e

        # Webhook 一般已镜像；再 ingest 一次保证本地一致（latest 覆盖；history 可能多一条，可接受）
        # 若 webhook 已成功写 history，这里 write_history=False 只补 latest
        try:
            ingest_samples(
                db,
                [
                    {
                        "tag_name": point.tag_name,
                        "node_id": point.node_id,
                        "value_type": gw_sample.get("value_type") or point.value_type,
                        "value_num": gw_sample.get("value_num"),
                        "value_bool": gw_sample.get("value_bool"),
                        "value_str": gw_sample.get("value_str"),
                        "status_code": gw_sample.get("status_code") or 0,
                        "status_name": gw_sample.get("status_name") or "Good",
                        "ts_ms": gw_sample.get("ts_ms") or 0,
                    }
                ],
                write_history=False,
            )
        except Exception:  # noqa: BLE001
            pass

        return ok(
            {
                "point_id": point.id,
                "tag_name": point.tag_name,
                "node_id": point.node_id,
                "value_type": gw_sample.get("value_type") or point.value_type,
                "value_num": gw_sample.get("value_num"),
                "value_bool": gw_sample.get("value_bool"),
                "value_str": gw_sample.get("value_str"),
                "status_code": gw_sample.get("status_code") or 0,
                "status_name": gw_sample.get("status_name") or "Good",
                "ts_ms": gw_sample.get("ts_ms") or 0,
                "source": "gateway",
            }
        )

    try:
        sample = scada_runtime.inject(
            point_id=point.id,
            value=body.value,
            value_type=body.value_type,
            write_history=body.write_history,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    data = sample_to_dict(sample)
    data["source"] = "local"
    return ok(data)


@router.get("/points")
def list_points(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    enabled: int | None = None,
):
    q = db.query(ScadaPoint).filter(ScadaPoint.deleted == 0)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (ScadaPoint.tag_name.like(like))
            | (ScadaPoint.node_id.like(like))
            | (ScadaPoint.description.like(like))
        )
    if enabled is not None:
        q = q.filter(ScadaPoint.enabled == enabled)
    q = q.order_by(ScadaPoint.id.asc())
    result = paginate(q, page, page_size)
    result["items"] = [_point_out(db, i) for i in result["items"]]
    return ok(result)


@router.get("/points/options")
def point_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(ScadaPoint)
        .filter(ScadaPoint.deleted == 0, ScadaPoint.status == 1)
        .order_by(ScadaPoint.id.asc())
        .all()
    )
    return ok(
        [
            {
                "id": r.id,
                "name": r.tag_name,
                "tag_name": r.tag_name,
                "node_id": r.node_id,
                "value_type": r.value_type,
            }
            for r in rows
        ]
    )


@router.post("/points")
def create_point(body: ScadaPointCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("scada:point:create")),
):
    ensure_unique(db, ScadaPoint, "tag_name", body.tag_name, message="测点名称已存在")
    obj = ScadaPoint(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_point_out(db, obj))


@router.put("/points/{item_id}")
def update_point(item_id: int, body: ScadaPointUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("scada:point:update")),
):
    obj = get_or_404(db, ScadaPoint, item_id)
    data = body.model_dump(exclude_unset=True)
    if "tag_name" in data:
        ensure_unique(
            db,
            ScadaPoint,
            "tag_name",
            data["tag_name"],
            exclude_id=item_id,
            message="测点名称已存在",
        )
    for k, v in data.items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_point_out(db, obj))


@router.delete("/points/{item_id}")
def delete_point(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("scada:point:delete")),
):
    obj = get_or_404(db, ScadaPoint, item_id)
    soft_delete(db, obj)
    return ok(True)


@router.get("/latest")
def list_latest(
    db: DbSession,
    _: CurrentUser,
    keyword: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
):
    settings = get_settings()
    # 可选透传 Gateway；默认读主站镜像
    if _use_gateway() and settings.scada_data_source == "gateway":
        try:
            raw = scada_gateway_client.list_latest(limit=limit)
        except Exception as e:  # noqa: BLE001
            raise _gateway_error(e) from e
        tag_to_local = {
            p.tag_name: p
            for p in db.query(ScadaPoint).filter(ScadaPoint.deleted == 0).all()
        }
        items = []
        for r in raw:
            tag = r.get("tag_name")
            if keyword and tag and keyword not in tag:
                continue
            local = tag_to_local.get(tag)
            items.append(
                ScadaLatestOut(
                    point_id=local.id if local else int(r.get("point_id") or 0),
                    tag_name=tag or "",
                    node_id=r.get("node_id") or "",
                    value_type=r.get("value_type") or "number",
                    value_num=r.get("value_num"),
                    value_bool=r.get("value_bool"),
                    value_str=r.get("value_str"),
                    display_value=r.get("display_value"),
                    status_code=int(r.get("status_code") or 0),
                    status_name=r.get("status_name") or "Good",
                    ts_ms=int(r.get("ts_ms") or 0),
                    updated_at=None,
                    unit=local.unit if local else None,
                    description=local.description if local else None,
                ).model_dump()
            )
        return ok(items)

    q = (
        db.query(ScadaPointLatest, ScadaPoint)
        .outerjoin(ScadaPoint, ScadaPoint.id == ScadaPointLatest.point_id)
        .order_by(ScadaPointLatest.updated_at.desc())
    )
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(ScadaPointLatest.tag_name.like(like))
    rows = q.limit(limit).all()
    items = []
    for latest, point in rows:
        items.append(
            ScadaLatestOut(
                point_id=latest.point_id,
                tag_name=latest.tag_name,
                node_id=latest.node_id,
                value_type=latest.value_type,
                value_num=float(latest.value_num) if latest.value_num is not None else None,
                value_bool=latest.value_bool,
                value_str=latest.value_str,
                display_value=_display_value(
                    latest.value_type,
                    latest.value_num,
                    latest.value_bool,
                    latest.value_str,
                ),
                status_code=latest.status_code,
                status_name=latest.status_name,
                ts_ms=latest.ts_ms,
                updated_at=latest.updated_at,
                unit=point.unit if point else None,
                description=point.description if point else None,
            ).model_dump()
        )
    return ok(items)


@router.get("/history")
def list_history(
    db: DbSession,
    _: CurrentUser,
    tag_name: str | None = None,
    point_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    settings = get_settings()
    resolved_tag = tag_name
    if point_id is not None:
        point = get_or_404(db, ScadaPoint, point_id)
        resolved_tag = point.tag_name

    if (
        _use_gateway()
        and settings.scada_data_source == "gateway"
        and resolved_tag
    ):
        try:
            raw = scada_gateway_client.list_history(
                tag_name=resolved_tag,
                limit=page * page_size,
            )
        except Exception as e:  # noqa: BLE001
            raise _gateway_error(e) from e
        # 简易分页
        total = len(raw)
        start = (page - 1) * page_size
        chunk = raw[start : start + page_size]
        items = []
        for i, row in enumerate(chunk):
            items.append(
                ScadaHistoryOut(
                    id=i + start + 1,
                    tag_name=row.get("tag_name") or resolved_tag,
                    node_id=row.get("node_id") or "",
                    value_type=row.get("value_type") or "number",
                    value_num=row.get("value_num"),
                    value_bool=row.get("value_bool"),
                    value_str=row.get("value_str"),
                    status_name=row.get("status_name") or "Good",
                    ts_ms=int(row.get("ts_ms") or 0),
                    created_at=None,
                ).model_dump()
            )
        return ok(
            {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
            }
        )

    q = db.query(ScadaTagData)
    if resolved_tag:
        q = q.filter(ScadaTagData.tag_name == resolved_tag)
    q = q.order_by(ScadaTagData.ts_ms.desc(), ScadaTagData.id.desc())
    result = paginate(q, page, page_size)
    items = []
    for row in result["items"]:
        items.append(
            ScadaHistoryOut(
                id=row.id,
                tag_name=row.tag_name,
                node_id=row.node_id,
                value_type=row.value_type,
                value_num=float(row.value_num) if row.value_num is not None else None,
                value_bool=row.value_bool,
                value_str=row.value_str,
                status_name=row.status_name,
                ts_ms=row.ts_ms,
                created_at=row.created_at,
            ).model_dump()
        )
    result["items"] = items
    return ok(result)


@router.get("/equipment/{equipment_id}/values")
def equipment_point_values(equipment_id: int, db: DbSession, _: CurrentUser):
    """按设备关联变量查询最新值。

    优先使用 Equipment.scada_point_ids（兼容旧配置，支持 tag_name 或数字 id）；
    若为空则回退到 scada_points.equipment_id 外键关联（设备台账重建后的关联方式）。
    若设备有子设备且自身无测点，则汇总返回所有子设备的测点。
    """
    eq = (
        db.query(Equipment)
        .filter(Equipment.id == equipment_id, Equipment.deleted == 0)
        .first()
    )
    if not eq:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在")

    # 收集需要查询的设备：自身 + 子设备（当自身无 scada_point_ids 时）
    raw = (eq.scada_point_ids or "").strip()
    children: list[Equipment] = []
    if not raw:
        children = (
            db.query(Equipment)
            .filter(Equipment.deleted == 0, Equipment.parent_id == eq.id)
            .order_by(Equipment.id.asc())
            .all()
        )

    results: list[dict] = []

    if raw:
        tokens = [t.strip() for t in raw.replace(";", ",").split(",") if t.strip()]
        for token in tokens:
            item = EquipmentPointValue(
                equipment_id=eq.id,
                equipment_name=eq.name,
                equipment_code=eq.code,
                point_id_raw=token,
                found=False,
            )
            point = None
            if token.isdigit():
                point = (
                    db.query(ScadaPoint)
                    .filter(ScadaPoint.id == int(token), ScadaPoint.deleted == 0)
                    .first()
                )
                if not point:
                    point = (
                        db.query(ScadaPoint)
                        .filter(
                            ScadaPoint.deleted == 0,
                            ScadaPoint.tag_name == token,
                        )
                        .first()
                    )
                if not point:
                    point = (
                        db.query(ScadaPoint)
                        .filter(
                            ScadaPoint.deleted == 0,
                            ScadaPoint.node_id.like(f"%i={token}"),
                        )
                        .first()
                    )
            else:
                point = (
                    db.query(ScadaPoint)
                    .filter(ScadaPoint.tag_name == token, ScadaPoint.deleted == 0)
                    .first()
                )

            if point:
                latest = (
                    db.query(ScadaPointLatest)
                    .filter(ScadaPointLatest.point_id == point.id)
                    .first()
                )
                item.tag_name = point.tag_name
                item.unit = point.unit
                item.value_type = point.value_type
                item.point_category = point.point_category
                item.description = point.description
                if latest:
                    item.found = True
                    item.display_value = _display_value(
                        latest.value_type,
                        latest.value_num,
                        latest.value_bool,
                        latest.value_str,
                    )
                    item.ts_ms = latest.ts_ms
                else:
                    _fill_from_history(db, point, item)
            results.append(item.model_dump())
    else:
        # 回退：按 scada_points.equipment_id 外键查询
        # 查询自身 + 子设备的测点
        eq_ids = [eq.id] + [c.id for c in children]
        child_map = {c.id: c for c in children}
        points = (
            db.query(ScadaPoint)
            .filter(
                ScadaPoint.equipment_id.in_(eq_ids),
                ScadaPoint.deleted == 0,
                ScadaPoint.status == 1,
            )
            .order_by(ScadaPoint.equipment_id, ScadaPoint.point_category, ScadaPoint.tag_id)
            .all()
        )
        for point in points:
            owner = child_map.get(point.equipment_id, eq)
            item = EquipmentPointValue(
                equipment_id=owner.id,
                equipment_name=owner.name,
                equipment_code=owner.code,
                point_id_raw=str(point.id),
                found=False,
            )
            latest = (
                db.query(ScadaPointLatest)
                .filter(ScadaPointLatest.point_id == point.id)
                .first()
            )
            item.tag_name = point.tag_name
            item.unit = point.unit
            item.value_type = point.value_type
            item.point_category = point.point_category
            item.description = point.description
            if latest:
                item.found = True
                item.display_value = _display_value(
                    latest.value_type,
                    latest.value_num,
                    latest.value_bool,
                    latest.value_str,
                )
                item.ts_ms = latest.ts_ms
            else:
                _fill_from_history(db, point, item)
            results.append(item.model_dump())
    return ok(results)


def _fill_from_history(db, point: ScadaPoint, item: EquipmentPointValue) -> None:
    """从历史时序表取该测点最新一条，填充 item。"""
    hist = (
        db.query(ScadaTagData)
        .filter(ScadaTagData.tag_name == point.tag_name)
        .order_by(ScadaTagData.ts_ms.desc())
        .first()
    )
    if hist:
        item.found = True
        item.display_value = _display_value(
            point.value_type,
            hist.value_num,
            hist.value_bool,
            hist.value_str,
        )
        item.ts_ms = hist.ts_ms


# ============================================================
# 机组运行日报导出（Excel）
# ============================================================
import io as _io
from datetime import datetime, timedelta, timezone

from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# 日报数据列模板（B 列起共 24 列），{n} 为机组号；与日报导入脚本 COL_TAG_MAP 一致
_UNIT_REPORT_TAGS = [
    "FJ前池水位",
    "FJ后池水位",
    "M{n}电机UAB",
    "M{n}电机IA",
    "M{n}电机P",
    "M{n}电机Q",
    "M{n}电机COS",
    "M{n}励磁电压",
    "M{n}励磁电流",
    "M{n}叶片角度",
    "M{n}定子绕组A相温度1",
    "M{n}定子绕组A相温度2",
    "M{n}定子绕组B相温度1",
    "M{n}定子绕组B相温度2",
    "M{n}定子绕组C相温度1",
    "M{n}定子绕组C相温度2",
    "M{n}上导轴瓦温度1",
    "M{n}上导轴瓦温度2",
    "M{n}下导轴瓦温度1",
    "M{n}下导轴瓦温度2",
    "M{n}推力轴瓦温度1",
    "M{n}推力轴瓦温度2",
    "M{n}上油池温度",
    "M{n}下油池温度",
]
# 一级/二级表头（与日报模板一致）
_UNIT_REPORT_HEADER_1 = [
    "时间", "前池水位", "后池水位", "定子电压", "定子电流", "有功功率",
    "无功功率", "功率因数", "励磁电压", "励磁电流", "叶片角度",
    "定子温度", "", "", "", "", "",
    "轴瓦温度", "", "", "", "", "",
    "油槽温度", "",
]
_UNIT_REPORT_HEADER_2 = [
    "", "", "", "", "", "", "", "", "", "", "",
    "A相1", "A相2", "B相1", "B相2", "C相1", "C相2",
    "上导1", "上导2", "下导1", "下导2", "推力1", "推力2",
    "上油槽", "下油槽",
]
# 一级表头横向合并的列下标（openpyxl 1-based，L/Q、R/W、X/Y）
_UNIT_REPORT_GROUPS = [(12, 17), (18, 23), (24, 25)]
_UNIT_REPORT_COLS = 25
_LOCAL_TZ = timezone(timedelta(hours=8))
# 机组日报导出：未指定区间时取最近 24 小时；单次导出跨度上限 92 天
_UNIT_REPORT_DEFAULT_SPAN_MS = 24 * 3600 * 1000
_UNIT_REPORT_MAX_SPAN_MS = 92 * 24 * 3600 * 1000


def _parse_local_ms(value: str, *, end_of_day: bool) -> int:
    """把本地时间字符串（YYYY-MM-DD[ HH:mm:ss]）转成毫秒时间戳。"""
    text = value.strip().replace("T", " ")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"时间格式错误: {value}")
    if len(text) == 10:  # 只传了日期
        dt = dt.replace(hour=23, minute=59, second=59) if end_of_day else dt
    return int(dt.replace(tzinfo=_LOCAL_TZ).timestamp() * 1000)


def _unit_date_label(series: dict[int, dict[int, float]], fallback: str) -> str:
    if not series:
        return fallback
    stamps = sorted(series)
    d0 = datetime.fromtimestamp(stamps[0] / 1000, _LOCAL_TZ).strftime("%Y-%m-%d")
    d1 = datetime.fromtimestamp(stamps[-1] / 1000, _LOCAL_TZ).strftime("%Y-%m-%d")
    return d0 if d0 == d1 else f"{d0} 至 {d1}"


def _write_unit_sheet(ws, unit_no: int, series: dict[int, dict[int, float]],
                      date_label: str, printer: str) -> None:
    """按运行日报版式写一个机组工作表。"""
    ws.title = f"机组{unit_no}"
    last_col = get_column_letter(_UNIT_REPORT_COLS)
    thin = Side(style="thin", color="9AA7B4")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    base_font = Font(name="宋体", size=10)
    header_fill = PatternFill("solid", fgColor="EDF3FA")

    # 标题
    ws.merge_cells(f"A1:{last_col}1")
    ws["A1"] = f"大张庄泵站{unit_no}号机组运行记录"
    ws["A1"].font = Font(name="宋体", size=14, bold=True)
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    # 日期 / 打印人
    ws["A2"], ws["B2"], ws["S2"], ws["T2"] = "日期:", date_label, "打印人:", printer
    for addr in ("A2", "B2", "S2", "T2"):
        ws[addr].font = base_font
        ws[addr].alignment = Alignment(horizontal="left", vertical="center")

    # 两级表头
    for col, (h1, h2) in enumerate(
        zip(_UNIT_REPORT_HEADER_1, _UNIT_REPORT_HEADER_2), start=1
    ):
        for row, text in ((3, h1), (4, h2)):
            cell = ws.cell(row=row, column=col, value=text)
            cell.font = Font(name="宋体", size=10, bold=True)
            cell.alignment = center
            cell.border = border
            cell.fill = header_fill
    for col in range(1, 12):
        ws.merge_cells(start_row=3, start_column=col, end_row=4, end_column=col)
    for start, end in _UNIT_REPORT_GROUPS:
        ws.merge_cells(start_row=3, start_column=start, end_row=3, end_column=end)
    ws.row_dimensions[3].height = 24
    ws.row_dimensions[4].height = 20

    # 数据行：时间列沿用日报的序号（1..N）
    for seq, ts in enumerate(sorted(series), start=1):
        row = 4 + seq
        time_cell = ws.cell(row=row, column=1, value=seq)
        time_cell.font = base_font
        time_cell.alignment = center
        time_cell.border = border
        values = series[ts]
        for col in range(2, _UNIT_REPORT_COLS + 1):
            cell = ws.cell(row=row, column=col, value=values.get(col))
            cell.number_format = "0.0#"
            cell.font = base_font
            cell.alignment = center
            cell.border = border
        ws.row_dimensions[row].height = 18

    # 列宽 / 冻结表头 / 打印版式（横向、一页宽）
    ws.column_dimensions["A"].width = 7
    for col in range(2, _UNIT_REPORT_COLS + 1):
        ws.column_dimensions[get_column_letter(col)].width = 10.5
    ws.freeze_panes = "A5"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = "1:4"


@router.get("/history/export/unit-report")
def export_unit_report(
    db: DbSession,
    user: CurrentUser,
    unit: str = Query("all", description="机组范围：all 或 1-5"),
    start: str | None = Query(None, description="开始时间，如 2026-10-28 00:00:00"),
    end: str | None = Query(None, description="结束时间，如 2026-10-28 23:59:59"),
):
    """按机组运行日报格式导出历史数据（xlsx，每台机组一个工作表）。"""
    if unit == "all":
        units = [1, 2, 3, 4, 5]
    else:
        try:
            unit_no = int(unit)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"机组范围错误: {unit}")
        if unit_no not in (1, 2, 3, 4, 5):
            raise HTTPException(status_code=400, detail=f"机组范围错误: {unit}")
        units = [unit_no]

    start_ms = _parse_local_ms(start, end_of_day=False) if start else None
    end_ms = _parse_local_ms(end, end_of_day=True) if end else None
    # 未指定时间区间时默认最近 24 小时，避免对全表历史数据做无界扫描
    if start_ms is None and end_ms is None:
        end_ms = int(datetime.now(_LOCAL_TZ).timestamp() * 1000)
        start_ms = end_ms - _UNIT_REPORT_DEFAULT_SPAN_MS
    elif start_ms is None:
        start_ms = end_ms - _UNIT_REPORT_DEFAULT_SPAN_MS
    elif end_ms is None:
        end_ms = start_ms + _UNIT_REPORT_DEFAULT_SPAN_MS
    if start_ms > end_ms:
        raise HTTPException(status_code=400, detail="开始时间不能晚于结束时间")
    if end_ms - start_ms > _UNIT_REPORT_MAX_SPAN_MS:
        raise HTTPException(
            status_code=400,
            detail=f"查询跨度不能超过 {_UNIT_REPORT_MAX_SPAN_MS // 86_400_000} 天",
        )

    # 机组号 → {tag_name: 日报列号}（A 列为时间序号，数据从 B 列开始）
    unit_tag_cols = {
        n: {tpl.format(n=n): col for col, tpl in enumerate(_UNIT_REPORT_TAGS, start=2)}
        for n in units
    }
    # tag_name → [(机组号, 列号)]；前/后池水位为公共测点，会映射到所选全部机组
    tag_owner: dict[str, list[tuple[int, int]]] = {}
    for n, cols in unit_tag_cols.items():
        for tag, col in cols.items():
            tag_owner.setdefault(tag, []).append((n, col))

    q = (
        db.query(
            ScadaTagData.tag_name, ScadaTagData.ts_ms, ScadaTagData.value_num
        )
        .filter(
            ScadaTagData.tag_name.in_(list(tag_owner)),
            ScadaTagData.ts_ms >= start_ms,
            ScadaTagData.ts_ms <= end_ms,
        )
        .order_by(ScadaTagData.ts_ms.asc())
    )
    rows = q.all()

    series: dict[int, dict[int, dict[int, float | None]]] = {n: {} for n in units}
    for tag, ts_ms, value_num in rows:
        value = float(value_num) if value_num is not None else None
        for n, col in tag_owner.get(tag, ()):
            series[n].setdefault(int(ts_ms), {})[col] = value

    d0 = datetime.fromtimestamp(start_ms / 1000, _LOCAL_TZ).strftime("%Y-%m-%d")
    d1 = datetime.fromtimestamp(end_ms / 1000, _LOCAL_TZ).strftime("%Y-%m-%d")
    fallback = d0 if d0 == d1 else f"{d0} 至 {d1}"
    printer = user.display_name or user.username

    wb = Workbook()
    wb.remove(wb.active)
    for n in units:
        ws = wb.create_sheet()
        _write_unit_sheet(
            ws, n, series[n], _unit_date_label(series[n], fallback), printer
        )

    buf = _io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fn = f"unit_report_{datetime.now(_LOCAL_TZ).strftime('%Y%m%d_%H%M%S')}.xlsx"
    headers = {
        "Content-Disposition": f'attachment; filename="{fn}"',
        "Cache-Control": "no-cache",
    }
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
