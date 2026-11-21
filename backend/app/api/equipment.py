import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crud import ensure_unique, get_or_404, paginate, soft_delete
from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.alarm import Alarm
from app.models.equipment import (
    Equipment,
    EquipmentRunEvent,
    EquipmentType,
    MaintenanceVendor,
    Manufacturer,
)
from app.models.maintenance import MaintenanceRecord
from app.models.org import Department, Location
from app.models.repair import RepairOrder
from app.models.scada import ScadaPoint, ScadaPointLatest, ScadaTagData
from app.models.user import User
from app.schemas.equipment import (
    EquipmentCreate,
    EquipmentOut,
    EquipmentStats,
    EquipmentTypeCreate,
    EquipmentTypeOut,
    EquipmentTypeUpdate,
    EquipmentUpdate,
    VendorCreate,
    VendorOut,
    VendorUpdate,
)
from app.services.point_mapping import RUN_SIGNAL_TAG_SUFFIX, resolve_metrics
from app.services.run_time import summarize_run_events

router = APIRouter()

# 连续运行预警小时数（后续可做成配置项）
DEFAULT_RUN_TIMEOUT_HOURS = 48

# 未闭环维修工单状态：存在即表示设备处于检修流程（工单验收归档后自动退出）
OPEN_REPAIR_STATES = ("pending_dispatch", "dispatched", "processing", "pending_accept")

# 未闭环告警状态（与 alarm api 的 ACTIVE_STATUSES 保持一致）
ACTIVE_ALARM_STATUSES = ("pending", "processing", "pending_accept")

# 「已接数据设备集合」缓存有效期（秒）
_HAS_DATA_IDS_TTL_SEC = 60
_has_data_ids_cache: tuple[float, set[int]] | None = None


def _repair_state_map(db: Session) -> dict[int, str]:
    """设备 id → 派生检修状态：pending=待检修(有待派单工单) / overhaul=检修中(工单处置中)。

    检修状态不从 SCADA 或手工字段读取，而是对未闭环维修工单的存在性投影：
    人工报修 / 告警转单 / 维保转单三条路全部汇到维修工单，闭环强制验收，因此无遗漏无残留。
    """
    rows = (
        db.query(RepairOrder.equipment_id, RepairOrder.process_status)
        .filter(
            RepairOrder.deleted == 0,
            RepairOrder.status == 1,
            RepairOrder.process_status.in_(OPEN_REPAIR_STATES),
            RepairOrder.equipment_id.isnot(None),
        )
        .all()
    )
    state: dict[int, str] = {}
    for eq_id, st in rows:
        if state.get(eq_id) == "overhaul":
            continue
        state[eq_id] = "pending" if st == "pending_dispatch" else "overhaul"
    return state


def _apply(obj, data: dict) -> None:
    for k, v in data.items():
        setattr(obj, k, v)


# ---- Equipment Type ----
@router.get("/equipment-types")
def list_types(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    code: str | None = None,
):
    q = db.query(EquipmentType).filter(EquipmentType.deleted == 0)
    if keyword:
        q = q.filter(EquipmentType.name.like(f"%{keyword}%"))
    if code:
        q = q.filter(EquipmentType.code.like(f"%{code}%"))
    q = q.order_by(EquipmentType.id.asc())
    result = paginate(q, page, page_size)
    result["items"] = [
        EquipmentTypeOut.model_validate(i).model_dump() for i in result["items"]
    ]
    return ok(result)


@router.get("/equipment-types/options")
def type_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(EquipmentType)
        .filter(EquipmentType.deleted == 0, EquipmentType.status == 1)
        .order_by(EquipmentType.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name, "code": r.code} for r in rows])


