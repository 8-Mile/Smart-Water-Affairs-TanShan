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
    TanggangMockAiReport, TanggangMockAiDecision,
)
from app.models.user import User
from app.api.tanggang_board import BoardBody, _rev, _snapshot
from app.api.tanggang_equipment_draft import DemoEquipmentBody, ParseBody, parse_demo
from app.services.tanggang_catalog import SYSTEMS

MODEL_NAME = "MOCK / 业务规则引擎"
ACTION_TTL_MINUTES = 30
ALLOWED_TOOLS = {"create_demo_equipment", "create_sim_board", "edit_sim_board", "create_sim_report"}
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


# A2UI widget edits are declarative. No arbitrary CSS/JS/templates or unknown fields.
WIDGET_ALIASES: tuple[tuple[str, str, str | None], ...] = (
    ("监护规则", "monitor-rules", None),
    ("规则证据", "monitor-rules", None),
    ("方案比选", "plan-comparison", None),
    ("方案对比", "plan-comparison", None),
    ("受影响用水点", "terminal-table", None),
    ("用水点表", "terminal-table", None),
    ("供水缺口", "metric", "supply-shortage"),
    ("缺口指标", "metric", "supply-shortage"),
    ("需水量", "metric", "supply-demand"),
    ("供水需求", "metric", "supply-demand"),
    ("供水能力", "metric", "supply-capacity"),
    ("可分配能力", "metric", "supply-capacity"),
    ("池容", "metric", "pool-forecast"),
    ("期末储量", "metric", "pool-forecast"),
    ("监护状态", "metric", "monitor-risk"),
    ("风险状态", "metric", "monitor-risk"),
    ("规则命中", "metric", "monitor-rule-count"),
    ("覆盖率", "metric", "supply-coverage"),
)
BOARD_NUMBER = re.compile(
    r"(?:(\d{1,9})号看板|看板\s*(?:ID[:：#]?\s*)?(\d{1,9}))",
    flags=re.I,
)


def _plan_board_edit(db: Session, user: User, session_id: str, query: str):
    is_delete = bool(re.search(r"移除|删除|去掉|去除", query))
    is_add = bool(re.search(r"新增|增加|添加|加上|加入", query))
    if is_delete == is_add:
        return "请明确是向看板添加组件，还是从看板移除组件。", [], []
    widget_key = next(
        ((kind, metric) for alias, kind, metric in WIDGET_ALIASES if alias in query),
        None,
    )
    if widget_key is None:
        return (
            "仅能操作已有白名单组件，例如：供水缺口、期末储量、需求覆盖率、"
            "监护规则证据、受影响用水点或方案比选；不支持任意JS和未授权指标。",
            [], [],
        )
    own = db.query(TanggangBoard).filter(
        TanggangBoard.owner_id == user.id,
    ).order_by(TanggangBoard.id.asc()).limit(40).all()
    match = BOARD_NUMBER.search(query)
    if match:
        board_id = int(match.group(1) or match.group(2))
        board = db.get(TanggangBoard, board_id)
        if board is None or (board.owner_id != user.id and
                            "sys:menu:manage" not in collect_user_perms(db, user)):
            return "未找到你有权编辑的指定看板。请在“我的看板”核对编号。", [], []
    elif len(own) == 1:
        board = own[0]
    else:
        candidates = "；".join(f"#{b.id} {b.title}" for b in own[:12])
        return (
            "请明确要修改的看板编号，避免误操作。"
            + (f"你的看板：{candidates}" if candidates else "你还没有看板，请先生成一张。")
            + "\n示例：给1号看板添加供水缺口指标。",
            [], [],
        )
    if board.status != "draft":
        return "该看板已发布，必须先由有权限的管理员撤回，再进行组件编辑。", [], []
    existing = json.loads(board.widgets_json)
    if not isinstance(existing, list):
        return "当前看板布局无效，请在“我的看板”修复。", [], []
    kind, metric = widget_key
    idx = next((i for i, w in enumerate(existing)
                if w.get("kind") == kind and w.get("metric") == metric), None)
    if is_add:
        if idx is not None:
            return "该受控组件已在看板中，无须重复添加。", [], []
        if len(existing) >= 8:
            return "单张看板最多8个组件，请先移除一个组件。", [], []
        used_ids = {w.get("id") for w in existing}
        n = 1
        while "w" + str(n) in used_ids:
            n += 1
        changed = [*existing, {"id": "w" + str(n), "kind": kind, "metric": metric}]
    else:
        if idx is None:
            return "该看板尚未包含指定组件，未执行移除。", [], []
        if len(existing) <= 1:
            return "看板至少保留一个组件，不能移除最后一个。", [], []
        changed = [w for i, w in enumerate(existing) if i != idx]
    validated = BoardBody.model_validate({
        "title": board.title,
        "target_path": board.target_path,
        "widgets": changed, "version": board.version,
    })
    operation = "remove" if is_delete else "add"
    payload = {
        "board_id": board.id, "expected_version": board.version,
        "operation": operation, "component_kind": kind,
        "component_metric": metric, "title": board.title,
        "target_path": board.target_path,
        "widgets": [w.model_dump() for w in validated.widgets],
    }
    title = "移除SIM看板组件" if is_delete else "添加SIM看板组件"
    action = _make_action(
        db, user, session_id, "edit_sim_board", title,
        f"看板 #{board.id} {board.title} / v{board.version} → v{board.version+1}；"
        f"{'移除' if is_delete else '增加'} {kind} {metric or ''}，"
        f"组件数 {len(existing)} → {len(changed)}",
        payload,
    )
    return (
        f"已经生成看板 #{board.id} 的受控布局修改预览。确认后仅更新你的草稿看板，"
        "并记录版本历史；不会自动发布。",
        [{"name": "mock_edit_sim_board", "ok": True, "pending": True}],
        [action],
    )


