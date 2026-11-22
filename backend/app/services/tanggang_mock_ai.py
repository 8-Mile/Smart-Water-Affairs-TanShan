"""Development-only MOCK assistant for Tanggang business demos.

This is a deterministic intent router, NOT a real language model.
It can read only the user's own demo equipment and explicit SIM snapshots.
Writes are limited to existing approved staging tables after separate user
confirmation and existing RBAC checks. It never edits official business data.
"""
import json
import re
from datetime import datetime, timedelta, UTC
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.deps import collect_user_perms
from app.models.ai_audit import AiAuditLog
from app.models.equipment import Equipment
from app.models.tanggang_board import TanggangBoard
from app.models.tanggang_equipment_draft import TanggangDemoEquipment
from app.models.tanggang_mock_ai import (
    TanggangMockAiAction, TanggangMockAiMessage, TanggangMockAiSession,
)
from app.models.user import User
from app.api.tanggang_board import BoardBody, _rev
from app.api.tanggang_equipment_draft import DemoEquipmentBody, ParseBody, parse_demo
from app.services.tanggang_catalog import SYSTEMS

MODEL_NAME = "MOCK / 业务规则引擎"
ACTION_TTL_MINUTES = 30
ALLOWED_TOOLS = {"create_demo_equipment", "create_sim_board"}
DEFAULT_SOURCE = "SIM软件演示假设；未经过唐港现场核实"
BOARD_METRICS = {
    "supply": [
        ("metric", "supply-demand"),
        ("metric", "supply-shortage"),
        ("metric", "pool-forecast"),
        ("terminal-table", None),
        ("plan-comparison", None),
    ],
    "monitor": [
        ("metric", "monitor-risk"),
        ("metric", "monitor-rule-count"),
        ("monitor-rules", None),
    ],
}
SENSITIVE_REQUEST = re.compile(
    r"删.*设备|删除.*工单|操作.*阀|启停|开泵|停泵|派工|下发指令|PLC|实际控制",
    flags=re.I,
)


def _require_session(db: Session, session_id: str, user_id: int):
    s = db.get(TanggangMockAiSession, session_id)
    if not s or s.owner_id != user_id:
        raise HTTPException(status_code=404, detail="演示会话不存在或无权访问")
    return s


def _make_action(db, user: User, session_id: str, tool: str,
                 title: str, summary: str, payload: dict) -> dict:
    if tool not in ALLOWED_TOOLS:
        raise HTTPException(status_code=400, detail="演示工具不在白名单")
    a = TanggangMockAiAction(
        id=str(uuid4()), owner_id=user.id, session_id=session_id, tool=tool,
        title=title, summary=summary,
        payload_json=json.dumps(payload, ensure_ascii=False),
        status="pending",
    )
    db.add(a)
    return {
        "action_id": a.id, "tool": tool, "title": title, "summary": summary,
        "payload": payload, "risk": "medium", "status": "pending",
    }


def _sim_answer(context: dict | None) -> str:
    if not context:
        return (
            "当前浏览器尚未提供SIM推演快照。以下仅为预置MOCK样例，"
            "并非当前页面计算结果或唐港现场实测：\n"
            "多机集中用水假设：需求139 m³/h，可分配105 m³/h，"
            "当期缺口34 m³/h，模型期末储量350 m³。\n"
            "演示监护：高电流条件可触发模拟线索，但不等于实际设备报警。\n"
            "要查看与你本次操作一致的计算依据，请在“大机供水保障”"
            "启动统一SIM情景，再返回这里查询。\n"
            "入口：/port/water/supply"
        )
    shortage = context["shortage_m3h"]
    coverage = context["coverage_percent"]
    pool = context["pool_forecast_m3"]
    monitor = context["monitor_risk"]
    rules = context["triggered_rules"]
    return (
        f"SIM演示分析 · {context['scenario_id']} / 第{context['run_number']}轮\n"
        f"模拟总需水量：{context['demand_m3h']:g} m³/h；"
        f"模拟可分配：{context['delivered_m3h']:g} m³/h；"
        f"模拟缺口：{shortage:g} m³/h。\n"
        f"演示需求覆盖率：{coverage:g}%；"
        f"假设期末储量：{pool:g} m³。\n"
        f"监护规则状态：{monitor}；"
        f"本轮模拟命中规则：{'、'.join(rules) if rules else '无'}。\n"
        "这些数值仅来自你当前浏览器的SIM推演快照，不能推断唐港现场设备故障、"
        "供水能力或调度可行性。可进入大机供水保障和主动智能监护查看计算依据。"
    )


