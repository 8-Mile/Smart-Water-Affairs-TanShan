"""OPC 值转换与 mock/opcua mode 切换（不依赖真实 OPC Server）。"""

from app.sources.value_codec import build_sample, python_to_opc_value
from app.runtime import gateway_runtime


def test_build_sample_number():
    s = build_sample(
        point_id=1,
        tag_name="700",
        node_id="ns=1;i=700",
        value_type="number",
        raw=55.5,
        ts_ms=123,
    )
    assert s.value_num == 55.5
    assert s.tag_name == "700"


def test_build_sample_bool_string():
    s = build_sample(
        point_id=2,
        tag_name="702",
        node_id="ns=1;i=702",
        value_type="bool",
        raw="true",
        ts_ms=1,
    )
    assert s.value_bool is True
    assert s.value_num == 1.0


def test_python_to_opc_value():
    assert python_to_opc_value("on", "bool") is True
    assert python_to_opc_value(12, "number") == 12.0
    assert python_to_opc_value(1, "string") == "1"


def test_runtime_rejects_unknown_mode():
    gateway_runtime.stop()
    try:
        gateway_runtime.start(mode="foobar")
        assert False, "should raise"
    except ValueError as e:
        assert "不支持" in str(e)
    finally:
        gateway_runtime.stop()


def test_runtime_start_mock_ok():
    gateway_runtime.stop()
    st = gateway_runtime.start(mode="mock", interval_sec=1.0)
    assert st["running"] is True
    assert st["mode"] == "mock"
    gateway_runtime.stop()
    assert gateway_runtime.status()["running"] is False
