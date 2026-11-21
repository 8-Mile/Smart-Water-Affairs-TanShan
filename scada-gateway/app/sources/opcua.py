"""OPC-UA 数据源：asyncua 订阅 + 轮询兜底 + 断线重连。"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any, Optional

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.sources.base import OnSamples
from app.sources.value_codec import build_sample, python_to_opc_value
from app.store.models import GwPoint

logger = logging.getLogger("scada-gateway.opcua")


class OpcUaSource:
    """
    在独立线程中运行 asyncio 事件循环。
    优先 Subscription 数据变化；并按 poll 间隔读一次作为兜底。
    """

    def __init__(self, on_samples: OnSamples) -> None:
        self._on_samples = on_samples
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._stop = threading.Event()
        self._client: Any = None
        self._subscription: Any = None
        self._handles: list[Any] = []
        self._connected = False
        self._last_error: Optional[str] = None
        self._last_connect_at: Optional[float] = None
        self._reconnect_count = 0
        self._read_count = 0
        self._node_to_point: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._thread_main,
            name="opcua-source",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        loop = self._loop
        if loop and loop.is_running():
            fut = asyncio.run_coroutine_threadsafe(self._async_disconnect(), loop)
            try:
                fut.result(timeout=5)
            except Exception:  # noqa: BLE001
                pass
            loop.call_soon_threadsafe(loop.stop)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=8)
        self._thread = None
        self._loop = None
        with self._lock:
            self._connected = False

    def status(self) -> dict[str, Any]:
        settings = get_settings()
        with self._lock:
            return {
                "type": "opcua",
                "connected": self._connected,
                "endpoint": settings.opcua_endpoint,
                "security_policy": settings.opcua_security_policy,
                "auth_mode": settings.opcua_auth_mode,
                "subscribed_nodes": len(self._handles),
                "mapped_points": len(self._node_to_point),
                "last_error": self._last_error,
                "last_connect_at": self._last_connect_at,
                "reconnect_count": self._reconnect_count,
                "read_count": self._read_count,
                "poll_interval_sec": settings.opcua_poll_interval_sec,
                "allow_write": settings.opcua_allow_write,
            }

    def write_node(self, node_id: str, value: Any, value_type: str) -> None:
        """可选：向 OPC 写入（inject 用）。"""
        settings = get_settings()
        if not settings.opcua_allow_write:
            raise RuntimeError("OPC 写入未启用（OPCUA_ALLOW_WRITE=false）")
        loop = self._loop
        if not loop or not self._connected:
            raise RuntimeError("OPC-UA 未连接")
        fut = asyncio.run_coroutine_threadsafe(
            self._async_write(node_id, python_to_opc_value(value, value_type)),
            loop,
        )
        fut.result(timeout=10)

    def _thread_main(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._async_run())
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._last_error = str(exc)
            logger.exception("opcua loop crashed: %s", exc)
        finally:
            try:
                loop.close()
            except Exception:  # noqa: BLE001
                pass

    async def _async_run(self) -> None:
        settings = get_settings()
        backoff = max(1.0, float(settings.opcua_reconnect_sec))
        while not self._stop.is_set():
            try:
                await self._async_connect_and_loop()
                backoff = max(1.0, float(settings.opcua_reconnect_sec))
            except Exception as exc:  # noqa: BLE001
                with self._lock:
                    self._connected = False
                    self._last_error = str(exc)
                    self._reconnect_count += 1
                logger.warning("opcua disconnected: %s; reconnect in %.1fs", exc, backoff)
                await self._async_disconnect()
                # 等待可中断
                for _ in range(int(backoff * 10)):
                    if self._stop.is_set():
                        return
                    await asyncio.sleep(0.1)
                backoff = min(backoff * 1.5, 60.0)

    async def _async_connect_and_loop(self) -> None:
        settings = get_settings()
        try:
            from asyncua import Client, ua
        except ImportError as e:
            raise RuntimeError(
                "未安装 asyncua，请执行: pip install asyncua"
            ) from e

        self._reload_point_map()
        client = Client(url=settings.opcua_endpoint, timeout=settings.opcua_timeout_sec)
        self._client = client

        # 认证
        if settings.opcua_auth_mode == "user" and settings.opcua_username:
            client.set_user(settings.opcua_username)
            client.set_password(settings.opcua_password or "")

        # 安全策略：None 为默认明文；其他需现场证书配置
        policy = (settings.opcua_security_policy or "None").strip()
        if policy and policy.lower() not in ("none", "no", "null"):
            # 例：Basic256Sha256,SignAndEncrypt
            # 无证书时仅记录警告，仍尝试连接
            logger.info("OPCUA_SECURITY_POLICY=%s（需证书时请配置 OPCUA_CERT/KEY）", policy)
            cert = settings.opcua_cert_path
            key = settings.opcua_key_path
            if cert and key:
                await client.set_security_string(
                    f"{policy},{cert},{key}"
                )

        await client.connect()
        with self._lock:
            self._connected = True
            self._last_connect_at = time.time()
            self._last_error = None
        logger.info("opcua connected: %s", settings.opcua_endpoint)

        # 订阅
        handler = _SubHandler(self)
        self._subscription = await client.create_subscription(
            settings.opcua_subscription_period_ms, handler
        )
        self._handles = []
        for node_id, meta in list(self._node_to_point.items()):
            try:
                node = client.get_node(node_id)
                handle = await self._subscription.subscribe_data_change(node)
                self._handles.append(handle)
            except Exception as exc:  # noqa: BLE001
                logger.warning("subscribe failed %s: %s", node_id, exc)

        # 首轮全读 + 周期 poll
        await self._poll_all(client)
        poll = max(0.5, float(settings.opcua_poll_interval_sec))
        while not self._stop.is_set():
            await asyncio.sleep(poll)
            if self._stop.is_set():
                break
            # 刷新测点映射（支持运行中改测点）
            self._reload_point_map()
            await self._poll_all(client)

    async def _poll_all(self, client: Any) -> None:
        samples = []
        ts_ms = int(time.time() * 1000)
        for node_id, meta in list(self._node_to_point.items()):
            try:
                node = client.get_node(node_id)
                dv = await node.read_data_value()
                raw = dv.Value.Value if dv and dv.Value is not None else None
                sc = 0
                sn = "Good"
                if dv and dv.StatusCode is not None:
                    try:
                        sc = int(dv.StatusCode.value)
                        sn = "Good" if dv.StatusCode.is_good() else str(dv.StatusCode)
                    except Exception:  # noqa: BLE001
                        pass
                if dv and dv.SourceTimestamp:
                    try:
                        ts_ms = int(dv.SourceTimestamp.timestamp() * 1000)
                    except Exception:  # noqa: BLE001
                        ts_ms = int(time.time() * 1000)
                samples.append(
                    build_sample(
                        point_id=meta["id"],
                        tag_name=meta["tag_name"],
                        node_id=node_id,
                        value_type=meta["value_type"],
                        raw=raw,
                        ts_ms=ts_ms,
                        status_code=sc,
                        status_name=sn,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("read %s failed: %s", node_id, exc)
        if samples:
            with self._lock:
                self._read_count += len(samples)
            self._on_samples(samples)

    def handle_data_change(self, node_id: str, raw: Any, ts_ms: int, status_name: str) -> None:
        meta = self._node_to_point.get(node_id)
        if not meta:
            # 尝试规范化匹配
            for k, v in self._node_to_point.items():
                if k == node_id or k.endswith(node_id) or node_id.endswith(k):
                    meta = v
                    node_id = k
                    break
        if not meta:
            return
        sample = build_sample(
            point_id=meta["id"],
            tag_name=meta["tag_name"],
            node_id=node_id,
            value_type=meta["value_type"],
            raw=raw,
            ts_ms=ts_ms,
            status_name=status_name or "Good",
        )
        with self._lock:
            self._read_count += 1
        self._on_samples([sample])

    def _reload_point_map(self) -> None:
        db = SessionLocal()
        try:
            rows = (
                db.query(GwPoint)
                .filter(GwPoint.enabled == 1)
                .all()
            )
            mapping: dict[str, dict[str, Any]] = {}
            for p in rows:
                # source 为 mock 的点在 opcua 模式下仍可读 node_id（便于共用种子）
                nid = (p.node_id or "").strip()
                if not nid:
                    continue
                mapping[nid] = {
                    "id": p.id,
                    "tag_name": p.tag_name,
                    "value_type": p.value_type or "number",
                }
            with self._lock:
                self._node_to_point = mapping
        finally:
            db.close()

    async def _async_write(self, node_id: str, value: Any) -> None:
        if not self._client:
            raise RuntimeError("client missing")
        node = self._client.get_node(node_id)
        await node.write_value(value)

    async def _async_disconnect(self) -> None:
        try:
            if self._subscription:
                try:
                    await self._subscription.delete()
                except Exception:  # noqa: BLE001
                    pass
            self._subscription = None
            self._handles = []
            if self._client:
                try:
                    await self._client.disconnect()
                except Exception:  # noqa: BLE001
                    pass
            self._client = None
        finally:
            with self._lock:
                self._connected = False


class _SubHandler:
    def __init__(self, source: OpcUaSource) -> None:
        self._source = source

    def datachange_notification(self, node, val, data):  # noqa: ANN001
        try:
            node_id = str(node.nodeid) if hasattr(node, "nodeid") else str(node)
            ts_ms = int(time.time() * 1000)
            status_name = "Good"
            if data is not None and getattr(data, "monitored_item", None):
                # asyncua DataChangeNotification
                pass
            if hasattr(data, "monitored_item") is False and data is not None:
                try:
                    # data may be DataValue
                    if getattr(data, "SourceTimestamp", None):
                        ts_ms = int(data.SourceTimestamp.timestamp() * 1000)
                    if getattr(data, "StatusCode", None) is not None:
                        status_name = (
                            "Good" if data.StatusCode.is_good() else str(data.StatusCode)
                        )
                except Exception:  # noqa: BLE001
                    pass
            # Prefer monitored item value wrapper
            raw = val
            self._source.handle_data_change(node_id, raw, ts_ms, status_name)
        except Exception as exc:  # noqa: BLE001
            logger.debug("datachange handler error: %s", exc)

    def event_notification(self, event):  # noqa: ANN001
        return