def _suggest_board(message: str) -> dict:
    monitor_only = bool(re.search(r"监护|异常|告警|压力|电流|故障", message)) and not bool(
        re.search(r"供水|缺口|水池|用水", message)
    )
    kind = "monitor" if monitor_only else "supply"
    title = "模拟监护分析" if monitor_only else "模拟供水保障分析"
    for phrase in ("创建", "生成", "帮我", "一个", "一张", "做", "看板", "图表", "的"):
        # Only affects the *suggested* title; never arbitrary UI code generation.
        message = message.replace(phrase, " ")
    candidate = re.sub(r"\s+", " ", message).strip("，。！!?、 ：:")
    if 2 <= len(candidate) <= 45:
        title = candidate
    target = "/port/operations/monitor" if monitor_only else "/port/water/supply"
    widgets = [
        {"id": f"w{i}", "kind": k, "metric": metric}
        for i, (k, metric) in enumerate(BOARD_METRICS[kind], 1)
    ]
    return BoardBody(title=title, target_path=target, widgets=widgets).model_dump(
        exclude_none=False,
    )


def _route_intent(db: Session, user: User, session_id: str, message: str,
                  context: dict | None) -> tuple[str, list[dict], list[dict]]:
    query = message.strip()
    if SENSITIVE_REQUEST.search(query):
        return (
            "MOCK模式不执行泵阀控制、真实派工或删除正式业务记录。"
            "如需演示告警核查，请进入主动智能监护页面的SIM流程。",
            [], [],
        )
    wants_board = bool(re.search(r"看板|图表|可视化布局", query))
    if wants_board and re.search(r"生成|新建|创建|做|设计|帮我", query):
        payload = _suggest_board(query)
        action = _make_action(
            db, user, session_id, "create_sim_board", "创建SIM看板草稿",
            f"保存到我的看板，目标：{payload['target_path']}（仅SIM白名单组件）",
            payload,
        )
        return (
            "已按唐港供水/监护业务模板拟定SIM看板。请检查组件与发布位置，"
            "确认后只会创建服务端草稿；不会自动公开发布。",
            [{"name": "mock_board_template", "ok": True, "pending": True}],
            [action],
        )

    create_equipment_intent = bool(re.search(r"新增|添加|录入|创建", query)) and bool(
        re.search(r"设备|喷雾泵|水泵", query)
    )
    if create_equipment_intent:
        parsed = parse_demo(ParseBody(text=query), user)["data"]
        missing = parsed["missing"]
        if missing:
            return (
                f"已识别为SIM设备录入，但还缺少：{'、'.join(missing)}。\n"
                "请补齐所属六系统、设备名称和设备编号后重发；也可以打开“演示设备录入”逐项核对。"
                "\n示例：在除尘系统新增设备，设备名称：演示喷雾泵，"
                "设备编号：SIM-FOG-001，参数：设计参数待核。\n"
                "入口：/port/analysis/equipment-drafts",
                [{"name": "mock_demo_equipment_parse", "ok": True, "pending": False}],
                [],
            )
        payload = DemoEquipmentBody(
            system_id=parsed["system_id"], name=parsed["name"],
            code=parsed["code"], parameters_note=parsed["parameters_note"] or None,
            request_text=parsed["request_text"], source_note=DEFAULT_SOURCE,
            confirmed=True,
        ).model_dump()
        action = _make_action(
            db, user, session_id, "create_demo_equipment", "登记SIM演示设备",
            f"{SYSTEMS[payload['system_id']]} / {payload['name']} / {payload['code']}"
            "（仅演示设备表，不写正式台账）",
            payload,
        )
        return (
            "已解析出设备录入草稿。确认后只会登记到独立SIM演示设备清单，"
            "不会生成唐港真实设备、SCADA测点或三维对象关系。",
            [{"name": "mock_demo_equipment_parse", "ok": True, "pending": True}],
            [action],
        )

    if re.search(r"演示设备|设备列表|设备清单|查询设备|查.*设备", query):
        rows = db.query(TanggangDemoEquipment).filter(
            TanggangDemoEquipment.created_by == user.id,
        ).order_by(TanggangDemoEquipment.id.desc()).limit(10).all()
        if not rows:
            reply = "当前账号尚未登记SIM演示设备。可以用“新增设备”指令创建并人工确认；这不是现场设备台账。"
        else:
            lines = [f"{r.code}｜{r.name}｜{SYSTEMS.get(r.system_id, '未知工艺')}" for r in rows]
            reply = f"你的SIM演示设备（最多显示10条）：\n" + "\n".join(lines)
            reply += "\n以上均为演示记录，未验证实际安装与接入。"
        return reply, [{"name": "query_demo_equipment", "ok": True, "items_count": len(rows)}], []

    if re.search(r"供水|缺口|用水|水池|池容|水量|监护|故障|告警|风险|压力|电流|能耗|分析", query):
        return _sim_answer(context), [{"name": "read_sim_scenario", "ok": True}], []

    return (
        "当前为唐港MOCK业务助手，仅支持以下演示：查询当前SIM供水与监护结果、"
        "查看演示设备清单、解析并确认新增SIM设备、生成并确认SIM看板草稿。\n"
        "例如：“当前模拟供水缺口是多少？”、“查询演示设备”、"
        "“在除尘系统新增设备，设备名称：演示泵，设备编号：SIM-001”"
        "或“帮我生成供水分析看板”。\n"
        "真实大模型、知识库和正式生产控制没有启用。",
        [], [],
    )