def _plan_sim_report(db: Session, user: User, session_id: str, context: dict | None):
    if context is None:
        return (
            "运行复盘必须绑定当前浏览器的一轮SIM推演。请先前往“大机供水保障”"
            "启动情景，再通过“生成本轮运行复盘”创建报告。"
            "\n入口：/port/water/supply", [], [],
        )
    # All context here is client-supplied simulated data; it is NOT a
    # verified history, sensor observation or production incident.
    affected = context.get("affected_terminals", [])
    checkpoints = context.get("checkpoints", [])
    note = context.get("review_note", "")
    report = {
        "report_version": "tg-sim-replay-v1",
        "data_mode": "SIM", "field_verified": False,
        "data_origin": "BROWSER_SIM_SNAPSHOT",
        "production_case_created": False, "repair_order_created": False,
        "scenario_id": context["scenario_id"],
        "run_number": context["run_number"],
        "scenario_started_at": context.get("scenario_started_at", ""),
        "demand_m3h": context["demand_m3h"],
        "delivered_m3h": context["delivered_m3h"],
        "shortage_m3h": context["shortage_m3h"],
        "coverage_percent": context["coverage_percent"],
        "pool_forecast_m3": context["pool_forecast_m3"],
        "monitor_risk": context["monitor_risk"],
        "triggered_rules": context["triggered_rules"],
        "insufficient_rules": context.get("insufficient_rules", []),
        "affected_terminals": affected, "checkpoints": checkpoints,
        "review_status": context.get("review_status", "not_started"),
        "review_outcome": context.get("review_outcome"),
        "review_note": note,
        "conclusion": (
            "模拟分配存在缺口，需要核实终端负荷和设备能力"
            if context["shortage_m3h"] > 0 else
            "本轮假设未产生供水缺口，仍需核实储量和监护规则"
        ),
        "next_action": (
            "仅建议人工核对演示点表、实际需水量、泵组铭牌、池容曲线、"
            "管网连接与真实工单状态；不得据此直接下发泵阀控制。"
        ),
    }
    # An explicitly related SIM decision can be included as traceable context
    # only when it belongs to this user and this same SIM run.
    related = db.query(TanggangMockAiDecision).filter(
        TanggangMockAiDecision.owner_id == user.id,
        TanggangMockAiDecision.scenario_id == context["scenario_id"],
    ).order_by(TanggangMockAiDecision.id.desc()).limit(40).all()
    for choice in related:
        reviewed = json.loads(choice.review_json) if choice.review_json else None
        if (choice.baseline_run == context["run_number"] or
            (reviewed and reviewed["run_number"] == context["run_number"])):
            report["sim_decision"] = {
                "id": choice.id, "selected_plan_id": choice.selected_plan_id,
                "rationale": choice.rationale, "status": choice.status,
                "review": reviewed, "real_dispatch_executed": False,
            }
            break

    summary = (
        f"第{context['run_number']}轮 {context['scenario_id']}："
        f"模拟需水{context['demand_m3h']:g}、分配{context['delivered_m3h']:g}、"
        f"缺口{context['shortage_m3h']:g} m³/h；"
        f"受影响的演示用水点{len(affected)}个；"
        f"监护命中规则{len(context['triggered_rules'])}条；"
        f"核查状态{report['review_status']}。"
    )
    action = _make_action(
        db, user, session_id, "create_sim_report", "保存SIM运行复盘",
        summary + " 仅保存演示快照，不生成告警/正式工单",
        report,
    )
    return (
        "已经按同一轮SIM供水、监护与核查数据形成复盘草稿。"
        "请检查场景编号、影响范围和未核实事项后确认保存。"
        "此报告只反映浏览器演示快照，不代表现场运行日志。",
        [{"name": "mock_sim_replay", "ok": True, "pending": True}],
        [action],
    )


