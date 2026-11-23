#!/usr/bin/env python3
"""Convert V2.8 CAD endpoint checks to view-only evidence. Never infer a pipe connection."""
import csv
import json
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]/"public/tanggang/cad/l1-v2_8"
SOURCE1="V2.8_端点核查台账.csv"
SOURCE2="V2.8_高疑点位.csv"
OUT="process-endpoint-audit-v2.8.json"
STATUSES={
 "touches_another_visible_candidate":"可见候选端点接触（不等于已核实连通）",
 "unmatched_visible_endpoint":"可见端点未匹配",
 "hidden_source_continuation":"隐藏源图元延续（待核）",
 "near_visible_gap":"可见近距间隙（待核）",
}
def read(name):
 with (ROOT/name).open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
def f(v):
 try:return round(float(v),6) if v and v.strip() else None
 except ValueError:return None
def main():
 rows=read(SOURCE1);risks=read(SOURCE2)
 layers={}
 for item in rows:
  layer=item["sourceLayer"];status=item["status"]
  if status not in STATUSES:raise ValueError(status)
  group=layers.setdefault(layer,{"layer":layer,"endpointCount":0,"statuses":{},"unresolvedCount":0,"suspiciousCount":0,"suspiciousHighCount":0,"endpoints":[],"suspicions":[]})
  group["endpointCount"]+=1
  group["statuses"][status]=group["statuses"].get(status,0)+1
  if status!="touches_another_visible_candidate":group["unresolvedCount"]+=1
  group["endpoints"].append({
   "handle":item["sourceHandle"],"side":item["endpointSide"],
   "status":status,"sceneXZ":item["sceneXZ"],"sourceCADXY":item["sourceCADXY"],
   "closestHandle":item["closestApprovedHandle"] or None,
   "closestDistance":f(item["closestApprovedDistance"]),
   "hiddenHandle":item["neighborHiddenHandle"] or None,
   "hiddenStatus":item["neighborHiddenStatus"] or None,
   "gapHandle":item["gapToHandle"] or None,"gapDistance":f(item["gapDistance"]),
  })
 for item in risks:
  layer=item["图层"]
  if layer not in layers:raise ValueError("Missing layer "+layer)
  group=layers[layer]
  group["suspiciousCount"]+=1
  if item["严重级"]=="high":group["suspiciousHighCount"]+=1
  group["suspicions"].append({
   "type":item["类型"],"primaryHandle":item["主源Handle"],
   "neighborHandle":item["邻近源Handle"] or None,"sceneX":f(item["Scene_X"]),
   "sceneZ":f(item["Scene_Z"]),"distance":f(item["间距_场景单位"]),
   "severity":item["严重级"],"note":item["说明"],
  })
 payload={"schemaVersion":1,"sourceVersion":"L1 V2.8",
  "scope":"Source CAD endpoints only; NOT verified physical hydraulic topology",
  "files":[SOURCE1,SOURCE2],"statusLabels":STATUSES,
  "total":{"endpoints":len(rows),
   "candidateContacts":sum(x["statuses"].get("touches_another_visible_candidate",0) for x in layers.values()),
   "unresolved":sum(x["unresolvedCount"] for x in layers.values()),
   "suspicions":len(risks),
   "highSuspicions":sum(x["suspiciousHighCount"] for x in layers.values())},
  "layers":dict(sorted(layers.items()))}
 if len(rows)!=1098 or len(risks)!=129:raise ValueError("V2.8 CSV changed; require review")
 (ROOT/OUT).write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
 print("Built",OUT,len(layers),"layers",len(rows),"endpoints",len(risks),"suspicions")
if __name__=="__main__":main()
