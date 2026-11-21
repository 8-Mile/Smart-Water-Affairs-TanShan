"""巡检计划派发与任务完成。"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.equipment import Equipment
from app.models.inspection import (
    InspectionActionLog,
    InspectionPlan,
    InspectionRecord,
    InspectionTask,
)
from app.models.org import Team
from app.models.scada import ScadaPoint, ScadaPointLatest
from app.models.user import User
from app.services import notify


def parse_items(raw: str | None) -> list[dict]:
    """解析 items_json → 统一返回 [{equipment_id, equipment_name, check_item}, ...]

    兼容两种历史结构：
    - 新结构（dict 数组）：直接返回
    - 旧结构（字符串数组 / 逗号分隔字符串）：包装为 {check_item: <str>}，equipment_* 为 None
    """
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            out: list[dict] = []
            for x in data:
                if isinstance(x, dict):
                    check_item = str(x.get("check_item") or x.get("name") or "").strip()
                    if not check_item:
                        continue
                    out.append(
                        {
                            "equipment_id": x.get("equipment_id"),
                            "equipment_name": x.get("equipment_name"),
                            "check_item": check_item,
                        }
                    )
                else:
                    s = str(x).strip()
                    if s:
                        out.append(
                            {"equipment_id": None, "equipment_name": None, "check_item": s}
                        )
            return out
    except json.JSONDecodeError:
        pass
    return [
        {"equipment_id": None, "equipment_name": None, "check_item": s}
        for s in (x.strip() for x in raw.split(","))
        if s
    ]


def dump_items(items: list[Any]) -> str:
    """序列化 items（兼容 dict 列表 / Pydantic 模型列表 / 字符串列表）。"""
    out: list[dict] = []
    for it in items or []:
        if hasattr(it, "model_dump"):
            d = it.model_dump()
        elif isinstance(it, dict):
            d = dict(it)
        else:
            d = {"check_item": str(it)}
        check_item = str(d.get("check_item") or d.get("name") or "").strip()
        if not check_item:
            continue
        out.append(
            {
                "equipment_id": d.get("equipment_id"),
                "equipment_name": d.get("equipment_name"),
                "check_item": check_item,
            }
        )
    return json.dumps(out, ensure_ascii=False)


def should_dispatch_today(plan: InspectionPlan, today: date) -> bool:
    if plan.enabled != 1 or plan.status != 1:
        return False
    if today < plan.start_date or today > plan.end_date:
        return False
    if plan.last_dispatch_date == today:
        return False
    if plan.frequency == "day":
        return True
    if plan.frequency == "week":
        # 每周一或计划开始日同星期
        return today.weekday() == plan.start_date.weekday()
    if plan.frequency == "month":
        return today.day == plan.start_date.day or (
            plan.start_date.day > 28 and today.day == min(plan.start_date.day, 28)
        )
    return False


def create_task_from_plan(
    db: Session,
    plan: InspectionPlan,
    task_date: Optional[date] = None,
    source: str = "plan",
    assignee: Optional[User] = None,
    operator: Optional[User] = None,
) -> InspectionTask:
    task_date = task_date or date.today()
    exists = (
        db.query(InspectionTask)
        .filter(
            InspectionTask.deleted == 0,
            InspectionTask.plan_id == plan.id,
            InspectionTask.task_date == task_date,
        )
        .first()
    )
    if exists:
        # 管理员手动派发：当日已由定时任务生成（无指派人）任务时，
        # 应把任务指派给选定操作员并发送通知，而不是直接返回旧任务。
        if source == "manual":
            # 已进行/已完成的任务不可重复派发，避免误报“派发成功”
            if exists.task_status != "pending":
                raise ValueError("当日巡检任务已在处理或已完成，无法重复派发")
            # 已指派同一人时幂等返回；无指派或指派人不同则更新并通知
            if assignee and exists.assignee_id != assignee.id:
                exists.assignee_id = assignee.id
                exists.assignee_name = assignee.display_name
                exists.source = "manual"
                db.add(exists)
                db.flush()
                notify.notify_users(
                    db,
                    [assignee.id],
                    f"您有新的巡检任务：{exists.plan_name}",
                    content=f"任务日期：{task_date}，班组：{exists.team_name or ''}",
                    ntype="inspection",
                    biz_type="inspection",
                    biz_id=str(exists.id),
                    path="/inspection/tasks?focus=" + str(exists.id),
                )
        return exists

    team = (
        db.query(Team)
        .filter(Team.id == plan.team_id, Team.deleted == 0)
        .first()
    )
    task = InspectionTask(
        plan_id=plan.id,
        plan_name=plan.name,
        team_id=plan.team_id,
        team_name=plan.team_name or (team.name if team else None),
        task_date=task_date,
        task_status="pending",
        items_json=plan.items_json,
        assignee_id=assignee.id if assignee else None,
        assignee_name=assignee.display_name if assignee else None,
        source=source,
        status=1,
        deleted=0,
    )
    db.add(task)
    db.flush()
    plan.last_dispatch_date = task_date
    db.add(plan)
    db.add(
        InspectionActionLog(
            task_id=task.id,
            plan_id=plan.id,
            action="dispatch",
            operator_id=operator.id if operator else None,
            operator_name=operator.display_name if operator else "系统",
            detail=(
                f"{plan.name} · {task_date}"
                + (f" · 指派 {task.assignee_name}" if task.assignee_name else " · 班组待认领")
            ),
        )
    )
    if assignee:
        notify.notify_users(
            db,
            [assignee.id],
            f"您有新的巡检任务：{task.plan_name}",
            content=f"任务日期：{task_date}，班组：{task.team_name or ''}",
            ntype="inspection",
            biz_type="inspection",
            biz_id=str(task.id),
            path="/inspection/tasks?focus=" + str(task.id),
        )
    else:
        # 定时/班组任务：通知班组全体成员
        notify.notify_team(
            db,
            task.team_id,
            f"新巡检任务（{task.team_name or ''}）：{task.plan_name}",
            content=f"任务日期：{task_date}",
            ntype="inspection",
            biz_type="inspection",
            biz_id=str(task.id),
            path="/inspection/tasks?focus=" + str(task.id),
        )
    return task


def dispatch_due_plans(db: Session, today: Optional[date] = None) -> int:
    today = today or date.today()
    plans = (
        db.query(InspectionPlan)
        .filter(InspectionPlan.deleted == 0, InspectionPlan.enabled == 1)
        .all()
    )
    n = 0
    for plan in plans:
        if should_dispatch_today(plan, today):
            create_task_from_plan(db, plan, today, source="plan")
            n += 1
    # 标记超时：先查出本批将被标记的任务，逐条发送超时提醒（班组 + 管理员）；
    # 任务置为 overdue 后下轮调度不再命中，天然幂等不重复提醒
    overdue_tasks = (
        db.query(InspectionTask)
        .filter(
            InspectionTask.deleted == 0,
            InspectionTask.task_status == "pending",
            InspectionTask.task_date < today,
        )
        .all()
    )
    for t in overdue_tasks:
        t.task_status = "overdue"
        db.add(t)
        title = f"巡检任务超时：{t.plan_name}"
        content = (
            f"任务日期：{t.task_date}，班组：{t.team_name or ''}，"
            f"已超期未完成，请及时处理"
        )
        notify.notify_team(
            db,
            t.team_id,
            title,
            content=content,
            ntype="inspection",
            biz_type="inspection",
            biz_id=str(t.id),
            path="/inspection/tasks?focus=" + str(t.id),
        )
        notify.notify_managers(
            db,
            title,
            content=content,
            ntype="inspection",
            biz_type="inspection",
            biz_id=str(t.id),
            path="/inspection/tasks?focus=" + str(t.id),
        )
    db.commit()
    return n


def claim_task(db: Session, task: InspectionTask, user: User) -> InspectionTask:
    """班组成员认领任务（抢单制）。

    并发安全：以 assignee_id IS NULL 为条件做原子更新，影响行数为 0 即已被他人认领。
    权限：仅任务所属班组成员可认领；超管/领导可兜底认领。
    """
    if task.task_status == "done":
        raise ValueError("任务已完成，无法认领")
    # 幂等：本人重复认领直接返回
    if task.assignee_id == user.id:
        return task
    if task.assignee_id is not None:
        raise ValueError(f"任务已被 {task.assignee_name or '其他人员'} 认领")
    if user.role_code == "operator" and (not user.team_id or task.team_id != user.team_id):
        raise PermissionError("仅任务所属班组成员可认领")

    updated = (
        db.query(InspectionTask)
        .filter(
            InspectionTask.id == task.id,
            InspectionTask.assignee_id.is_(None),
            InspectionTask.deleted == 0,
        )
        .update(
            {
                InspectionTask.assignee_id: user.id,
                InspectionTask.assignee_name: user.display_name,
            },
            synchronize_session=False,
        )
    )
    if not updated:
        # 并发竞争落败：重新读取最新认领人信息
        db.expire(task)
        db.refresh(task)
        raise ValueError(f"手慢一步，任务已被 {task.assignee_name or '其他人员'} 认领")
    # 同步内存对象，供 API 层 refresh 前序列化使用
    task.assignee_id = user.id
    task.assignee_name = user.display_name
    db.add(task)
    db.add(
        InspectionActionLog(
            task_id=task.id,
            plan_id=task.plan_id,
            action="claim",
            operator_id=user.id,
            operator_name=user.display_name,
            detail=f"{task.plan_name} · {task.task_date} · 认领执行",
        )
    )
    return task


def _resolve_points(db: Session, point_tokens_str: str | None) -> list[ScadaPoint]:
    """Equipment.scada_point_ids 逗号串 → ScadaPoint 列表。

    解析规则与 `scada/equipment/{id}/values` 保持一致，兼容三种写法：
    - 纯数字 token：先当 scada_points.id，再当 tag_name，再按 node_id 后缀匹配
    - 非数字 token：当 tag_name 精确匹配
    无效 token 直接跳过，不阻断巡检流程。
    """
    if not point_tokens_str:
        return []
    tokens = [
        t.strip()
        for t in point_tokens_str.replace(";", ",").split(",")
        if t.strip()
    ]
    out: list[ScadaPoint] = []
    for token in tokens:
        point: ScadaPoint | None = None
        if token.isdigit():
            point = (
                db.query(ScadaPoint)
                .filter(ScadaPoint.id == int(token), ScadaPoint.deleted == 0)
                .first()
            )
            if not point:
                point = (
                    db.query(ScadaPoint)
                    .filter(ScadaPoint.deleted == 0, ScadaPoint.tag_name == token)
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
            out.append(point)
    return out


def _format_point_value(latest: ScadaPointLatest | None, point: ScadaPoint) -> dict:
    """「已解析的 ScadaPoint + 其最新值」→ 前端可直接渲染的 dict。

    测点身份取自 ScadaPoint（id/tag_name/unit），值取自 ScadaPointLatest；
    无最新值（设备离线/未上报）时 value=None 且 offline=True。
    """
    value_type = (latest.value_type if latest else point.value_type) or "number"
    if latest is None:
        val = None
        ts = None
        offline = True
    else:
        if value_type == "number":
            val = float(latest.value_num) if latest.value_num is not None else None
        elif value_type == "bool":
            val = latest.value_bool
        else:
            val = latest.value_str
        ts = None
        if latest.ts_ms:
            try:
                ts = datetime.fromtimestamp(latest.ts_ms / 1000).isoformat(
                    timespec="seconds"
                )
            except (ValueError, OSError):
                ts = None
        offline = latest.status_code != 0
    return {
        "point_id": point.id,
        "point_name": point.tag_name,
        "value": val,
        "unit": point.unit,
        "ts": ts,
        "offline": offline,
    }


def _points_with_latest(db: Session, points: list[ScadaPoint]) -> list[dict]:
    """批量取一组 ScadaPoint 的最新值并格式化（一次查询 latest 表）。"""
    if not points:
        return []
    ids = [p.id for p in points]
    latest_map = {
        r.point_id: r
        for r in db.query(ScadaPointLatest)
        .filter(ScadaPointLatest.point_id.in_(ids))
        .all()
    }
    return [_format_point_value(latest_map.get(p.id), p) for p in points]


def build_scada_snapshot(db: Session, task: InspectionTask) -> dict:
    """为一个巡检任务构建 SCADA 实时值快照。

    返回结构：
        {
          "task_id": int,
          "snapshot_ts": "2026-10-20T14:30:05",
          "items": [
            {
              "equipment_id": 3,
              "equipment_name": "1#提升泵",
              "check_item": "泵温",
              "scada_points": [{point_id, point_name, value, unit, ts, offline}]
            },
            {
              "equipment_id": None,
              "equipment_name": None,
              "check_item": "现场清洁",
              "scada_points": []
            }
          ]
        }

    设计：
    - 一个检查项可能关联设备的多个测点（温度/振动/电流），全部返回供执行人自行参考，
      不做"检查项→测点"的硬映射（那需要在 plan 级别额外配置 scada_point_id）。
    - 设备未绑 equipment_id / 未填 scada_point_ids / 测点离线 → 均返回空列表或 value=null，
      不阻断巡检流程，前端据此展示"人工目测"或"离线"标记。
    """
    parsed_items = parse_items(task.items_json)
    # 收集所有涉及的 equipment_id
    equipment_ids = {
        int(it["equipment_id"])
        for it in parsed_items
        if it.get("equipment_id") is not None
    }
    # 批量查 Equipment
    equipment_map: dict[int, Equipment] = {}
    if equipment_ids:
        for eq in (
            db.query(Equipment)
            .filter(Equipment.id.in_(list(equipment_ids)), Equipment.deleted == 0)
            .all()
        ):
            equipment_map[eq.id] = eq

    # 每台设备解析其测点（token → ScadaPoint），并汇总去重后一次性取最新值
    eq_points: dict[int, list[ScadaPoint]] = {
        eid: _resolve_points(db, eq.scada_point_ids)
        for eid, eq in equipment_map.items()
    }
    all_points: dict[int, ScadaPoint] = {
        p.id: p for pts in eq_points.values() for p in pts
    }
    latest_map: dict[int, ScadaPointLatest] = {}
    if all_points:
        for row in (
            db.query(ScadaPointLatest)
            .filter(ScadaPointLatest.point_id.in_(list(all_points.keys())))
            .all()
        ):
            latest_map[row.point_id] = row

    # 组装
    out_items: list[dict] = []
    for it in parsed_items:
        eid = it.get("equipment_id")
        eid_int = int(eid) if eid is not None else None
        points = eq_points.get(eid_int, []) if eid_int is not None else []
        scada_points = [
            _format_point_value(latest_map.get(p.id), p) for p in points
        ]
        out_items.append(
            {
                "equipment_id": eid_int,
                "equipment_name": it.get("equipment_name"),
                "check_item": it.get("check_item", ""),
                "scada_points": scada_points,
            }
        )

    return {
        "task_id": task.id,
        "snapshot_ts": datetime.now().isoformat(timespec="seconds"),
        "items": out_items,
    }


def _snapshot_for_equipment(
    db: Session, equipment_id: int | None
) -> list[dict]:
    """complete_task 时用：取单台设备当前所有测点实时值，写入 results_json 留痕。"""
    if equipment_id is None:
        return []
    eq = (
        db.query(Equipment)
        .filter(Equipment.id == equipment_id, Equipment.deleted == 0)
        .first()
    )
    if not eq:
        return []
    points = _resolve_points(db, eq.scada_point_ids)
    return _points_with_latest(db, points)


def complete_task(
    db: Session,
    task: InspectionTask,
    *,
    results: list[dict[str, Any]],
    executor: User,
    remark: Optional[str] = None,
) -> InspectionRecord:
    if task.task_status == "done":
        raise ValueError("任务已完成")
    # 班组任务必须先认领再提交，杜绝多人并发裸提
    if not task.assignee_id:
        raise PermissionError("任务尚未认领，请先认领后再执行")
    if task.assignee_id != executor.id and executor.role_code != "super_admin":
        raise PermissionError("仅认领人可执行该巡检任务")
    # 统一序列化 results：规范字段名为 check_item（兼容历史 name 字段）
    # 同时为每条结果附加 complete_task 时刻的 SCADA 实时值快照——留痕用，
    # 事后复盘可看到"执行人判定异常时系统实时数据是多少"
    norm_results: list[dict] = []
    for r in results:
        d = r.model_dump() if hasattr(r, "model_dump") else dict(r)
        check_item = str(d.get("check_item") or d.get("name") or "").strip()
        if not check_item:
            continue
        equipment_id_raw = d.get("equipment_id")
        equipment_id_int = (
            int(equipment_id_raw) if equipment_id_raw is not None else None
        )
        norm_results.append(
            {
                "equipment_id": equipment_id_int,
                "equipment_name": d.get("equipment_name"),
                "check_item": check_item,
                "result": d.get("result") or "normal",
                "remark": d.get("remark") or "",
                "photo": d.get("photo") or "",
                # 完成时刻的 SCADA 快照：执行人看到的自动辅助参考值
                "scada_snapshot": _snapshot_for_equipment(db, equipment_id_int),
            }
        )
    has_abnormal = any(
        (r.get("result") or "").lower() in ("abnormal", "异常") for r in norm_results
    )
    task.task_status = "done"
    task.executor_id = executor.id
    task.executor_name = executor.display_name
    task.execute_time = datetime.now()
    db.add(task)

    # 摘要直接写中文结果标签，避免列表/详情展示 normal/abnormal 原始码
    result_labels = {"normal": "正常", "abnormal": "异常"}
    summary_parts = []
    for r in norm_results:
        prefix = f"{r['equipment_name']}·" if r.get("equipment_name") else ""
        label = result_labels.get((r["result"] or "").lower(), r["result"])
        summary_parts.append(f"{prefix}{r['check_item']}:{label}")
    record = InspectionRecord(
        task_id=task.id,
        plan_id=task.plan_id,
        plan_name=task.plan_name,
        team_id=task.team_id,
        team_name=task.team_name,
        record_date=task.task_date,
        items_summary="; ".join(summary_parts),
        has_abnormal=1 if has_abnormal else 0,
        executor_id=executor.id,
        executor_name=executor.display_name,
        remark=remark,
        # 归档本次提交的巡检结果明细（task.results_json 为任务模板字段，恒为空）
        results_json=json.dumps(norm_results, ensure_ascii=False),
        status=1,
        deleted=0,
    )
    db.add(record)
    db.flush()
    abnormal_count = sum(
        1 for r in norm_results if (r.get("result") or "").lower() in ("abnormal", "异常")
    )
    db.add(
        InspectionActionLog(
            task_id=task.id,
            plan_id=task.plan_id,
            action="complete",
            operator_id=executor.id,
            operator_name=executor.display_name,
            detail=f"{task.plan_name} · {task.task_date} · 检查 {len(norm_results)} 项，异常 {abnormal_count} 项",
        )
    )
    notify.notify_managers(
        db,
        ("巡检发现异常：" if has_abnormal else "巡检任务已完成：") + task.plan_name,
        content=f"执行人：{executor.display_name}；日期：{task.task_date}"
        + ("；存在异常项，请及时处理" if has_abnormal else ""),
        ntype="inspection",
        biz_type="inspection",
        biz_id=str(task.id),
        path="/inspection/tasks?focus=" + str(task.id),
        exclude_user_ids=[executor.id] if executor.role_code in ("super_admin", "admin") else (),
    )
    return record
