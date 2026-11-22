"""Authoritative current project stage: user-document-based software demonstration.

A record being in the system, having a recent timestamp or a reviewed *document*
mapping does not turn it into a live Tanggang field measurement.
"""
STAGE = "DOCUMENT_BASED_DEMO"
SCOPE = "USER_UPLOADED_MATERIALS"
BASIS_TYPES = ("UNVERIFIED", "DOCUMENT_REFERENCE", "ASSUMPTION", "DEMO_VALUE")


def data_context() -> dict:
    return {
        "stage": STAGE,
        "sources_scope": SCOPE,
        "field_data_confirmed": False,
        "production_plc_connected": False,
        "real_hydraulic_topology_confirmed": False,
        "point_mapping_field_verified": False,
        "eligible_measured_point_count": 0,
        "labels": {
            "DOCUMENT_REFERENCE": "上传资料参考",
            "ASSUMPTION": "依据资料推导",
            "DEMO_VALUE": "演示假设",
            "UNVERIFIED": "尚未核对",
        },
        "numeric_values_policy": "演示数据均非唐港现场实测，仅用于模型验证和业务演示",
        "review_policy": "资料审核不等于现场验收；现场接入须另行核对设备、点表和时间质量",
    }