@router.post("/equipment-types")
def create_type(body: EquipmentTypeCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:type:create"))):
    ensure_unique(db, EquipmentType, "code", body.code, message="分类代码已存在")
    obj = EquipmentType(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(EquipmentTypeOut.model_validate(obj).model_dump())


@router.put("/equipment-types/{item_id}")
def update_type(
    item_id: int, body: EquipmentTypeUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:type:update"))):
    obj = get_or_404(db, EquipmentType, item_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        ensure_unique(
            db, EquipmentType, "code", data["code"], exclude_id=item_id, message="分类代码已存在"
        )
    _apply(obj, data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(EquipmentTypeOut.model_validate(obj).model_dump())


@router.delete("/equipment-types/{item_id}")
def delete_type(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:type:delete"))):
    obj = get_or_404(db, EquipmentType, item_id)
    count = (
        db.query(Equipment)
        .filter(Equipment.type_id == item_id, Equipment.deleted == 0)
        .count()
    )
    if count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"该分类已被{count}台设备引用，请先解除关联",
        )
    soft_delete(db, obj)
    return ok(True)


# ---- Manufacturer ----
@router.get("/manufacturers")
def list_manufacturers(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    enterprise_code: str | None = None,
):
    q = db.query(Manufacturer).filter(Manufacturer.deleted == 0)
    if keyword:
        q = q.filter(Manufacturer.name.like(f"%{keyword}%"))
    if enterprise_code:
        q = q.filter(Manufacturer.enterprise_code == enterprise_code)
    q = q.order_by(Manufacturer.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [VendorOut.model_validate(i).model_dump() for i in result["items"]]
    return ok(result)


@router.get("/manufacturers/options")
def manufacturer_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(Manufacturer)
        .filter(Manufacturer.deleted == 0, Manufacturer.status == 1)
        .order_by(Manufacturer.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name} for r in rows])


@router.post("/manufacturers")
def create_manufacturer(body: VendorCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:mfr:create"))):
    obj = Manufacturer(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(VendorOut.model_validate(obj).model_dump())


@router.put("/manufacturers/{item_id}")
def update_manufacturer(
    item_id: int, body: VendorUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:mfr:update"))):
    obj = get_or_404(db, Manufacturer, item_id)
    _apply(obj, body.model_dump(exclude_unset=True))
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(VendorOut.model_validate(obj).model_dump())


@router.delete("/manufacturers/{item_id}")
def delete_manufacturer(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:mfr:delete"))):
    obj = get_or_404(db, Manufacturer, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- Maintenance Vendor ----
@router.get("/maintenance-vendors")
def list_maint_vendors(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    enterprise_code: str | None = None,
):
    q = db.query(MaintenanceVendor).filter(MaintenanceVendor.deleted == 0)
    if keyword:
        q = q.filter(MaintenanceVendor.name.like(f"%{keyword}%"))
    if enterprise_code:
        q = q.filter(MaintenanceVendor.enterprise_code == enterprise_code)
    q = q.order_by(MaintenanceVendor.id.desc())
    result = paginate(q, page, page_size)
    result["items"] = [VendorOut.model_validate(i).model_dump() for i in result["items"]]
    return ok(result)


@router.get("/maintenance-vendors/options")
def maint_vendor_options(db: DbSession, _: CurrentUser):
    rows = (
        db.query(MaintenanceVendor)
        .filter(MaintenanceVendor.deleted == 0, MaintenanceVendor.status == 1)
        .order_by(MaintenanceVendor.id.asc())
        .all()
    )
    return ok([{"id": r.id, "name": r.name} for r in rows])


@router.post("/maintenance-vendors")
def create_maint_vendor(body: VendorCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:maintainer:create"))):
    obj = MaintenanceVendor(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(VendorOut.model_validate(obj).model_dump())


@router.put("/maintenance-vendors/{item_id}")
def update_maint_vendor(
    item_id: int, body: VendorUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:maintainer:update"))):
    obj = get_or_404(db, MaintenanceVendor, item_id)
    _apply(obj, body.model_dump(exclude_unset=True))
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(VendorOut.model_validate(obj).model_dump())


@router.delete("/maintenance-vendors/{item_id}")
def delete_maint_vendor(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:maintainer:delete"))):
    obj = get_or_404(db, MaintenanceVendor, item_id)
    soft_delete(db, obj)
    return ok(True)


# ---- Equipment ----
# 运行信号点位：tag 以「电机断路器合位」结尾的开关量，最新值=1 视为设备运行
# 后缀与指标规则统一取自 app/services/point_mapping.py


def _scada_run_states(db: Session) -> dict[int, str]:
    """按 SCADA 运行点位派生设备运行状态（优先于台账 running_status 字段）。

    规则：设备自身或其子孙设备上存在 tag 以「电机断路器合位」结尾、**且有实时/历史数据**的
    bool 点位时——任一最新值为 1 → running；全部有值且都为 0 → stopped；
    点位无值 → 不派生（保留台账值，前端按未接入口径展示）。
    信号归属沿 parent_id 向上传播到所有祖先（机组状态由其开关柜的合位信号决定）。
    """
    points = (
        db.query(ScadaPoint.equipment_id, ScadaPoint.tag_name)
        .filter(
            ScadaPoint.deleted == 0,
            ScadaPoint.equipment_id.isnot(None),
            ScadaPoint.tag_name.like(f"%{RUN_SIGNAL_TAG_SUFFIX}"),
        )
        .all()
    )
    if not points:
        return {}

    # 仅保留有实时值或历史记录的点位：绑定了点位但从未采集到数据视为未接入，不参与派生
    live_tags = {
        t for (t,) in db.query(ScadaPointLatest.tag_name).all()
    }
    live_tags |= {
        t for (t,) in db.query(ScadaTagData.tag_name).distinct().all()
    }
    points = [(eq, t) for eq, t in points if t in live_tags]
    if not points:
        return {}

    tags = [t for _, t in points]
    # 最新值：优先 scada_point_latest，回退 scada_tag_data 每 tag 最新一条
    latest: dict[str, int | None] = {}
    for tag, vb in db.query(
        ScadaPointLatest.tag_name, ScadaPointLatest.value_bool
    ).filter(ScadaPointLatest.tag_name.in_(tags)).all():
        latest[tag] = vb
    missing = [t for t in tags if t not in latest]
    for tag in missing:
        row = (
            db.query(ScadaTagData.value_bool)
            .filter(ScadaTagData.tag_name == tag)
            .order_by(ScadaTagData.ts_ms.desc())
            .first()
        )
        latest[tag] = row[0] if row else None

    parent_of = {
        i: p
        for i, p in db.query(Equipment.id, Equipment.parent_id)
        .filter(Equipment.deleted == 0)
        .all()
    }

    def ancestors(eq_id: int) -> list[int]:
        chain, cur = [], eq_id
        while cur is not None:
            chain.append(cur)
            cur = parent_of.get(cur)
        return chain

    state: dict[int, dict] = {}
    for eq_id, tag in points:
        val = latest.get(tag)
        for aid in ancestors(int(eq_id)):
            entry = state.setdefault(aid, {"has_value": False, "any_on": False})
            if val is None:
                continue
            entry["has_value"] = True
            if val:
                entry["any_on"] = True
    return {
        eq: ("running" if v["any_on"] else "stopped")
        for eq, v in state.items()
        if v["has_value"]
    }


def _descendant_ids(db: Session, item_id: int) -> list[int]:
    """所有子孙设备 id（逐层下钻，不限深度）"""
    result: list[int] = []
    frontier = [item_id]
    while frontier:
        children = [
            r[0]
            for r in db.query(Equipment.id)
            .filter(Equipment.parent_id.in_(frontier), Equipment.deleted == 0)
            .all()
        ]
        result.extend(children)
        frontier = children
    return result


def _has_data_ids(db: Session) -> set[int]:
    """有实际数据接入的设备 id 集合：设备绑定了点位，且该点位存在历史数据或实时最新值。

    结果缓存 60 秒：该集合仅随 SCADA 采集新增而变化，避免每次列表/详情请求都做全表 DISTINCT。
    """
    global _has_data_ids_cache
    now = time.monotonic()
    if _has_data_ids_cache and now - _has_data_ids_cache[0] < _HAS_DATA_IDS_TTL_SEC:
        return _has_data_ids_cache[1]
    rows = (
        db.query(ScadaPoint.equipment_id)
        .join(ScadaTagData, ScadaTagData.tag_name == ScadaPoint.tag_name)
        .filter(ScadaPoint.equipment_id.isnot(None))
        .distinct()
        .all()
    )
    ids = {int(r[0]) for r in rows if r[0] is not None}
    # 实时表（scada_point_latest）有点位最新值同样视为已接入
    latest_rows = (
        db.query(ScadaPoint.equipment_id)
        .join(ScadaPointLatest, ScadaPointLatest.tag_name == ScadaPoint.tag_name)
        .filter(ScadaPoint.equipment_id.isnot(None))
        .distinct()
        .all()
    )
    ids |= {int(r[0]) for r in latest_rows if r[0] is not None}
    _has_data_ids_cache = (now, ids)
    return ids


def _tree_node_out(
    r: Equipment,
    type_map: dict[int, str],
    name_map: dict[int, str],
    data_ids: set[int],
    run_states: dict[int, str],
    repair_map: dict[int, str],
    child_ids: set[int],
    badge: dict | None = None,
) -> dict:
    """树节点精简输出：只含渲染树所需字段，完整字段由 /equipment/{id} 按需加载。"""
    node = {
        "id": r.id,
        "name": r.name,
        "code": r.code,
        "parent_id": r.parent_id,
        "parent_name": name_map.get(r.parent_id) if r.parent_id else None,
        "type_id": r.type_id,
        "type_name": type_map.get(r.type_id) if r.type_id else None,
        "unit_no": r.unit_no,
        "has_data": r.id in data_ids,
        "running_status": run_states.get(r.id, r.running_status),
        "repair_state": repair_map.get(r.id),
        "is_leaf": r.id not in child_ids,
        "children": [],
    }
    if badge is not None:
        # 懒加载一次只返回一层，前端拿不到子孙，徽章汇总值由服务端按子树算好
        node["alarm_total"] = badge["alarm_total"]
        node["alarm_level"] = badge["alarm_level"]
        node["repair_total"] = badge["repair_total"]
    return node


def _subtree_badges(db: Session, root_ids: list[int]) -> dict[int, dict]:
    """按子树汇总徽章数据：未闭环告警数/最高等级、未闭环工单数。

    只给懒加载树用：接口一次仅返回一层子节点，前端无法再递归 children 汇总，
    因此在服务端沿设备层级把子孙数据累加到每个返回节点上。
    """
    if not root_ids:
        return {}
    parent_of = dict(
        db.query(Equipment.id, Equipment.parent_id)
        .filter(Equipment.deleted == 0)
        .all()
    )
    children_of: dict[int | None, list[int]] = {}
    for eid, pid in parent_of.items():
        children_of.setdefault(pid, []).append(eid)

    alarm_rows = (
        db.query(
            Alarm.equipment_id,
            func.count(Alarm.id),
            func.min(Alarm.alarm_level),
        )
        .filter(
            Alarm.deleted == 0,
            Alarm.alarm_status.in_(ACTIVE_ALARM_STATUSES),
            Alarm.equipment_id.isnot(None),
        )
        .group_by(Alarm.equipment_id)
        .all()
    )
    self_alarm = {int(eid): (int(cnt), int(lv)) for eid, cnt, lv in alarm_rows}

    repair_rows = (
        db.query(RepairOrder.equipment_id, func.count(RepairOrder.id))
        .filter(
            RepairOrder.deleted == 0,
            RepairOrder.status == 1,
            RepairOrder.process_status.in_(OPEN_REPAIR_STATES),
            RepairOrder.equipment_id.isnot(None),
        )
        .group_by(RepairOrder.equipment_id)
        .all()
    )
    self_repair = {int(eid): int(cnt) for eid, cnt in repair_rows}

    result: dict[int, dict] = {}

    def agg(eid: int) -> tuple[int, int, int]:
        if eid in result:
            return (
                result[eid]["alarm_total"],
                result[eid]["alarm_level"],
                result[eid]["repair_total"],
            )
        cnt, lv = self_alarm.get(eid, (0, 0))
        rep = self_repair.get(eid, 0)
        for child in children_of.get(eid, ()):
            c_cnt, c_lv, c_rep = agg(child)
            cnt += c_cnt
            rep += c_rep
            if c_lv and (lv == 0 or c_lv < lv):
                lv = c_lv
        result[eid] = {"alarm_total": cnt, "alarm_level": lv, "repair_total": rep}
        return cnt, lv, rep

    for rid in root_ids:
        agg(rid)
    return result


def _eq_out(
    db: Session,
    e: Equipment,
    data_ids: set[int] | None = None,
    run_states: dict[int, str] | None = None,
) -> dict:
    data = EquipmentOut.model_validate(e).model_dump()
    # SCADA 运行点位派生状态优先于台账字段
    if run_states and e.id in run_states:
        data["running_status"] = run_states[e.id]
        data["run_status_source"] = "scada"
    else:
        data["run_status_source"] = "manual"
    t = (
        db.query(EquipmentType)
        .filter(EquipmentType.id == e.type_id, EquipmentType.deleted == 0)
        .first()
    )
    data["type_name"] = t.name if t else None
    if e.manufacturer_id:
        m = (
            db.query(Manufacturer)
            .filter(Manufacturer.id == e.manufacturer_id, Manufacturer.deleted == 0)
            .first()
        )
        data["manufacturer_name"] = m.name if m else None
    if e.department_id:
        d = (
            db.query(Department)
            .filter(Department.id == e.department_id, Department.deleted == 0)
            .first()
        )
        data["department_name"] = d.name if d else None
    if e.location_id:
        loc = (
            db.query(Location)
            .filter(Location.id == e.location_id, Location.deleted == 0)
            .first()
        )
        data["location_name"] = loc.name if loc else None
    if e.maintainer_id:
        v = (
            db.query(MaintenanceVendor)
            .filter(
                MaintenanceVendor.id == e.maintainer_id,
                MaintenanceVendor.deleted == 0,
            )
            .first()
        )
        data["maintainer_name"] = v.name if v else None
    data["has_data"] = e.id in data_ids if data_ids is not None else False
    return data


@router.get("/equipment/stats")
def equipment_stats(db: DbSession, _: CurrentUser):
    # 设备总数 = 全部在用台账设备（不含纯分组节点，分组只是层级容器不是设备）
    rows = (
        db.query(Equipment)
        .filter(
            Equipment.deleted == 0,
            Equipment.status == 1,
            ~Equipment.code.like("DZZ-GRP-%"),
        )
        .all()
    )
    total = len(rows)
    # 运行/离线按 SCADA 运行点位派生（无信号的设备保留台账值）
    run_states = _scada_run_states(db)

    def _eff_status(r: Equipment) -> str:
        return run_states.get(r.id, r.running_status)

    running = sum(1 for r in rows if _eff_status(r) == "running")
    offline = total - running
    smap = _repair_state_map(db)
    pending = sum(1 for r in rows if smap.get(r.id) == "pending")
    overhaul = sum(1 for r in rows if smap.get(r.id) == "overhaul")
    fault = sum(1 for r in rows if r.maintain_status == "fault")
    timeout = get_settings()
    _ = timeout
    warnings = []
    for r in rows:
        if (
            _eff_status(r) == "running"
            and (r.continuous_run_hours or 0) > DEFAULT_RUN_TIMEOUT_HOURS
        ):
            warnings.append(
                {
                    "equipment_id": r.id,
                    "equipment_code": r.code,
                    "equipment_name": r.name,
                    "continuous_run_hours": r.continuous_run_hours,
                    "threshold_hours": DEFAULT_RUN_TIMEOUT_HOURS,
                    "message": (
                        f"{r.name}超时：已连续运行{r.continuous_run_hours:.0f}小时，"
                        f"超出预警时间（{DEFAULT_RUN_TIMEOUT_HOURS}小时）"
                    ),
                }
            )
    stats = EquipmentStats(
        total=total,
        running=running,
        offline=offline,
        pending=pending,
        overhaul=overhaul,
        fault=fault,
        running_ratio=round(running / total * 100, 1) if total else 0,
        offline_ratio=round(offline / total * 100, 1) if total else 0,
        pending_ratio=round(pending / total * 100, 1) if total else 0,
        overhaul_ratio=round(overhaul / total * 100, 1) if total else 0,
        fault_ratio=round(fault / total * 100, 1) if total else 0,
        timeout_warnings=warnings,
    )
    return ok(stats.model_dump())


@router.get("/equipment")
def list_equipment(
    db: DbSession,
    _: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    name: str | None = None,
    code: str | None = None,
    running_status: str | None = None,
    maintain_status: str | None = None,
    repair_state: str | None = Query(None, description="派生检修状态：pending=待检修 overhaul=检修中"),
    offline: bool = Query(False, description="仅看离线设备（SCADA 运行状态非运行中）"),
    tree: bool = Query(False, description="返回树结构（仅顶级设备，子设备挂 children）"),
    lazy: bool = Query(False, description="懒加载：只返回指定父级（parent_id 为空即顶级）的直接子节点"),
    parent_id: int | None = Query(None, description="配合 lazy：父设备 ID，为空表示顶级"),
):
    run_states = _scada_run_states(db)

    def _eff(r: Equipment) -> str:
        return run_states.get(r.id, r.running_status)

    q = db.query(Equipment).filter(Equipment.deleted == 0)
    if name:
        q = q.filter(Equipment.name.like(f"%{name}%"))
    if code:
        q = q.filter(Equipment.code == code)
    if maintain_status:
        q = q.filter(Equipment.maintain_status == maintain_status)

    # 懒加载：只返回指定父级的直接子节点（精简字段 + is_leaf），展开时才请求下一层
    if lazy:
        lq = db.query(Equipment).filter(Equipment.deleted == 0)
        if parent_id:
            lq = lq.filter(Equipment.parent_id == parent_id)
        else:
            lq = lq.filter(Equipment.parent_id.is_(None))
        if name:
            lq = lq.filter(Equipment.name.like(f"%{name}%"))
        if code:
            lq = lq.filter(Equipment.code == code)
        if maintain_status:
            lq = lq.filter(Equipment.maintain_status == maintain_status)
        lrows = lq.order_by(Equipment.id.asc()).all()

        smap = _repair_state_map(db)
        data_ids = _has_data_ids(db)
        ids = [r.id for r in lrows]
        child_set = (
            {
                x[0]
                for x in db.query(Equipment.parent_id)
                .filter(Equipment.parent_id.in_(ids), Equipment.deleted == 0)
                .distinct()
                .all()
                if x[0]
            }
            if ids
            else set()
        )
        type_ids = {r.type_id for r in lrows if r.type_id}
        type_map = (
            dict(
                db.query(EquipmentType.id, EquipmentType.name)
                .filter(EquipmentType.id.in_(type_ids), EquipmentType.deleted == 0)
                .all()
            )
            if type_ids
            else {}
        )
        name_map = {r.id: r.name for r in lrows}
        if parent_id and parent_id not in name_map:
            p = db.query(Equipment.name).filter(Equipment.id == parent_id).first()
            if p:
                name_map[parent_id] = p[0]
        badges = _subtree_badges(db, ids)
        items = [
            _tree_node_out(
                r, type_map, name_map, data_ids, run_states, smap, child_set, badges.get(r.id)
            )
            for r in lrows
        ]
        return ok({"items": items, "total": len(items), "page": 1, "page_size": len(items) or 1})

    # 树结构模式：先处理 tree，再在 tree 内应用 repair_state/running_status 过滤
    if tree:
        # 递归组装完整树（支持任意层级：分组 → 闸门 → 启闭机）
        tq = db.query(Equipment).filter(Equipment.deleted == 0)
        if name:
            tq = tq.filter(Equipment.name.like(f"%{name}%"))
        if code:
            tq = tq.filter(Equipment.code == code)
        if maintain_status:
            tq = tq.filter(Equipment.maintain_status == maintain_status)
        rows = tq.order_by(Equipment.id.asc()).all()

        # running_status / offline 按 SCADA 派生状态过滤（Python 层，SQL 里的是台账静态字段）
        if running_status:
            rows = [r for r in rows if _eff(r) == running_status]
        if offline:
            rows = [r for r in rows if _eff(r) != "running"]

        smap = _repair_state_map(db)
        data_ids = _has_data_ids(db)
        all_ids = [r.id for r in rows]
        child_set = (
            {
                x[0]
                for x in db.query(Equipment.parent_id)
                .filter(Equipment.parent_id.in_(all_ids), Equipment.deleted == 0)
                .distinct()
                .all()
                if x[0]
            }
            if all_ids
            else set()
        )
        type_ids = {r.type_id for r in rows if r.type_id}
        type_map = (
            dict(
                db.query(EquipmentType.id, EquipmentType.name)
                .filter(EquipmentType.id.in_(type_ids), EquipmentType.deleted == 0)
                .all()
            )
            if type_ids
            else {}
        )
        name_map = {r.id: r.name for r in rows}
        nodes: dict[int, dict] = {}
        for r in rows:
            nodes[r.id] = _tree_node_out(
                r, type_map, name_map, data_ids, run_states, smap, child_set
            )
        roots: list[dict] = []
        for r in rows:
            node = nodes[r.id]
            parent = nodes.get(r.parent_id) if r.parent_id else None
            (parent["children"].append(node) if parent else roots.append(node))

        # repair_state 过滤：保留自身或任一子孙匹配未闭环工单的节点
        if repair_state in ("pending", "overhaul"):
            in_states = (
                ("pending_dispatch",)
                if repair_state == "pending"
                else ("dispatched", "processing", "pending_accept")
            )
            repair_eq_ids = {
                int(r[0])
                for r in db.query(RepairOrder.equipment_id)
                .filter(
                    RepairOrder.deleted == 0,
                    RepairOrder.status == 1,
                    RepairOrder.process_status.in_(in_states),
                    RepairOrder.equipment_id.isnot(None),
                )
                .all()
            }

            def _prune(node: dict) -> bool:
                node["children"] = [c for c in node["children"] if _prune(c)]
                return node["id"] in repair_eq_ids or bool(node["children"])

            roots = [r for r in roots if _prune(r)]

        # 自底向上汇总：has_data 任一子孙接入即视为接入；无 SCADA 信号的父节点状态由子设备派生
        def _rollup(node: dict) -> None:
            for c in node["children"]:
                _rollup(c)
            if not node["has_data"] and any(c["has_data"] for c in node["children"]):
                node["has_data"] = True
            if node["id"] not in run_states and node["children"]:
                node["running_status"] = (
                    "running"
                    if any(c["running_status"] == "running" for c in node["children"])
                    else "stopped"
                )

        for r in roots:
            _rollup(r)
        return ok({"items": roots, "total": len(roots), "page": 1, "page_size": len(roots) or 1})

    # 非 tree 模式：原有逻辑
    if repair_state in ("pending", "overhaul"):
        in_states = (
            ("pending_dispatch",)
            if repair_state == "pending"
            else ("dispatched", "processing", "pending_accept")
        )
        q = q.filter(
            Equipment.id.in_(
                db.query(RepairOrder.equipment_id).filter(
                    RepairOrder.deleted == 0,
                    RepairOrder.status == 1,
                    RepairOrder.process_status.in_(in_states),
                    RepairOrder.equipment_id.isnot(None),
                )
            )
        )

    q = q.order_by(Equipment.id.desc())
    equipment_rows = q.all()
    # running_status / offline 按 SCADA 派生状态过滤（Python 层）
    if running_status:
        equipment_rows = [r for r in equipment_rows if _eff(r) == running_status]
    if offline:
        equipment_rows = [r for r in equipment_rows if _eff(r) != "running"]
    total_count = len(equipment_rows)
    equipment_rows = equipment_rows[(page - 1) * page_size : page * page_size]
    smap = _repair_state_map(db)
    data_ids = _has_data_ids(db)
    result = {"items": [], "total": total_count, "page": page, "page_size": page_size}
    for e in equipment_rows:
        d = _eq_out(db, e, data_ids, run_states)
        d["repair_state"] = smap.get(e.id)
        result["items"].append(d)
    return ok(result)


@router.get("/equipment/options")
def equipment_options(db: DbSession, _: CurrentUser, tree: bool = Query(False)):
    rows = (
        db.query(Equipment)
        .filter(Equipment.deleted == 0, Equipment.status == 1)
        .order_by(Equipment.id.asc())
        .all()
    )
    items = [
        {
            "id": r.id,
            "name": r.name,
            "code": r.code,
            "parent_id": r.parent_id,
            "scada_point_ids": r.scada_point_ids,
        }
        for r in rows
    ]
    if not tree:
        return ok(items)

    # 树结构：parent_id 挂载，找不到父节点的作为顶级
    by_id = {i["id"]: {**i, "children": []} for i in items}
    roots: list[dict] = []
    for node in by_id.values():
        pid = node.get("parent_id")
        parent = by_id.get(pid) if pid else None
        if parent is not None:
            parent["children"].append(node)
        else:
            roots.append(node)
    for node in by_id.values():
        node.pop("parent_id", None)
    return ok(roots)


# ---- 设备运行记录（启停事件 + 统计） ----
# 注意：必须注册在 /equipment/{item_id} 之前，否则 run-events/run-stats 会被当作 item_id 拦截（422）
@router.get("/equipment/run-events")
def list_run_events(
    db: DbSession,
    _: CurrentUser,
    equipment_id: int | None = Query(None),
    event_type: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    q = db.query(EquipmentRunEvent).filter(EquipmentRunEvent.deleted == 0)
    if equipment_id:
        q = q.filter(EquipmentRunEvent.equipment_id == equipment_id)
    if event_type:
        q = q.filter(EquipmentRunEvent.event_type == event_type)
    if start:
        q = q.filter(EquipmentRunEvent.event_time >= start)
    if end:
        q = q.filter(EquipmentRunEvent.event_time <= end)
    q = q.order_by(EquipmentRunEvent.event_time.desc())
    return ok(paginate(q, page, page_size))


@router.post("/equipment/run-events")
def create_run_event(
    body: dict,
    db: DbSession,
    current_user: User = Depends(require_perm("eq:run:event")),
):
    """记录设备启停事件，并同步设备 running_status 与 continuous_run_hours。"""
    if body.get("event_type") not in ("start", "stop"):
        raise HTTPException(status_code=400, detail="event_type 仅支持 start/stop")
    # 解析事件时间：兼容 ISO8601 与 'YYYY-MM-DD HH:MM:SS'
    raw_time = body.get("event_time")
    if raw_time:
        if isinstance(raw_time, datetime):
            event_time = raw_time
        else:
            try:
                event_time = datetime.fromisoformat(str(raw_time))
            except ValueError:
                try:
                    event_time = datetime.strptime(str(raw_time), "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    raise HTTPException(status_code=400, detail="event_time 时间格式非法")
        if event_time > datetime.now():
            raise HTTPException(status_code=400, detail="event_time 不能晚于当前时间")
    else:
        event_time = datetime.now()
    eq = get_or_404(db, Equipment, body["equipment_id"])
    evt = EquipmentRunEvent(
        equipment_id=eq.id,
        equipment_name=eq.name,
        event_type=body["event_type"],
        event_time=event_time,
        source=body.get("source", "manual"),
        remark=body.get("remark"),
    )
    db.add(evt)
    # 同步设备状态
    if evt.event_type == "start":
        eq.running_status = "running"
        # 累计停机时长（小时）：取本次 start 到上一次 stop 的时长
        prev_stop = (
            db.query(EquipmentRunEvent)
            .filter(
                EquipmentRunEvent.equipment_id == eq.id,
                EquipmentRunEvent.event_type == "stop",
                EquipmentRunEvent.deleted == 0,
            )
            .order_by(EquipmentRunEvent.event_time.desc())
            .first()
        )
        if prev_stop:
            hours = (evt.event_time - prev_stop.event_time).total_seconds() / 3600
            eq.continuous_stop_hours = (eq.continuous_stop_hours or 0) + max(hours, 0)
    elif evt.event_type == "stop":
        eq.running_status = "stopped"
        # 累计运行时长（小时）：取本次 start 到 stop 的时长
        prev = (
            db.query(EquipmentRunEvent)
            .filter(
                EquipmentRunEvent.equipment_id == eq.id,
                EquipmentRunEvent.event_type == "start",
                EquipmentRunEvent.deleted == 0,
            )
            .order_by(EquipmentRunEvent.event_time.desc())
            .first()
        )
        if prev:
            hours = (evt.event_time - prev.event_time).total_seconds() / 3600
            eq.continuous_run_hours = (eq.continuous_run_hours or 0) + max(hours, 0)
    db.add(eq)
    db.commit()
    return ok(evt)


@router.get("/equipment/run-stats")
def run_stats(
    db: DbSession,
    _: CurrentUser,
    equipment_id: int | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
):
    """统计指定时间段内各设备的启停次数、累计运行时长、当前连续运行/停机时长。

    优先从 equipment_run_event 事件表计算；若无事件记录，则回退到 equipment 台账的
    continuous_run_hours 字段，确保排行面板始终有数据展示。
    """
    q = db.query(EquipmentRunEvent).filter(EquipmentRunEvent.deleted == 0)
    if equipment_id:
        q = q.filter(EquipmentRunEvent.equipment_id == equipment_id)
    if start:
        q = q.filter(EquipmentRunEvent.event_time >= start)
    if end:
        q = q.filter(EquipmentRunEvent.event_time <= end)
    events = q.order_by(EquipmentRunEvent.event_time.asc()).all()

    if not events:
        # 回退：优先取顶层主机组（type_id=1，parent_id IS NULL），
        # 运行和停机的都显示（run_hours=0 也要显示为 0 h）
        eq_q = db.query(Equipment).filter(
            Equipment.deleted == 0,
            Equipment.parent_id.is_(None),
            Equipment.type_id == 1,  # 主机组类
        )
        if equipment_id:
            eq_q = eq_q.filter(Equipment.id == equipment_id)
        items = eq_q.all()
        # 如果没有主机组类，放宽为所有顶层设备
        if len(items) == 0:
            items = db.query(Equipment).filter(
                Equipment.deleted == 0,
                Equipment.parent_id.is_(None),
            ).all()
        result: list[dict] = []
        for eq in items:
            ch = eq.continuous_run_hours or 0.0
            result.append({
                "equipment_id": eq.id,
                "equipment_name": eq.name,
                "start_count": 0,
                "stop_count": 0,
                "run_hours": round(ch, 2),
                "stop_hours": round(eq.continuous_stop_hours or 0, 2),
                "current_state": eq.running_status if eq.running_status in ("running", "stopped") else None,
                "current_since": None,
                "current_hours": round(ch, 2),
                "current_seconds": int(round(ch * 3600)),
                "last_event_type": None,
                "last_event_time": None,
            })
        # 运行的在前（run_hours DESC），停机的在后（run_hours=0 也显示）
        result.sort(key=lambda x: (-x["run_hours"], x["equipment_name"]))
        return ok(result)

    by_eq: dict[int, list] = {}
    for e in events:
        by_eq.setdefault(e.equipment_id, []).append(e)

    now = datetime.now()
    if end:
        # 指定截止时间时，未闭合段只算到截止点，避免把未来时间计入累计
        try:
            now = min(now, datetime.fromisoformat(end))
        except ValueError:
            pass
    result: list[dict] = []
    for eq_id, evts in by_eq.items():
        # 与快照共用同一计算引擎：累计含未闭合段，连续段由最后一条事件决定
        summary = summarize_run_events(evts, now=now)
        data = summary.as_dict(
            equipment_id=eq_id,
            equipment_name=evts[0].equipment_name,
        )
        data["last_event_type"] = evts[-1].event_type
        data["last_event_time"] = (
            evts[-1].event_time.isoformat() if evts[-1].event_time else None
        )
        result.append(data)
    return ok(result)


@router.get("/equipment/{item_id}")
def get_equipment(item_id: int, db: DbSession, _: CurrentUser):
    obj = get_or_404(db, Equipment, item_id)
    data_ids = _has_data_ids(db)
    run_states = _scada_run_states(db)
    data = _eq_out(db, obj, data_ids, run_states)
    data["repair_state"] = _repair_state_map(db).get(item_id)
    # 未闭环工单摘要（自身 + 子设备工单汇总，方便前端台账页直接跳转）
    own_ids = [item_id]
    child_ids = [
        c.id
        for c in db.query(Equipment).filter(
            Equipment.deleted == 0, Equipment.parent_id == item_id
        ).all()
    ]
    all_scope_ids = set(own_ids + child_ids)
    open_repairs_rows = (
        db.query(
            RepairOrder.id, RepairOrder.order_no, RepairOrder.source,
            RepairOrder.process_status, RepairOrder.equipment_id,
            RepairOrder.equipment_name, RepairOrder.description,
            RepairOrder.created_at, RepairOrder.alarm_id,
        )
        .filter(
            RepairOrder.deleted == 0,
            RepairOrder.status == 1,
            RepairOrder.equipment_id.in_(all_scope_ids),
            RepairOrder.process_status.in_(OPEN_REPAIR_STATES),
        )
        .order_by(RepairOrder.created_at.desc())
        .all()
    )
    data["open_repairs"] = [
        {
            "id": r[0], "order_no": r[1], "source": r[2],
            "process_status": r[3], "equipment_id": r[4],
            "equipment_name": r[5], "description": r[6],
            "created_at": r[7].isoformat() if r[7] else None,
            "alarm_id": r[8],
        }
        for r in open_repairs_rows
    ]
    # 子设备列表
    children = (
        db.query(Equipment)
        .filter(Equipment.deleted == 0, Equipment.parent_id == item_id)
        .order_by(Equipment.id.asc())
        .all()
    )
    data["children"] = [_eq_out(db, c, data_ids, run_states) for c in children]
    # 父设备自身可能没有点位，只要任一子孙设备接入数据即视为已接入
    if not data["has_data"]:
        if any(d in data_ids for d in _descendant_ids(db, item_id)):
            data["has_data"] = True
    # 无 SCADA 运行信号的父节点：状态由子设备派生（与树展示一致）
    if item_id not in run_states and data["children"]:
        data["running_status"] = (
            "running"
            if any(c["running_status"] == "running" for c in data["children"])
            else "stopped"
        )
    # 父设备名称
    if obj.parent_id:
        p = db.query(Equipment).filter(Equipment.id == obj.parent_id).first()
        data["parent_name"] = p.name if p else None
    return ok(data)


@router.get("/equipment/{item_id}/snapshot")
def equipment_snapshot(item_id: int, db: DbSession, _: CurrentUser):
    """设备事实快照：从 scada_points + scada_tag_data + repair/alarm/maintenance 聚合。

    包含该设备 + 所有子设备的汇总，详情卡一次请求够用。
    注：scada_point_latest 表可能为空（无 SCADA 推送），回退从 scada_tag_data 取最新值。
    """
    obj = get_or_404(db, Equipment, item_id)
    scope_ids = [item_id] + _descendant_ids(db, item_id)

    # === 1) 测点统计（从 scada_points 聚合） ===
    scoped_points = db.query(ScadaPoint).filter(
        ScadaPoint.deleted == 0, ScadaPoint.equipment_id.in_(scope_ids),
    ).all()
    point_total = len(scoped_points)
    point_by_category: dict[str, int] = {}
    point_ids = [sp.id for sp in scoped_points]
    tag_to_point: dict[str, ScadaPoint] = {}
    for sp in scoped_points:
        cat = sp.point_category or "other"
        point_by_category[cat] = point_by_category.get(cat, 0) + 1
        if sp.tag_name:
            tag_to_point[sp.tag_name] = sp

    # === 2) 实时值 + 越限检测（优先 scada_point_latest，回退 scada_tag_data） ===
    # 2a 尝试从 scada_point_latest 取（有 SCADA 推送时）
    latest_rows = db.query(ScadaPointLatest).filter(
        ScadaPointLatest.point_id.in_(point_ids),
    ).all() if point_ids else []

    # 2b 如果 latest 表没有数据 → 从 scada_tag_data 按 tag_name 取最新一条
    if not latest_rows:
        tag_names = list(tag_to_point.keys())
        if tag_names:
            # 取每个 tag_name 的 id 最大的一条（id 自增 = 最新）
            max_ids = (
                db.query(
                    func.max(ScadaTagData.id).label("mid"),
                )
                .filter(ScadaTagData.tag_name.in_(tag_names))
                .group_by(ScadaTagData.tag_name)
                .subquery()
            )
            hist_rows = (
                db.query(
                    ScadaTagData.tag_name,
                    ScadaTagData.value_num,
                    ScadaTagData.value_bool,
                    ScadaTagData.status_code,
                    ScadaTagData.status_name,
                    ScadaTagData.created_at,
                )
                .filter(ScadaTagData.id.in_(max_ids))
                .all()
            )
        else:
            hist_rows = []
    else:
        hist_rows = None  # 标记为用 latest 表

    online_count = 0
    over_limit_count = 0
    over_limit_points: list[dict] = []
    grouped: dict[str, list[dict]] = {}
    latest_ts_ms = 0
    now_ms = int(datetime.now().timestamp() * 1000)

    # 辅助：从设备名推导机组编号（"大张庄1号机组-轴承组" -> "1"）
    import re as _re
    def _derive_unit_num(eq_name: str | None) -> str | None:
        if not eq_name:
            return None
        # 匹配 X号机组 / X号泵 / 1#机组 等
        m = _re.search(r'(\d+)[#号]机组', eq_name)
        if m:
            return m.group(1)
        m = _re.search(r'(\d+)号泵', eq_name)
        if m:
            return m.group(1)
        return None

    # 辅助：清洗 tag_name 的机组前缀
    def _clean_tag(tag: str, unit_num: str | None) -> str:
        if not tag:
            return tag
        # M1xxx / M2xxx 这种 → 如果 unit_num="1" 就去 "M1"
        if unit_num:
            prefix = f"M{unit_num}"
            if tag.startswith(prefix) and len(tag) > len(prefix):
                rest = tag[len(prefix):]
                if rest and rest[0] in "0123456789":
                    # M11xxx 这种边界 — M1 + 1xxx 但机组是 1 号，去掉 M1 会变成 "1xxx"
                    # 这时候就不去了，避免歧义
                    return tag
                return rest
            # FJ前池水位 / FJ后池水位 — 也尝试
            fj = f"FJ{'前' if unit_num == '1' else ''}"
        return tag

    # 先把历史查询结果整理成 {tag_name: {value, ts_ms, ...}} 字典，便于快速查找
    hist_by_tag: dict[str, dict] = {}
    if hist_rows is not None:
        for h in hist_rows:
            tag_name, val_num, val_bool, status_code, status_name, created_at = h
            val = float(val_num) if val_num is not None else (
                bool(val_bool) if val_bool is not None else None
            )
            ts_ms = int(created_at.timestamp() * 1000) if created_at else 0
            hist_by_tag[tag_name] = {
                "value": val,
                "status_code": status_code,
                "status_name": status_name,
                "updated_at": created_at.isoformat() if created_at else None,
                "ts_ms": ts_ms,
            }
    elif latest_rows:
        for lat in latest_rows:
            tag = lat.tag_name
            if not tag:
                continue
            val = float(lat.value_num) if lat.value_num is not None else (
                bool(lat.value_bool) if lat.value_bool is not None else None
            )
            ts_ms = lat.ts_ms or 0
            hist_by_tag[tag] = {
                "value": val,
                "status_code": lat.status_code,
                "status_name": lat.status_name,
                "updated_at": lat.updated_at.isoformat() if lat.updated_at else None,
                "ts_ms": ts_ms,
            }

    # 关键：遍历全部点位定义（scoped_points），有历史值带上，没有标记离线
    for sp in scoped_points:
        raw = hist_by_tag.get(sp.tag_name or "")
        eq = db.query(Equipment).filter(Equipment.id == sp.equipment_id).first()
        eq_name = eq.name if eq else None
        unit_num = _derive_unit_num(eq_name)

        if raw is not None:
            online_count += 1
            val = raw["value"]
            ts_ms = raw["ts_ms"]
            if ts_ms > latest_ts_ms:
                latest_ts_ms = ts_ms
            freshness_sec = (now_ms - ts_ms) // 1000 if ts_ms else None
        else:
            val = None
            freshness_sec = None

        # 显示名：有 description 用 description；否则 tag_name 去机组前缀
        if sp.description and sp.description.strip():
            display_name = sp.description.strip()
        else:
            display_name = _clean_tag(sp.tag_name or "", unit_num)

        entry: dict = {
            "tag_name": sp.tag_name,
            "display_name": display_name,
            "description": sp.description or sp.tag_name,
            "equipment_name": eq_name,
            "equipment_id": sp.equipment_id,
            "point_category": sp.point_category or "other",
            "value": val if isinstance(val, (int, float)) else None,
            "is_bool": isinstance(val, bool),
            "is_online": raw is not None,
            "unit": sp.unit or _infer_unit(sp.point_category or ""),
            "min_value": float(sp.min_value) if sp.min_value is not None else None,
            "max_value": float(sp.max_value) if sp.max_value is not None else None,
            "hi": float(sp.hi) if sp.hi is not None else None,
            "hihi": float(sp.hihi) if sp.hihi is not None else None,
            "lo": float(sp.lo) if sp.lo is not None else None,
            "lolo": float(sp.lolo) if sp.lolo is not None else None,
            "over_level": None,
            "freshness_sec": freshness_sec,
            "updated_at": raw["updated_at"] if raw else None,
        }
        # 越限判断（只有有实时值的才判断）
        if raw is not None and isinstance(val, (int, float)):
            try:
                fv = float(val)
                level = None
                if sp.hihi is not None and fv >= float(sp.hihi):
                    level = "hihi"
                elif sp.hi is not None and fv >= float(sp.hi):
                    level = "hi"
                elif sp.lolo is not None and fv <= float(sp.lolo):
                    level = "lolo"
                elif sp.lo is not None and fv <= float(sp.lo):
                    level = "lo"
                entry["over_level"] = level
                if level:
                    over_limit_count += 1
                    thr_map = {"hihi": sp.hihi, "hi": sp.hi, "lolo": sp.lolo, "lo": sp.lo}
                    over_limit_points.append({
                        "tag_name": entry["tag_name"],
                        "description": entry["description"],
                        "equipment_name": entry["equipment_name"],
                        "value": fv,
                        "unit": entry["unit"],
                        "level": level,
                        "threshold": float(thr_map[level]) if thr_map.get(level) is not None else None,
                    })
            except Exception:
                pass

        cat = sp.point_category or "other"
        grouped.setdefault(cat, []).append(entry)

    offline_count = max(0, point_total - online_count)
    grouped_sorted = dict(sorted(grouped.items(), key=lambda kv: -len(kv[1])))

    # 关键指标：按 point_mapping.py 的映射规则从已聚合点位中取（在线优先）
    metrics = resolve_metrics([e for rows in grouped.values() for e in rows])

    # === 3.5) 运行连续态 + 累计运行/停机小时 ===
    # 连续口径：只认 eq_run_event。无启停事件时不推算 since/连续秒数，前端显示“—”
    # 累计口径：eq_run_event 真实累加 + 台账 continuous_run_hours / continuous_stop_hours 手改兜底
    derived_states = _scada_run_states(db)
    run_state = {
        # 当前状态与列表页同源：SCADA 合位派生态优先，其次台账值
        "running": derived_states.get(item_id, obj.running_status) == "running",
        "since": None,            # ISO8601 起始时间（最近一次 start/stop 事件）
        "continuous_seconds": 0,  # 当前连续秒数（前端自格式化为 Xh Ymin）
        # 累计小时（事件聚合 + 台账兜底）
        "total_run_hours": 0.0,
        "total_stop_hours": 0.0,
    }
    # 聚合 eq_run_event：成对累加 → 跨 start/stop 段的时长
    run_evts = (
        db.query(EquipmentRunEvent)
        .filter(
            EquipmentRunEvent.deleted == 0,
            EquipmentRunEvent.equipment_id.in_(scope_ids),
        )
        .order_by(EquipmentRunEvent.event_time.asc())
        .all()
    )
    # 统一引擎：累计含未闭合段；连续段性质由最后一条事件决定
    summary = summarize_run_events(run_evts, now=datetime.now())
    if run_evts:
        run_state["total_run_hours"] = summary.total_run_hours
        run_state["total_stop_hours"] = summary.total_stop_hours
        if summary.current_since:
            run_state["since"] = summary.current_since.isoformat()
            run_state["continuous_seconds"] = int(summary.current_seconds)
        if summary.current_state:
            run_state["running"] = summary.current_state == "running"
    else:
        # 台账仅作初始化基线兜底；无事件不推算连续时长（since 保持 None）
        run_state["total_run_hours"] = round(obj.continuous_run_hours or 0.0, 2)
        run_state["total_stop_hours"] = round(obj.continuous_stop_hours or 0.0, 2)

    # === 4) 运维画像 ===
    open_repairs = (
        db.query(func.count(RepairOrder.id)).filter(
            RepairOrder.deleted == 0,
            RepairOrder.equipment_id.in_(scope_ids),
            RepairOrder.process_status.in_([
                "pending_dispatch", "dispatched", "processing", "pending_accept",
            ]),
        ).scalar() or 0
    )
    open_alarms = (
        db.query(func.count(Alarm.id)).filter(
            Alarm.deleted == 0,
            Alarm.equipment_id.in_(scope_ids),
            Alarm.alarm_status.in_([
                "pending", "processing", "pending_accept", "reopened",
            ]),
        ).scalar() or 0
    )
    next_maint = db.query(func.min(MaintenanceRecord.due_date)).filter(
        MaintenanceRecord.deleted == 0,
        MaintenanceRecord.equipment_id == item_id,
        MaintenanceRecord.record_status.in_(["pending", "pending_accept"]),
        MaintenanceRecord.due_date.isnot(None),
    ).scalar()
    last_maint = db.query(func.max(MaintenanceRecord.operate_time)).filter(
        MaintenanceRecord.deleted == 0,
        MaintenanceRecord.equipment_id == item_id,
        MaintenanceRecord.record_status.in_(["pending_accept", "done"]),
        MaintenanceRecord.operate_time.isnot(None),
    ).scalar()

    freshness_iso = (
        datetime.fromtimestamp(latest_ts_ms / 1000).isoformat()
        if latest_ts_ms else None
    )

    return ok({
        "scope": {
            "equipment_id": item_id,
            "equipment_name": obj.name,
            "children_count": len(scope_ids) - 1,
        },
        "points": {
            "total": point_total,
            "online": online_count,
            "offline": offline_count,
            "over_limit": over_limit_count,
            "by_category": point_by_category,
        },
        "over_limit_points": over_limit_points,
        "grouped_values": grouped_sorted,
        "metrics": metrics,
        "ops": {
            "open_repairs": open_repairs,
            "open_alarms": open_alarms,
            "next_maintenance_date": next_maint.isoformat() if next_maint else None,
            "last_maintenance_at": last_maint.isoformat() if last_maint else None,
        },
        "freshness": {
            "latest_update_at": freshness_iso,
        },
        "run_state": run_state,
    })


def _infer_unit(category: str) -> str | None:
    """点位表 unit 字段为空时，按 point_category 推断单位。"""
    mapping = {
        "temperature": "℃",
        "electrical": "",      # 电气看 tag_name
        "hydraulic": "",
        "switch": "",
    }
    return mapping.get(category, "")


@router.post("/equipment")
def create_equipment(body: EquipmentCreate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:create"))):
    ensure_unique(db, Equipment, "code", body.code, message="设备编号已存在")
    type_obj = get_or_404(db, EquipmentType, body.type_id)
    if type_obj.status != 1:
        raise HTTPException(status_code=400, detail="设备分类已禁用")
    obj = Equipment(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_eq_out(db, obj))


@router.put("/equipment/{item_id}")
def update_equipment(
    item_id: int, body: EquipmentUpdate, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:update"))):
    obj = get_or_404(db, Equipment, item_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        ensure_unique(
            db, Equipment, "code", data["code"], exclude_id=item_id, message="设备编号已存在"
        )
    if "type_id" in data:
        get_or_404(db, EquipmentType, data["type_id"])
    if "parent_id" in data and data["parent_id"]:
        pid = int(data["parent_id"])
        if pid == item_id:
            raise HTTPException(status_code=400, detail="上级设备不能是设备自身")
        get_or_404(db, Equipment, pid)
        # 防环：新父级不能是当前设备的子孙
        cursor = pid
        while cursor:
            parent = db.query(Equipment).filter(Equipment.id == cursor, Equipment.deleted == 0).first()
            if not parent:
                break
            cursor = parent.parent_id
            if cursor == item_id:
                raise HTTPException(status_code=400, detail="上级设备不能选择其下属设备")
    _apply(obj, data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ok(_eq_out(db, obj))


@router.delete("/equipment/{item_id}")
def delete_equipment(item_id: int, db: DbSession, _: CurrentUser,
    _perm: None = Depends(require_perm("eq:delete"))):
    obj = get_or_404(db, Equipment, item_id)
    # 级联软删全部子孙设备（删除机组时其下属子设备一并删除）
    frontier = [item_id]
    while frontier:
        batch = (
            db.query(Equipment)
            .filter(Equipment.parent_id.in_(frontier), Equipment.deleted == 0)
            .all()
        )
        for child in batch:
            soft_delete(db, child)
        frontier = [c.id for c in batch]
    soft_delete(db, obj)
    return ok(True)