NAV_TARGETS = (
    ("处置研判", "/port/operations/decision", "打开SIM处置研判"),
    ("模拟处置", "/port/operations/decision", "打开SIM处置研判"),
    ("运行复盘", "/port/analysis/reports", "打开运行复盘"),
    ("复盘记录", "/port/analysis/reports", "打开运行复盘"),
    ("我的看板", "/port/analysis/boards", "打开我的看板"),
    ("看板管理", "/port/analysis/boards", "打开我的看板"),
    ("演示设备", "/port/analysis/equipment-drafts", "打开演示设备清单"),
    ("设备录入", "/port/analysis/equipment-drafts", "打开演示设备清单"),
    ("主动监护", "/port/operations/monitor", "打开主动智能监护"),
    ("智能监护", "/port/operations/monitor", "打开主动智能监护"),
    ("大机供水", "/port/water/supply", "打开大机供水保障"),
    ("供水保障", "/port/water/supply", "打开大机供水保障"),
)
NAV_PREFIX = re.compile(r"^(?:请|帮我|给我|直接|现在|我要|我想)?\s*(?:打开|前往|进入|跳转|查看|带我去)")


def _navigation(message: str) -> list[dict]:
    if re.search(r"处置方案|处置建议|处置研判|方案研判|多Agent|多智能体", message, re.I) and (
        not re.search(r"实际控制|下发指令|PLC|派工|启停", message, re.I)
    ):
        return [{"path": "/port/operations/decision", "label": "进入SIM处置研判"}]
    if not NAV_PREFIX.search(message.strip()):
        return []
    for phrase, path, label in NAV_TARGETS:
        if phrase in message:
            return [{"path": path, "label": label}]
    return []


