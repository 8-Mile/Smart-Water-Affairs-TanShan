"""Read-only, evidence-based six-system SCADA integration preparation inventory.

These numbers describe existing software configuration, never installation,
communication tests, field measurements, hydraulic feasibility or commissioning.
"""
from collections import defaultdict
from sqlalchemy.orm import Session

from app.models.equipment import Equipment
from app.models.scada import ScadaPoint
from app.models.tanggang import TanggangObjectLink, TanggangLinkAsset, TanggangLinkMetric
from app.models.tanggang_provenance import TanggangPointReview
from app.services.tanggang_catalog import SYSTEMS
from app.services.tanggang_provenance import BASIS_TYPES

REAL_BASIS = "DOCUMENT_REFERENCE"
CONFIG_BASIS = frozenset(BASIS_TYPES) - {"UNVERIFIED"}


def integration_readiness(db: Session) -> dict:
    """Count only persisted rows; do not fabricate six-system telemetry."""
    links = db.query(TanggangObjectLink).filter(
        TanggangObjectLink.deleted == 0,
    ).all()
    link_ids = [link.id for link in links]
    assets = db.query(TanggangLinkAsset).filter(
        TanggangLinkAsset.link_id.in_(link_ids),
    ).all() if link_ids else []
    metrics = db.query(TanggangLinkMetric).filter(
        TanggangLinkMetric.link_id.in_(link_ids),
    ).all() if link_ids else []
    reviews = db.query(TanggangPointReview).all()
    # A point in the SCADA registry may belong to an unrelated project;
    # never implicitly attribute an unreviewed point to Tanggang.
    points = db.query(ScadaPoint.id).filter(ScadaPoint.deleted == 0).all()
    valid_points = {p.id for p in points}
    equipment = db.query(Equipment.id).filter(Equipment.deleted == 0).all()
    valid_assets = {x.id for x in equipment}
    by_id = {link.id: link for link in links}
    link_assets: dict[int, set[int]] = defaultdict(set)
    link_metrics: dict[int, set[int]] = defaultdict(set)
    for row in assets:
        if row.link_id in by_id:
            link_assets[row.link_id].add(row.asset_id)
    for row in metrics:
        if row.link_id in by_id:
            link_metrics[row.link_id].add(row.point_id)
    by_system_review: dict[str, dict[int, TanggangPointReview]] = defaultdict(dict)
    by_point_review = {}
    for item in reviews:
        if item.point_id not in valid_points:
            continue
        by_point_review[item.point_id] = item
        if item.system_id in SYSTEMS:
            by_system_review[item.system_id][item.point_id] = item
    output = []
    for sid, name in SYSTEMS.items():
        rows = [l for l in links if l.system_id == sid]
        ids = {l.id for l in rows}
        asset_ids = set().union(*(link_assets[x] for x in ids)) if ids else set()
        metric_ids = set().union(*(link_metrics[x] for x in ids)) if ids else set()
        valid_metric_ids = metric_ids & valid_points
        reviewed = by_system_review[sid]
        candidate_ids = valid_metric_ids | set(reviewed)
        document_ids = {
            pid for pid, r in reviewed.items()
            if r.basis_type == REAL_BASIS and bool((r.source_ref or "").strip())
        }
        assumption_ids = {
            pid for pid, r in reviewed.items() if r.basis_type == "ASSUMPTION"
        }
        demo_ids = {
            pid for pid, r in reviewed.items() if r.basis_type == "DEMO_VALUE"
        }
        # Different reviewed system identities may be intentionally shared,
        # so describe this as a review discrepancy, not a site-data conflict.
        conflicts = {
            pid for pid in valid_metric_ids
            if (pid in by_point_review and by_point_review[pid].system_id != sid)
        }
        without_review = {
            pid for pid in valid_metric_ids if pid not in by_point_review
            or by_point_review[pid].basis_type == "UNVERIFIED"
        }
        without_link = set(reviewed) - valid_metric_ids
        mapped_assets = asset_ids & valid_assets
        issues = []
        if not rows:
            issues.append("尚未登记工程对象与系统关联")
        if not asset_ids:
            issues.append("缺少可追溯的设备台账关联")
        if not valid_metric_ids:
            issues.append("缺少该系统已绑定的SCADA测点")
        if not document_ids:
            issues.append("测点尚无逐条登记的上传资料依据")
        if without_review:
            issues.append(f"{len(without_review)}个已关联测点缺少资料核对")
        if without_link:
            issues.append(f"{len(without_link)}个已登记测点尚未绑定工程对象")
        if conflicts:
            issues.append(f"{len(conflicts)}个测点的系统归属与对象关联不一致")
        if asset_ids - mapped_assets:
            issues.append(f"{len(asset_ids - mapped_assets)}个设备关联已失效")
        if metric_ids - valid_metric_ids:
            issues.append(f"{len(metric_ids - valid_metric_ids)}个测点关联已失效")
        output.append({
            "id": sid, "name": name,
            "object_links": len(rows),
            "object_identity_reviewed": sum(1 for x in rows if x.verified),
            "object_source_refs": sum(1 for x in rows if (x.source_ref or "").strip()),
            "linked_facility_ids": sorted({x.facility_id for x in rows}),
            "asset_bound_facility_ids": sorted({
                x.facility_id for x in rows
                if link_assets[x.id] & valid_assets
            }),
            "asset_links": len(mapped_assets),
            "point_links": len(valid_metric_ids),
            "point_candidates": len(candidate_ids),
            "point_document_references": len(document_ids),
            "point_assumptions": len(assumption_ids),
            "point_demo_values": len(demo_ids),
            "point_without_review": len(without_review),
            "point_without_object_link": len(without_link),
            "point_system_discrepancies": len(conflicts),
            "stale_asset_links": len(asset_ids - mapped_assets),
            "stale_point_links": len(metric_ids - valid_metric_ids),
            "issues": issues,
            "field_verified": False,
            "scada_commissioned": False,
            "hydraulic_topology_verified": False,
            "status": "DOCUMENT_PREPARATION_ONLY",
        })
    reviewed_point_ids = set(by_point_review)
    return {
        "stage": "DOCUMENT_BASED_DEMO",
        "basis": "PERSISTED_SOFTWARE_CONFIGURATION",
        "field_verified": False, "scada_commissioned": False,
        "measured_point_count": 0, "systems": output,
        "inventory": {
            "registered_scada_points": len(valid_points),
            "unassigned_scada_points": len(valid_points - reviewed_point_ids),
            "reviewed_scada_points": len(reviewed_point_ids),
            "registered_object_links": len(links),
        },
        "notice": (
            "仅反映已登记的业务系统、工程映射、设备及SCADA点表的资料准备情况；"
            "无法据此判断现场SCADA已连接、通信稳定、仪表已安装或水力拓扑闭环。"
        ),
    }