def chat(db: Session, user: User, message: str, session_id: str | None,
         context: dict | None) -> dict:
    if session_id:
        sess = _require_session(db, session_id, user.id)
    else:
        sess = TanggangMockAiSession(
            id=str(uuid4()), owner_id=user.id, preview=message[:120],
            message_count=0,
        )
        db.add(sess)
    reply, trace, actions = _route_intent(db, user, sess.id, message, context)
    now = datetime.now(UTC).replace(tzinfo=None)
    for role, content in [("user", message), ("assistant", reply)]:
        db.add(TanggangMockAiMessage(
            session_id=sess.id, owner_id=user.id, role=role, content=content,
        ))
    sess.message_count += 2
    sess.updated_at = now
    db.commit()
    return {
        "session_id": sess.id,
        "reply": reply, "model": MODEL_NAME, "mock": True, "data_mode": "SIM",
        "tool_trace": trace, "pending_actions": actions,
    }


def list_sessions(db: Session, user: User) -> list[dict]:
    rows = db.query(TanggangMockAiSession).filter(
        TanggangMockAiSession.owner_id == user.id,
    ).order_by(TanggangMockAiSession.updated_at.desc()).limit(100).all()
    return [
        {"id": r.id, "preview": r.preview, "message_count": r.message_count,
         "updated_at": r.updated_at.timestamp(), "created_at": r.created_at.timestamp()}
        for r in rows
    ]


def get_session(db: Session, user: User, session_id: str) -> dict:
    s = _require_session(db, session_id, user.id)
    messages = db.query(TanggangMockAiMessage).filter(
        TanggangMockAiMessage.owner_id == user.id,
        TanggangMockAiMessage.session_id == session_id,
    ).order_by(TanggangMockAiMessage.id.asc()).all()
    actions = db.query(TanggangMockAiAction).filter(
        TanggangMockAiAction.owner_id == user.id,
        TanggangMockAiAction.session_id == session_id,
    ).order_by(TanggangMockAiAction.created_at.asc()).all()
    # Actions belong to their session and remain visible after re-opening.
    return {
        "id": s.id, "user_id": str(user.id), "mock": True,
        "messages": [
            {"role": m.role, "content": m.content, "ts": m.created_at.timestamp()}
            for m in messages
        ],
        "pending_actions": [
            {
                "action_id": a.id, "tool": a.tool, "title": a.title,
                "summary": a.summary, "payload": json.loads(a.payload_json),
                "status": a.status, "risk": "medium",
                "result_path": (
                    "/port/analysis/boards" if a.tool == "create_sim_board"
                    else "/port/analysis/equipment-drafts"
                ) if a.status == "confirmed" else None,
            } for a in actions
        ],
    }


