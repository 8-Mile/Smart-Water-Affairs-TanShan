"""SCADA 接入配置：页面保存的配置覆盖 .env 默认值，并提供连接测试。"""

from __future__ import annotations

import socket
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.scada import ScadaConfig, ScadaPoint
from app.schemas.scada import ScadaConfigIn, ScadaConfigTestIn
from app.services.scada_client import scada_gateway_client

_MASK = "******"


def _env_values() -> dict[str, Any]:
    s = get_settings()
    return {
        "mode": s.scada_mode,
        "gateway_url": s.scada_gateway_url,
        "gateway_api_prefix": s.scada_gateway_api_prefix,
        "gateway_token": s.scada_gateway_token,
        "ingest_token": s.scada_ingest_token,
        "data_source": s.scada_data_source,
        "opcua_endpoint": s.scada_opcua_endpoint,
        "opcua_security_policy": s.scada_opcua_security_policy,
        "opcua_auth_mode": s.scada_opcua_auth_mode,
        "opcua_username": s.scada_opcua_username,
        "opcua_password": s.scada_opcua_password,
        "sim_interval_sec": s.scada_sim_interval_sec,
        "auto_start": 1 if s.scada_auto_start else 0,
    }


def _row_values(row: ScadaConfig) -> dict[str, Any]:
    return {
        "mode": row.mode,
        "gateway_url": row.gateway_url,
        "gateway_api_prefix": row.gateway_api_prefix,
        "gateway_token": row.gateway_token,
        "ingest_token": row.ingest_token,
        "data_source": row.data_source,
        "opcua_endpoint": row.opcua_endpoint,
        "opcua_security_policy": row.opcua_security_policy,
        "opcua_auth_mode": row.opcua_auth_mode,
        "opcua_username": row.opcua_username,
        "opcua_password": row.opcua_password,
        "sim_interval_sec": float(row.sim_interval_sec or 0),
        "auto_start": int(row.auto_start or 0),
    }


def _apply(values: dict[str, Any]) -> None:
    """把配置写回全局 settings 单例，供现有采集/网关客户端立即使用。"""
    s = get_settings()
    s.scada_mode = str(values["mode"])
    s.scada_gateway_url = str(values["gateway_url"] or "")
    s.scada_gateway_api_prefix = str(values["gateway_api_prefix"] or "/api/v1")
    s.scada_gateway_token = str(values["gateway_token"] or "")
    s.scada_ingest_token = str(values["ingest_token"] or "")
    s.scada_data_source = str(values["data_source"] or "mirror")
    s.scada_opcua_endpoint = str(values["opcua_endpoint"] or "")
    s.scada_opcua_security_policy = str(values["opcua_security_policy"] or "None")
    s.scada_opcua_auth_mode = str(values["opcua_auth_mode"] or "anonymous")
    s.scada_opcua_username = str(values["opcua_username"] or "")
    s.scada_opcua_password = str(values["opcua_password"] or "")
    s.scada_sim_interval_sec = float(values["sim_interval_sec"] or 1.0)
    s.scada_auto_start = bool(values["auto_start"])
    # 网关客户端在启动时缓存了 settings 引用，这里同步指向同一单例
    scada_gateway_client.settings = s


def _current(db: Session) -> dict[str, Any]:
    row = db.query(ScadaConfig).first()
    return _row_values(row) if row else _env_values()


def load_saved_config(db: Session) -> None:
    """启动时把已保存配置覆盖到 settings（无记录则保持 .env）。"""
    row = db.query(ScadaConfig).first()
    if row:
        _apply(_row_values(row))