def _route_intent(db: Session, user: User, session_id: str, message: str,
                  context: dict | None) -> tuple[str, list[dict], list[dict]]:
    query = message.strip()
    if SENSITIVE_REQUEST.search(query):
        return (
            "MOCK模式不执行泵阀控制、真实派工或删除正式业务记录。"
            "如需演示告警核查，请进入主动智能监护页面的SIM流程。",
            [], [],
        )
    navigation = _navigation(query)
    # Plain 'open/go to' is navigation; 'analyze decisions' must execute the
    # grounded three-role read-only analysis before adding its link.
    if navigation and NAV_PREFIX.search(query):
        return (
            f"已找到系统内业务页面：{navigation[0]['label']}。"
            "点击下方入口即可前往，不执行任何业务写入。",
            [{"name": "mock_business_navigation", "ok": True}], [],
        )
    if (bool(re.search(r"看板", query)) and
        bool(re.search(r"添加|增加|加上|加入|移除|删除|去掉|去除", query))):
        return _plan_board_edit(db, user, session_id, query)
    if re.search(r"处置方案|处置建议|处置研判|方案研判|多Agent|多智能体", query, re.I):
        if not context:
            return (
                "请先启动统一SIM推演，再进行本轮处置方案研判。"
                "研判需要同一轮供水、监护与四种方案比选结果，不允许直接生成现场派工。",
                [], [],
            )
        from app.services.tanggang_mock_decision import analyze
        try:
            assessment = analyze(context)
        except HTTPException:
            return (
                "当前演示快照没有完整的四方案比选数据。请重新运行统一SIM情景。",
                [], [],
            )
        summary = "\n".join(
            f"{step['name']}（MOCK规则）：{step['finding']}\n"
            f"依据：{step['evidence']}\n限制：{step['limitation']}"
            for step in assessment["roles"]
        )
        return (
            f"本轮SIM跨角色研判 · {context['scenario_id']} 第{context['run_number']}轮\n"
            + summary
            + "\n以上并非真实多Agent自主推理。请前往“处置研判”选择一项SIM研究方案，"
              "记录理由；新一轮SIM可用于数值复核，不会下发现场指令。",
            [{"name": "mock_"+step["id"], "ok": True}
             for step in assessment["roles"]], [],
        )
    if re.search(r"复盘|运行报告|演示报告", query):
        return _plan_sim_report(db, user, session_id, context)
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
    for action in actions:
        db.add(TanggangMockAiMessage(
            session_id=sess.id, owner_id=user.id, role="action",
            content=action["action_id"],
        ))
    sess.message_count += 2
    sess.updated_at = now
    db.commit()
    return {
        "session_id": sess.id,
        "reply": reply, "model": MODEL_NAME, "mock": True, "data_mode": "SIM",
        "tool_trace": trace, "pending_actions": actions,
        "links": _navigation(message) if not SENSITIVE_REQUEST.search(message) else [],
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
    def public_action(a):
        return {
            "action_id": a.id, "tool": a.tool, "title": a.title,
            "summary": a.summary, "payload": json.loads(a.payload_json),
            "status": a.status, "risk": "medium",
            "result_path": (
                "/port/analysis/boards" if a.tool in
                ("create_sim_board", "edit_sim_board")
                else "/port/analysis/reports" if a.tool == "create_sim_report"
                else "/port/analysis/equipment-drafts"
            ) if a.status == "confirmed" else None,
        }
    mapped = {a.id: public_action(a) for a in actions}
    output = []
    associated = set()
    last_user_text = ""
    for m in messages:
        if m.role in ("user", "assistant"):
            if m.role == "user":
                last_user_text = m.content
            output.append({
                "role": m.role, "content": m.content,
                "ts": m.created_at.timestamp(), "pending_actions": [],
                "links": _navigation(last_user_text)
                    if m.role == "assistant" and not SENSITIVE_REQUEST.search(last_user_text)
                    else [],
            })
        elif m.role == "action" and m.content in mapped:
            if output and output[-1]["role"] == "assistant":
                output[-1]["pending_actions"].append(mapped[m.content])
                associated.add(m.content)
    # Legacy sessions created before per-turn action association are restored
    # on the final assistant only to preserve backwards compatibility.
    missing = [value for key, value in mapped.items() if key not in associated]
    if missing:
        last = next((m for m in reversed(output) if m["role"] == "assistant"), None)
        if last is not None:
            last["pending_actions"].extend(missing)
    return {
        "id": s.id, "user_id": str(user.id), "mock": True,
        "messages": output,
        "pending_actions": list(mapped.values()),
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
        elif a.tool == "edit_sim_board":
            board_id = payload.get("board_id")
            expected_version = payload.get("expected_version")
            b = db.get(TanggangBoard, board_id)
            if (b is None or not isinstance(expected_version, int)
                or (b.owner_id != user.id and
                    "sys:menu:manage" not in collect_user_perms(db, user))):
                db.rollback()
                raise HTTPException(status_code=403, detail="看板已不存在或无权修改")
            if b.status != "draft" or b.version != expected_version:
                db.rollback()
                raise HTTPException(status_code=409, detail="看板状态或版本已变化，请重新生成修改预览")
            try:
                verified = BoardBody.model_validate({
                    "title": b.title, "target_path": b.target_path,
                    "widgets": payload.get("widgets", []), "version": expected_version,
                })
            except ValidationError:
                db.rollback()
                raise HTTPException(status_code=422, detail="待确认看板布局已失效") from None
            before = json.loads(b.widgets_json)
            new = [w.model_dump() for w in verified.widgets]
            original_keys = [(w.get("kind"), w.get("metric"), w.get("id")) for w in before]
            new_keys = [(w.get("kind"), w.get("metric"), w.get("id")) for w in new]
            added = [x for x in new_keys if x not in original_keys]
            removed = [x for x in original_keys if x not in new_keys]
            kind, metric = payload.get("component_kind"), payload.get("component_metric")
            if payload.get("operation") == "add":
                valid_change = len(added) == 1 and not removed and added[0][:2] == (kind, metric)
            elif payload.get("operation") == "remove":
                valid_change = len(removed) == 1 and not added and removed[0][:2] == (kind, metric)
            else:
                valid_change = False
            if not valid_change or len(new) == 0:
                db.rollback()
                raise HTTPException(status_code=422, detail="布局变更与待确认操作不一致")
            changed = db.execute(
                update(TanggangBoard).where(
                    TanggangBoard.id == b.id, TanggangBoard.version == expected_version,
                    TanggangBoard.status == "draft",
                ).values(
                    widgets_json=json.dumps(new, ensure_ascii=False),
                    version=expected_version + 1, updated_by=user.id,
                    updated_at=datetime.now(UTC).replace(tzinfo=None),
                ),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise HTTPException(status_code=409, detail="看板版本冲突，请重新生成修改预览")
            db.flush()
            db.refresh(b)
            _rev(db, b, "update", user.id)
            result = {
                "id": b.id, "title": b.title, "version": b.version,
                "path": "/port/analysis/boards", "status": "draft",
                "data_mode": "SIM",
            }
        elif a.tool == "create_sim_report":
            if (payload.get("data_mode") != "SIM" or
                payload.get("field_verified") is not False or
                payload.get("data_origin") != "BROWSER_SIM_SNAPSHOT" or
                payload.get("production_case_created") is not False or
                payload.get("repair_order_created") is not False):
                db.rollback()
                raise HTTPException(status_code=422, detail="不是有效的SIM复盘草稿")
            from app.api.ai import DemoContext
            try:
                # Revalidate every user-sourced value at confirm time.
                DemoContext.model_validate({
                    **payload, "data_mode": payload["data_mode"],
                    "field_verified": payload["field_verified"],
                })
            except (ValidationError, KeyError):
                db.rollback()
                raise HTTPException(status_code=422, detail="SIM复盘数据校验失败") from None
            row = TanggangMockAiReport(
                owner_id=user.id, session_id=a.session_id,
                scenario_id=payload["scenario_id"],
                run_number=payload["run_number"],
                report_json=json.dumps(payload, ensure_ascii=False),
            )
            db.add(row)
            db.flush()
            result = {
                "id": row.id, "path": "/port/analysis/reports",
                "scenario_id": row.scenario_id,
                "run_number": row.run_number,
                "data_mode": "SIM", "field_verified": False,
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