def _action(db: Session, user: User, action_id: str):
    a = db.get(TanggangMockAiAction, action_id)
    if not a or a.owner_id != user.id:
        raise HTTPException(status_code=404, detail="演示动作不存在或无权访问")
    if a.status != "pending":
        raise HTTPException(status_code=409, detail="该演示动作已经处理，不可重复执行")
    if a.created_at and datetime.now(UTC).replace(tzinfo=None) - a.created_at > timedelta(minutes=ACTION_TTL_MINUTES):
        raise HTTPException(status_code=410, detail="演示动作已过期，请重新发起指令")
    return a


def _audit(db: Session, user: User, action: TanggangMockAiAction, status: str,
           result: dict | None = None) -> None:
    db.add(AiAuditLog(
        user_id=user.id, username=user.username, session_id=action.session_id,
        action_id=action.id, tool_name=action.tool, title=action.title,
        status=status, payload_json=action.payload_json,
        result_json=json.dumps(result, ensure_ascii=False) if result else None,
    ))


def resolve(db: Session, user: User, action_id: str, *, confirm: bool) -> dict:
    a = _action(db, user, action_id)
    # Status transition CAS under one db transaction; a second request fails.
    result_status = "confirmed" if confirm else "cancelled"
    changed = db.execute(
        update(TanggangMockAiAction).where(
            TanggangMockAiAction.id == a.id,
            TanggangMockAiAction.owner_id == user.id,
            TanggangMockAiAction.status == "pending",
        ).values(status=result_status, resolved_at=datetime.now(UTC).replace(tzinfo=None)),
    ).rowcount
    if changed != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="演示动作已被其他请求处理")
    result: dict | None = None
    if confirm:
        payload = json.loads(a.payload_json)
        if a.tool == "create_demo_equipment":
            if "eq:create" not in collect_user_perms(db, user):
                db.rollback()
                raise HTTPException(status_code=403, detail="缺少演示设备创建权限")
            try:
                body = DemoEquipmentBody.model_validate(payload)
            except ValidationError:
                db.rollback()
                raise HTTPException(status_code=422, detail="演示设备草稿已失效") from None
            if db.query(Equipment.id).filter(
                Equipment.code == body.code, Equipment.deleted == 0,
            ).first() or db.query(TanggangDemoEquipment.id).filter(
                TanggangDemoEquipment.code == body.code,
            ).first():
                db.rollback()
                raise HTTPException(status_code=409, detail="设备编号已存在")
            obj = TanggangDemoEquipment(
                system_id=body.system_id, name=body.name, code=body.code,
                parameters_note=body.parameters_note, request_text=body.request_text,
                source_note=body.source_note, created_by=user.id,
            )
            db.add(obj)
            db.flush()
            result = {
                "id": obj.id, "code": obj.code, "name": obj.name,
                "path": "/port/analysis/equipment-drafts",
                "data_mode": "SIM", "in_official_equipment": False,
            }
        elif a.tool == "create_sim_board":
            try:
                body = BoardBody.model_validate(payload)
            except ValidationError:
                db.rollback()
                raise HTTPException(status_code=422, detail="看板组件草稿已失效") from None
            b = TanggangBoard(
                title=body.title, target_path=body.target_path,
                owner_id=user.id, updated_by=user.id,
                widgets_json=json.dumps([w.model_dump() for w in body.widgets]),
                status="draft", allowed_roles_json="[]", version=1,
            )
            db.add(b)
            db.flush()
            _rev(db, b, "create", user.id)
            result = {
                "id": b.id, "title": b.title, "path": "/port/analysis/boards",
                "status": "draft", "data_mode": "SIM",
            }
        else:
            db.rollback()
            raise HTTPException(status_code=400, detail="未知演示工具，拒绝执行")
    _audit(db, user, a, result_status, result)
    db.commit()
    return {
        "ok": True, "mock": True, "tool": a.tool, "title": a.title,
        "result": result or {"message": "已取消，未保存"},
        "action": {
            "tool": a.tool, "title": a.title,
            "payload": json.loads(a.payload_json), "session_id": a.session_id,
        },
    }
