#!/usr/bin/env python3
"""Derive a *read-only* compact CAD relationship index from the existing V2
CAD master manifest. Never invents geometry, devices, water-level data, or
connection verification. Outputs only existing field values and source IDs.
"""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[2]
src=ROOT/'frontend/public/tanggang/audit/cad-review/v2/manifest-v2.json'
out=ROOT/'frontend/src/modules/tanggang/business/cadWaterNetwork.generated.json'
data=json.loads(src.read_text('utf-8'))
rels=data['designRelationships']
assert len(rels)==25
anchors={}
for obj in data['objects']:
    if obj['objectId'].startswith('TG-CAD-'):
        anchors[obj['objectId']]={
            'id':obj['objectId'],'name':obj['name'],
            'sourceHandle':obj.get('sourceHandle'),
            'sourceLayer':obj.get('sourceLayer'),
            'status':obj.get('status'),
        }
payload={
    'source':'frontend/public/tanggang/audit/cad-review/v2/manifest-v2.json',
    'sourceVersion':data['version'],
    'sourceDWG':data['sourceDWG'],
    'sourceSHA256':data['sourceSHA256'],
    'allConnectionsVerified':data['controls']['allConnectionsVerified'],
    'designRelationships':rels,
    'cadAnchors':anchors,
}
out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('CAD_V2_INDEX',len(rels),'relationships',len(anchors),'CAD source anchors',out)
