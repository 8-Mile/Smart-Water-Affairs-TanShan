#!/usr/bin/env python3
"""Pin a backend-safe M19 candidate-only index from versioned CAD evidence.

- Parses declared template connections in processFlow.ts; does NOT infer pipes.
- Whitelists only layers that match the medium and physical purpose of each link.
- A matched Handle is a *candidate source segment*, NEVER a confirmed connection.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

FRONT = Path(__file__).resolve().parents[1]
ROOT = FRONT.parents[0]
PROCESSES = FRONT / "src/modules/tanggang/business/processFlow.ts"
CAD = FRONT / "public/tanggang/cad/l1-v2_8/process-endpoint-audit-v2.8.json"
SYSTEMS = FRONT / "public/tanggang/cad/l1-v2_5/systems-v2.5.json"
BACKEND = ROOT / "backend/app/resources/tanggang_cad_connection_candidates.json"
ORDER = ["middle", "mineral", "rain", "pool", "domestic"]
# Conservative, engineer-review-only candidate scope. All other links stay unmapped.
# Signal lines are excluded; industrial telemetry/control does not equal a CAD water pipe.
LAYER_POLICY = {
    "middle": {
        **{f"design-{i:02d}": "$管综-中压除尘" for i in range(1, 7)}
    },
    "mineral": {
        "design-08": "$管综-污泥管",
        "design-09": "$管综-污泥管",
    },
    "rain": {
        **{f"design-{i:02d}": "$管综-雨水" for i in range(1, 10)}
    },
    "pool": {
        "design-01": "$管综-市政中水",
        "design-02": "$管综-市政自来水 生活给水",
    },
    "domestic": {
        **{f"design-{i:02d}": "$管综-生活污水" for i in range(1, 5)}
    },
}


def extract_flows() -> dict:
    source = PROCESSES.read_text(encoding="utf-8")
    start = source.index("const FLOWS:")
    end = source.index("const SYMBOL_SIZES:", start)
    section = source[start:end]
    blocks = {}
    for i, sid in enumerate(ORDER):
        pattern = re.compile(r"^  " + sid + r":\{\s*$", re.M)
        m = pattern.search(section)
        if not m:
            raise ValueError("Missing source flow system: " + sid)
        end_boundary = re.search(r"^  (middle|mineral|rain|pool|domestic):\{\s*$",
                                 section[m.end():], re.M)
        stop = m.end() + end_boundary.start() if end_boundary else len(section)
        block = section[m.end():stop]
        rows = re.findall(
            r"l\('([^']+)','([^']+)','([^']+)','([^']+)'(?:,'([^']+)')?\)",
            block,
        )
        if not rows:
            raise ValueError("No typed flow links: " + sid)
        if block.count("\n      l(") != len(rows):
            raise ValueError("Unparsed or revised link source in " + sid)
        blocks[sid] = rows
    return blocks


def main():
    data = json.loads(CAD.read_text(encoding="utf-8"))
    v25 = json.loads(SYSTEMS.read_text(encoding="utf-8"))
    source = {x["id"]: x for x in v25["systems"]}
    flows = extract_flows()
    handles = {}
    for layer, record in data["layers"].items():
        # A CAD Handle can yield multiple endpoint rows; stable unique set.
        handles[layer] = sorted(set(x["handle"].upper() for x in record["endpoints"]))
    manifest = {
        "schema_version": 1, "source_version": "L1 V2.8",
        "evidence_file": "process-endpoint-audit-v2.8.json",
        "scope": "Unverified CAD source-handle candidate inventory; no physical linkage asserted",
        "handles_by_layer": handles,
        "systems": {},
    }
    for sid, links in flows.items():
        layers = source[sid]["focusPipeLayers"]
        policy = LAYER_POLICY[sid]
        if not set(policy.keys()).issubset({f"design-{i:02d}" for i in range(1, len(links) + 1)}):
            raise ValueError("Policy refers to non-existent flow in " + sid)
        connection_rows = []
        for index, (source_id, target_id, medium, relation, label) in enumerate(links, 1):
            conn_id = f"design-{index:02d}"
            layer = policy.get(conn_id)
            if layer and layer not in layers:
                raise ValueError("Policy layer missing from V2.5 scope: " + sid + "/" + layer)
            if layer and medium not in ("water", "sludge"):
                raise ValueError("Non-physical medium cannot claim CAD piping: " + conn_id)
            connection_rows.append({
                "connection_id": conn_id,
                "source_node_id": source_id if source_id.startswith("ref-") else "cad-" + source_id,
                "target_node_id": target_id if target_id.startswith("ref-") else "cad-" + target_id,
                "medium": medium, "relation": relation, "label": label,
                "candidate_layer": layer,
            })
        manifest["systems"][sid] = {
            "name": source[sid]["name"],
            "focus_layers": layers,
            "connections": connection_rows,
            "candidate_scope_count": sum(x["candidate_layer"] is not None for x in connection_rows),
        }
    BACKEND.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("M19 INDEX:", BACKEND, "links", sum(len(x["connections"]) for x in manifest["systems"].values()),
          "eligible", sum(x["candidate_scope_count"] for x in manifest["systems"].values()),
          "CAD Handle tokens", sum(len(v) for v in handles.values()))


if __name__ == "__main__":
    main()
