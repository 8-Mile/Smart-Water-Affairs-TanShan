"""带工具调用的对话编排（支持事件流）。"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any, Optional

from app.core.config import get_settings
from app.llm.ollama import ollama_client
from app.tools.main_api import MainAppClient
from app.tools.registry import TOOL_DEFINITIONS, dump_tool_result, execute_tool


SYSTEM_PROMPT = """你是「生产运维管理系统」的本地智能助手，服务于泵站/水厂值班与运维人员。

规则：
1. 涉及告警数量、工单状态、测点数值、设备清单、调度/巡检/供水/能耗等**实时或业务数据**时，必须调用提供的工具查询，禁止编造数字。
2. 涉及制度、标准、图纸说明、验收要求、档案文档内容时，必须调用 search_knowledge（或 list_archives），并根据返回片段回答；**必须写明来源档案名称**；检索无结果时明确说「档案库未检索到」。
3. 用户要求**创建工单/调度指令**时，可调用 create_repair_order / create_dispatch。这些工具**不会立即写入**，只会生成待确认操作；你必须明确告知用户：请在界面点击「确认执行」。
4. 创建维修工单前，若用户未提供 equipment_id，先 list_equipment 查找设备再创建。
5. 创建调度指令需要 executor_id 与 expected_finish_time；信息不全时先追问，不要瞎填。
6. inject_scada_value 为高风险，默认禁用；即使用户要求，若工具返回禁用错误，如实说明。
7. 工具返回 error 时如实告知用户。
8. 用简洁中文回答；先给结论，再列关键明细。
"""


def _parse_arguments(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"_raw": raw}
    return {}


def _normalize_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
    calls = message.get("tool_calls") or []
    out: list[dict[str, Any]] = []
    for i, c in enumerate(calls):
        if not isinstance(c, dict):
            continue
        fn = c.get("function") or c
        name = fn.get("name") or c.get("name")
        if not name:
            continue
        args = _parse_arguments(fn.get("arguments") if "arguments" in fn else c.get("arguments"))
        out.append(
            {
                "id": c.get("id") or f"call_{i}",
                "name": name,
                "arguments": args,
            }
        )
    return out


def iter_chat_events(
    messages: list[dict[str, Any]],
    *,
    user_token: Optional[str] = None,
    user_context: Optional[dict[str, Any]] = None,
    stream_final: bool = False,
) -> Iterator[dict[str, Any]]:
    """
    产出事件：
      {type: status|tool|pending|token|done|error, ...}
    """
    settings = get_settings()
    max_rounds = settings.ai_max_tool_rounds
    use_tools = bool(user_token) and settings.ai_tools_enabled

    if not messages or messages[0].get("role") != "system":
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
    else:
        messages = list(messages)
        messages[0] = {"role": "system", "content": SYSTEM_PROMPT}

    client = MainAppClient(user_token) if user_token else None
    tool_trace: list[dict[str, Any]] = []
    pending_actions: list[dict[str, Any]] = []
    model_name = settings.ollama_chat_model

    yield {"type": "status", "message": "thinking"}

    try:
        for round_i in range(max_rounds + 1):
            result = ollama_client.chat(
                messages,
                tools=TOOL_DEFINITIONS if use_tools else None,
                temperature=settings.ai_temperature,
            )
            model_name = result.get("model") or model_name
            msg = result.get("message") or {
                "role": "assistant",
                "content": result.get("content") or "",
            }
            tool_calls = _normalize_tool_calls(msg) if use_tools else []

            if not tool_calls or not client or round_i >= max_rounds:
                content = (msg.get("content") or result.get("content") or "").strip()
                if not content and pending_actions:
                    content = (
                        "已生成待确认操作，请在下方点击「确认执行」后才会写入系统。"
                        "若信息有误请点「取消」。"
                    )
                if not content and tool_trace:
                    content = "已查询系统数据，但模型未生成文字总结。"
                if not content:
                    content = "（模型未返回内容）"

                # 可选：无 tool 且 stream_final 时对最终文本做“伪流式”切分
                if stream_final and content and not pending_actions:
                    # 按小段推送，改善体感
                    step = 12
                    for i in range(0, len(content), step):
                        yield {"type": "token", "text": content[i : i + step]}
                elif stream_final and content:
                    yield {"type": "token", "text": content}

                yield {
                    "type": "done",
                    "content": content,
                    "model": model_name,
                    "tool_trace": tool_trace,
                    "pending_actions": pending_actions,
                    "rounds": round_i + 1,
                }
                return

            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": msg.get("content") or "",
            }
            if msg.get("tool_calls"):
                assistant_msg["tool_calls"] = msg["tool_calls"]
            messages.append(assistant_msg)

            for call in tool_calls:
                name = call["name"]
                args = call["arguments"]
                yield {"type": "status", "message": f"tool:{name}"}
                exec_result = execute_tool(
                    name,
                    args,
                    client=client,
                    user_context=user_context,
                )
                summary = {
                    "name": name,
                    "arguments": args,
                    "ok": exec_result.get("ok"),
                    "error": exec_result.get("error"),
                    "pending": bool(exec_result.get("pending")),
                }
                if exec_result.get("pending") and exec_result.get("action_id"):
                    pa = {
                        "action_id": exec_result["action_id"],
                        "tool": name,
                        "title": exec_result.get("title") or name,
                        "summary": exec_result.get("summary") or "",
                        "payload": exec_result.get("payload") or args,
                        "risk": exec_result.get("risk") or "write",
                        "status": "pending",
                    }
                    pending_actions.append(pa)
                    summary["action_id"] = pa["action_id"]
                    yield {"type": "pending", "action": pa}
                elif exec_result.get("ok") and isinstance(exec_result.get("data"), dict):
                    data = exec_result["data"]
                    if "total" in data:
                        summary["total"] = data.get("total")
                    if "items" in data:
                        summary["items_count"] = len(data.get("items") or [])
                    else:
                        summary["keys"] = list(data.keys())[:12]
                tool_trace.append(summary)
                yield {"type": "tool", "tool": summary}

                tool_msg: dict[str, Any] = {
                    "role": "tool",
                    "content": dump_tool_result(exec_result),
                    "name": name,
                }
                if call.get("id"):
                    tool_msg["tool_call_id"] = call["id"]
                messages.append(tool_msg)

        yield {
            "type": "done",
            "content": "工具调用轮次过多，请缩小问题范围后重试。",
            "model": model_name,
            "tool_trace": tool_trace,
            "pending_actions": pending_actions,
            "rounds": max_rounds,
        }
    except Exception as exc:  # noqa: BLE001
        yield {"type": "error", "message": str(exc)}


def run_chat_with_tools(
    messages: list[dict[str, Any]],
    *,
    user_token: Optional[str] = None,
    user_context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """同步封装：收集事件流最终 done。"""
    final: dict[str, Any] = {
        "content": "",
        "model": get_settings().ollama_chat_model,
        "tool_trace": [],
        "pending_actions": [],
        "rounds": 0,
    }
    for ev in iter_chat_events(
        messages,
        user_token=user_token,
        user_context=user_context,
        stream_final=False,
    ):
        if ev.get("type") == "error":
            raise RuntimeError(ev.get("message") or "AI 编排失败")
        if ev.get("type") == "done":
            final = {
                "content": ev.get("content") or "",
                "model": ev.get("model"),
                "tool_trace": ev.get("tool_trace") or [],
                "pending_actions": ev.get("pending_actions") or [],
                "rounds": ev.get("rounds") or 0,
            }
    return final