def get_config(db: Session) -> dict[str, Any]:
    row = db.query(ScadaConfig).first()
    values = _current(db)
    return {
        "mode": values["mode"],
        "gateway_url": values["gateway_url"],
        "gateway_api_prefix": values["gateway_api_prefix"],
        "gateway_token": _MASK if values["gateway_token"] else "",
        "gateway_token_set": bool(values["gateway_token"]),
        "ingest_token": _MASK if values["ingest_token"] else "",
        "ingest_token_set": bool(values["ingest_token"]),
        "data_source": values["data_source"],
        "opcua_endpoint": values["opcua_endpoint"],
        "opcua_security_policy": values["opcua_security_policy"],
        "opcua_auth_mode": values["opcua_auth_mode"],
        "opcua_username": values["opcua_username"],
        "opcua_password": _MASK if values["opcua_password"] else "",
        "opcua_password_set": bool(values["opcua_password"]),
        "sim_interval_sec": values["sim_interval_sec"],
        "auto_start": bool(values["auto_start"]),
        "source": "saved" if row else "env",
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def save_config(db: Session, body: ScadaConfigIn, username: str) -> dict[str, Any]:
    row = db.query(ScadaConfig).first()
    base = _current(db)

    def _pick(new_value: str | None, old_value: str) -> str:
        # 密码/令牌留空表示沿用旧值
        return new_value if new_value else old_value

    values = {
        "mode": body.mode,
        "gateway_url": body.gateway_url.strip(),
        "gateway_api_prefix": body.gateway_api_prefix.strip() or "/api/v1",
        "gateway_token": _pick(body.gateway_token, base["gateway_token"]),
        "ingest_token": _pick(body.ingest_token, base["ingest_token"]),
        "data_source": body.data_source,
        "opcua_endpoint": body.opcua_endpoint.strip(),
        "opcua_security_policy": body.opcua_security_policy.strip() or "None",
        "opcua_auth_mode": body.opcua_auth_mode,
        "opcua_username": body.opcua_username.strip(),
        "opcua_password": _pick(body.opcua_password, base["opcua_password"]),
        "sim_interval_sec": float(body.sim_interval_sec),
        "auto_start": 1 if body.auto_start else 0,
    }

    if row is None:
        row = ScadaConfig(id=1)
        db.add(row)
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_by = username
    db.commit()
    db.refresh(row)

    _apply(values)

    # 模式切换即时生效：mock 且有自动启动则拉起仿真，否则停止本地仿真
    from app.scada.simulator import scada_runtime

    if body.mode == "mock":
        if body.auto_start:
            scada_runtime.start(
                mode="mock", interval_sec=float(body.sim_interval_sec)
            )
    else:
        scada_runtime.stop()

    return get_config(db)


def _check(key: str, name: str, status: str, detail: str) -> dict[str, str]:
    return {"key": key, "name": name, "status": status, "detail": detail}


def _resolve_test_values(db: Session, body: ScadaConfigTestIn) -> dict[str, Any]:
    base = _current(db)
    return {
        "mode": body.mode,
        "gateway_url": body.gateway_url.strip() or base["gateway_url"],
        "gateway_api_prefix": (
            body.gateway_api_prefix.strip() or base["gateway_api_prefix"]
        ),
        "gateway_token": body.gateway_token or base["gateway_token"],
        "opcua_endpoint": body.opcua_endpoint.strip() or base["opcua_endpoint"],
        "opcua_auth_mode": body.opcua_auth_mode,
        "opcua_username": body.opcua_username.strip(),
    }


def _test_gateway(
    db: Session, body: ScadaConfigTestIn, values: dict[str, Any]
) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    gateway_url = (values["gateway_url"] or "").rstrip("/")
    prefix = (values["gateway_api_prefix"] or "").rstrip("/")
    if not gateway_url:
        checks.append(_check("address", "网关地址", "fail", "未填写网关地址"))
        return checks
    checks.append(_check("address", "网关地址", "ok", gateway_url))
    base = f"{gateway_url}{prefix}"
    headers = {"X-Gateway-Token": values["gateway_token"] or ""}

    try:
        started = time.perf_counter()
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{base}/health", headers=headers)
        cost = int((time.perf_counter() - started) * 1000)
        if r.status_code == 200:
            checks.append(
                _check("http", "网关 HTTP 可达", "ok", f"HTTP 200 · {cost} ms")
            )
        elif r.status_code in (401, 403):
            checks.append(
                _check(
                    "http",
                    "网关 HTTP 可达",
                    "fail",
                    f"HTTP {r.status_code} · 令牌无效或未授权",
                )
            )
            return checks
        else:
            checks.append(
                _check("http", "网关 HTTP 可达", "fail", f"HTTP {r.status_code}")
            )
            return checks
    except Exception as exc:  # noqa: BLE001
        checks.append(_check("http", "网关 HTTP 可达", "fail", str(exc)))
        return checks

    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{base}/runtime/status", headers=headers)
        if r.status_code == 200:
            st = (r.json() or {}).get("data") or {}
            running = "运行中" if st.get("running") else "未运行"
            checks.append(
                _check(
                    "auth",
                    "网关鉴权",
                    "ok",
                    f"令牌校验通过 · 采集{running} · 模式 {st.get('mode', '-')}",
                )
            )
        elif r.status_code in (401, 403):
            checks.append(
                _check("auth", "网关鉴权", "fail", f"HTTP {r.status_code} · 令牌无效")
            )
        else:
            checks.append(
                _check("auth", "网关鉴权", "warn", f"HTTP {r.status_code}")
            )
    except Exception as exc:  # noqa: BLE001
        checks.append(_check("auth", "网关鉴权", "warn", str(exc)))

    tag = body.sample_tag
    if not tag:
        first = (
            db.query(ScadaPoint)
            .filter(
                ScadaPoint.deleted == 0,
                ScadaPoint.status == 1,
                ScadaPoint.enabled == 1,
            )
            .order_by(ScadaPoint.id.asc())
            .first()
        )
        tag = first.tag_name if first else None
    if tag:
        checks.append(_test_sample(base, headers, tag))
    return checks


def _test_sample(base: str, headers: dict[str, str], tag: str) -> dict[str, str]:
    try:
        with httpx.Client(timeout=8.0) as client:
            r = client.get(
                f"{base}/latest",
                headers=headers,
                params={"tag_name": tag, "limit": 5},
            )
        if r.status_code != 200:
            return _check("sample", "点位取数", "fail", f"HTTP {r.status_code}")
        rows = (r.json() or {}).get("data") or []
        if not rows:
            return _check("sample", "点位取数", "warn", f"{tag} 暂无采样值")
        row = rows[0]
        status_name = row.get("status_name") or ""
        detail = f"{tag} = {row.get('display_value')}"
        if status_name and status_name != "Good":
            return _check("sample", "点位取数", "warn", f"{detail} · 质量 {status_name}")
        return _check("sample", "点位取数", "ok", f"{detail} · 质量 Good")
    except Exception as exc:  # noqa: BLE001
        return _check("sample", "点位取数", "fail", str(exc))


def _test_opcua(values: dict[str, Any]) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    endpoint = values["opcua_endpoint"] or ""
    parsed = urlparse(endpoint)
    if parsed.scheme != "opc.tcp" or not parsed.hostname:
        return [
            _check(
                "address",
                "端点格式",
                "fail",
                "请填写 opc.tcp://主机:端口，例如 opc.tcp://192.168.2.222:9433",
            )
        ]
    port = parsed.port or 4840
    checks.append(_check("address", "端点格式", "ok", f"{parsed.hostname}:{port}"))
    try:
        started = time.perf_counter()
        with socket.create_connection((parsed.hostname, port), timeout=5.0):
            pass
        cost = int((time.perf_counter() - started) * 1000)
        checks.append(
            _check("tcp", "OPC UA TCP 可达", "ok", f"连接成功 · {cost} ms")
        )
    except Exception as exc:  # noqa: BLE001
        checks.append(_check("tcp", "OPC UA TCP 可达", "fail", str(exc)))
        return checks
    checks.append(
        _check(
            "sample",
            "点位取数",
            "warn",
            "TCP 已连通；实际点位读写需由现场网关完成 OPC UA 订阅后回传",
        )
    )
    return checks


def test_connection(
    db: Session, body: ScadaConfigTestIn
) -> dict[str, Any]:
    started = time.perf_counter()
    values = _resolve_test_values(db, body)
    mode = values["mode"]

    if mode == "gateway":
        checks = _test_gateway(db, body, values)
    elif mode == "opcua":
        checks = _test_opcua(values)
    else:
        checks = [
            _check("mode", "采集模式", "ok", "主站内置仿真，无需连接外部 SCADA"),
        ]

    ok_flag = all(c["status"] != "fail" for c in checks)
    return {
        "ok": ok_flag,
        "mode": mode,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "checks": checks,
    }
