import test from "node:test";
import assert from "node:assert/strict";
import {buildSeed} from "./seed";
import {evaluateKnowledge,excerptFingerprint,parseKnowledgeRequest,readKnowledgeDrafts,reviewKnowledgeDraft,
  saveKnowledgeDraft,inspectKnowledgeCitations,KNOWLEDGE_DRAFT_KEY,type KnowledgeContext} from "./knowledge";
import type {DocumentRef} from "./types";

const SEED=buildSeed("SCN-NORMAL");
const input=(symptom="振动异常",assetId="asset-p002"):KnowledgeContext=>({
  query:{assetId,symptom},
  assets:SEED.assets,documents:SEED.documents,removedDocumentIds:[],
  inspections:SEED.inspections,maintenance:SEED.maintenance,
  workorders:SEED.workorders,alarms:SEED.alarms,
  seedInspectionIds:SEED.inspections.map(x=>x.id),
  seedMaintenanceIds:SEED.maintenance.map(x=>x.id),
  seedWorkorderIds:SEED.workorders.map(x=>x.id),
  seedAlarmIds:SEED.alarms.map(x=>x.id),
});
function memory(){
  const values=new Map<string,string>();
  return {values,
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,val:string)=>{values.set(key,val);}};
}

test("K1 P002振动检索使用三个已审核MOCK摘录，保留原档案ID版本章节，不引用未审核图纸",()=>{
  const result=evaluateKnowledge(input());
  assert.equal(result.asset?.code,"P-002");
  assert.equal(result.category,"vibration");
  assert.equal(result.documents.length,3);
  assert.deepEqual(result.documents.map(x=>x.id).sort(),
    ["DOC-P002-MANUAL","DOC-P002-INSPECT","DOC-P002-CASE"].sort());
  assert.equal(result.excluded.some(x=>x.id==="DOC-P002-DRAWING"),true);
  assert.ok(result.documents.every(x=>x.citation.includes(x.version)&&x.citation.includes(x.section)));
  assert.ok(result.documents.every(x=>x.path.startsWith("/archives?docId=")&&x.source==="demo"));
  assert.ok(result.documents.some(x=>x.excerpt.includes("振动")));
  assert.equal(result.confidence,"reference_only");
});

test("K2 真实关联压力异常不能偷用振动说明书作为原因依据",()=>{
  const r=evaluateKnowledge(input("出口压力偏低"));
  assert.equal(r.category,"pressure");
  assert.equal(r.documents.length,0);
  assert.equal(r.confidence,"insufficient");
  assert.equal(r.checkSuggestions.length,0);
  assert.ok(r.warnings.some(x=>x.includes("禁止生成故障原因")));
});

test("K3 射雾器末端压力异常缺适用文档必须降级，不能拿P002泵档案作为跨系统依据",()=>{
  const seed=buildSeed("SCN-PUMP-FAULT");
  const c=input("射雾器末端压力低","asset-sp004");
  c.assets=seed.assets;c.alarms=seed.alarms;c.query.alarmId="ALM-SP004-01";
  const r=evaluateKnowledge(c);
  assert.equal(r.documents.length,0);
  assert.equal(r.checkSuggestions.length,0);
  assert.equal(r.alarm?.id,"ALM-SP004-01");
  assert.ok(r.related.some(x=>x.kind==="alarm"&&x.refId==="ALM-SP004-01"));
  assert.ok(r.warnings.some(x=>x.includes("依据不足")));
});

test("K4 设备ID+告警ID不匹配时不引用该告警，缺失告警给出明确说明",()=>{
  const c=input("振动异常");
  c.query.alarmId="ALM-SP004-01";
  const seed=buildSeed("SCN-PUMP-FAULT");c.alarms=seed.alarms;
  const r=evaluateKnowledge(c);
  assert.equal(r.alarm,null);
  assert.ok(r.warnings.some(x=>x.includes("不匹配")));
  assert.ok(!r.related.some(x=>x.refId==="ALM-SP004-01"));
});

test("K5 未审核的用户资料不可检索，经模拟审核+可定位章节后才作为候选摘录",()=>{
  const c=input("振动异常");
  const imported:DocumentRef={
    id:"DOC-USER-001",title:"一号泵振动检修规程.md",version:"导入-1",
    assetIds:["asset-p002"],kind:"manual",reviewed:false,source:"user-upload",
    sourceLabel:"用户导入",updatedAt:"2026-11-16T08:00:00Z",
    contentExcerpt:"设备振动异常时先核对轴承与联轴器对中，再根据厂家要求核查",
    lineOrSection:"本地文件导入（未解析章节）",
  };
  c.documents=[imported];
  let r=evaluateKnowledge(c);
  assert.equal(r.documents.length,0);
  assert.equal(r.excluded[0].reason,"文档未经审核，不可作为诊断引用");
  c.documents=[{...imported,reviewed:true,version:"V2.1",lineOrSection:"第2章 / 2.4节",
    reviewedBy:"manager",reviewedAt:"2026-11-16T10:00:00Z"}];
  r=evaluateKnowledge(c);
  assert.equal(r.documents.length,1);
  assert.equal(r.documents[0].citation,"[DOC-USER-001 · V2.1 · 第2章 / 2.4节]");
  assert.equal(r.documents[0].source,"user-upload");
});

test("K6 无内容、缺版本、无章节、不可用文档不允许被证据列表收录",()=>{
  const c=input();
  c.documents=[
    {...SEED.documents[0],id:"X1",contentExcerpt:undefined},
    {...SEED.documents[0],id:"X2",version:""},
    {...SEED.documents[0],id:"X3",lineOrSection:""},
    {...SEED.documents[0],id:"X4",unavailable:true},
  ];
  const r=evaluateKnowledge(c);
  assert.equal(r.documents.length,0);
  assert.equal(r.excluded.length,4);
  assert.ok(r.excluded.some(x=>x.reason.includes("原文")));
  assert.ok(r.excluded.some(x=>x.reason.includes("版本")));
  assert.ok(r.excluded.some(x=>x.reason.includes("章节")));
});

test("K7 资料被标记为删除时，已审核标志也不能让原文重新进入证据链",()=>{
  const c=input();c.removedDocumentIds=["DOC-P002-MANUAL"];
  const r=evaluateKnowledge(c);
  assert.ok(!r.documents.some(x=>x.id==="DOC-P002-MANUAL"));
  assert.ok(r.excluded.some(x=>x.id==="DOC-P002-MANUAL"));
});

test("K8 历史巡检、维修、已验收工单分别保留原ID，且不混入未验收工单",()=>{
  const r=evaluateKnowledge(input());
  assert.ok(r.related.some(x=>x.refId==="INS-P002-01"&&x.kind==="inspection"));
  assert.ok(r.related.some(x=>x.refId==="MNT-P002-01"&&x.kind==="maintenance"));
  assert.ok(r.related.some(x=>x.refId==="wo-2026-011"&&x.kind==="workorder"));
  assert.ok(!r.related.some(x=>x.refId==="wo-2026-014"&&x.kind==="workorder"));
  assert.ok(r.related.some(x=>x.source==="MOCK"));
  assert.ok(r.related.every(x=>x.path.startsWith("/")));
});

test("K9 未指定可识别的异常类别时可浏览档案，但不生成检查建议或“有依据诊断”",()=>{
  const r=evaluateKnowledge(input("你好，请帮忙看看资料"));
  assert.equal(r.category,"general");
  assert.equal(r.checkSuggestions.length,0);
  assert.equal(r.confidence,"insufficient");
});

test("K10 证据核验草稿只有人工显式确认才能保存，角色权限在纯逻辑层校验",()=>{
  const s=memory(),r=evaluateKnowledge(input());
  assert.equal(readKnowledgeDrafts(s).length,0);
  assert.throws(()=>saveKnowledgeDraft(r,"SCN-NORMAL","viewer",s),/无权/);
  const draft=saveKnowledgeDraft(r,"SCN-NORMAL","duty",s);
  assert.equal(draft.status,"pending_review");
  assert.equal(draft.source,"MOCK_CONTEXT");
  assert.equal(draft.evidence.length,3);
  assert.equal(readKnowledgeDrafts(s,"SCN-NORMAL").length,1);
  assert.equal(readKnowledgeDrafts(s,"SCN-PUMP-FAULT").length,0);
  assert.ok(s.getItem(KNOWLEDGE_DRAFT_KEY)?.includes("DOC-P002-MANUAL"));
});

test("K11 manager必须附审核意见，完成DEMO审核，值班员无权自行审核",()=>{
  const s=memory(),doc=saveKnowledgeDraft(evaluateKnowledge(input()),"SCN-NORMAL","duty",s);
  assert.throws(()=>reviewKnowledgeDraft(doc.id,"duty","确认可用的资料已经核对",s,SEED.documents),/无权/);
  assert.throws(()=>reviewKnowledgeDraft(doc.id,"manager","短",s,SEED.documents),/至少8字/);
  const reviewed=reviewKnowledgeDraft(doc.id,"manager","已核验演示章节，但不代表现场设备诊断",s,SEED.documents);
  assert.equal(reviewed.status,"reviewed_demo");
  assert.equal(reviewed.reviewedBy,"manager");
  assert.throws(()=>reviewKnowledgeDraft(doc.id,"manager","再次审核不被允许",s,SEED.documents),/已审核/);
});

test("K12 草稿审核之前任何原文版本/章节/内容变更或被删除都必须拒绝旧引用",()=>{
  for(const changed of [
    SEED.documents.filter(d=>d.id!=="DOC-P002-MANUAL"),
    SEED.documents.map(d=>d.id==="DOC-P002-MANUAL"?{...d,version:"V2.0"}:d),
    SEED.documents.map(d=>d.id==="DOC-P002-MANUAL"?{...d,contentExcerpt:"内容已经变更但版号未修改"}:d),
    SEED.documents.map(d=>d.id==="DOC-P002-MANUAL"?{...d,lineOrSection:"第99页"}:d),
  ]){
    const s=memory(),draft=saveKnowledgeDraft(evaluateKnowledge(input()),"SCN-NORMAL","duty",s);
    assert.throws(()=>reviewKnowledgeDraft(draft.id,"manager","已确认现场证据符合要求",s,changed),/版本变化|已删除|失效/);
  }
});

test("K13 已归档的原工单和可定位资料只作为核查方向，建议中不能声称确认根因或设备寿命",()=>{
  const result=evaluateKnowledge(input());
  assert.ok(result.checkSuggestions.length>0);
  assert.ok(result.checkSuggestions.every(x=>x.supportingDocumentIds.length>0));
  assert.ok(result.checkSuggestions.every(x=>!(/已经确认|故障概率|剩余寿命/.test(x.text))));
  assert.ok(result.warnings.some(x=>x.includes("不自动")));
});

test("K14 没有匹配文档的设备可保存缺口说明草稿，但绝不夹带其他设备引用",()=>{
  const s=memory(),r=evaluateKnowledge(input("压力偏低","asset-sp004"));
  assert.equal(r.documents.length,0);
  const draft=saveKnowledgeDraft(r,"SCN-NORMAL","engineer",s);
  assert.equal(draft.evidence.length,0);
  assert.match(draft.description,/依据不足/);
  assert.equal(draft.query.assetId,"asset-sp004");
});

test("K15 存储损坏恢复为空，摘录指纹变化可检测，防止无声篡改引用",()=>{
  const s=memory();s.setItem(KNOWLEDGE_DRAFT_KEY,"invalid-json");
  assert.deepEqual(readKnowledgeDrafts(s),[]);
  assert.notEqual(excerptFingerprint("振动正常"),excerptFingerprint("振动异常"));
});


test("K16 自然语言只在明确检索来源时识别，设备编号P002/P-002映射同一原台账",()=>{
  const r=parseKnowledgeRequest("查找P-002振动异常的诊断依据",SEED.assets);
  assert.equal(r?.query?.assetId,"asset-p002");
  assert.equal(r?.query?.symptom,"振动异常");
  assert.equal(parseKnowledgeRequest("查找P002轴承温度的说明书",SEED.assets)?.query?.assetId,"asset-p002");
  assert.equal(parseKnowledgeRequest("诊断P-002的健康趋势",SEED.assets),null);
  assert.equal(parseKnowledgeRequest("比较雨前调蓄方案",SEED.assets),null);
});
test("K17 没有明确设备与上下文时拒绝猜测；设备上下文可从业务页面继承",()=>{
  assert.match(parseKnowledgeRequest("查找振动资料的诊断依据",SEED.assets)?.issue??"",/指定设备/);
  assert.equal(parseKnowledgeRequest("查找振动资料的诊断依据",SEED.assets,"asset-p002")?.query?.assetId,"asset-p002");
  assert.match(parseKnowledgeRequest("查找Z-999振动诊断依据",SEED.assets)?.issue??"",/不存在/);
});
test("K18 现场控制夹带知识检索也不能作为知识工具执行",()=>{
  assert.match(parseKnowledgeRequest("启动P-002并查找振动诊断依据",SEED.assets)?.issue??"",/不执行现场控制/);
  assert.equal(parseKnowledgeRequest("查找P-002压力异常的诊断依据",SEED.assets)?.query?.symptom,"压力异常");
});

test("K19 显式错误或退役设备不得利用同ID残留文档生成可信引用",()=>{
  const c=input("振动异常","asset-no-such");
  c.documents=[{...SEED.documents[0],id:"DOC-ORPHAN",assetIds:["asset-no-such"]}];
  const r=evaluateKnowledge(c);
  assert.equal(r.asset,null);
  assert.equal(r.documents.length,0);
  assert.equal(r.confidence,"insufficient");
  assert.equal(r.checkSuggestions.length,0);
  assert.ok(r.warnings.some(x=>x.includes("不存在或已退役")));
});

test("K20 已审核历史报告原文删除后也应立即标注引用失效，保留原审核记录",()=>{
  const st=memory();
  const original=saveKnowledgeDraft(evaluateKnowledge(input()),"SCN-NORMAL","duty",st);
  const reviewed=reviewKnowledgeDraft(original.id,"manager","仅演示审核并确认引用章节来源",st,SEED.documents);
  const current=inspectKnowledgeCitations(reviewed,SEED.documents);
  assert.equal(current.status,"valid_reference");
  const absent=inspectKnowledgeCitations(reviewed,SEED.documents.filter(x=>x.id!=="DOC-P002-MANUAL"));
  assert.equal(absent.status,"citation_stale");
  assert.ok(absent.missing.some(x=>x.includes("DOC-P002-MANUAL")&&x.includes("删除")));
  const stored=readKnowledgeDrafts(st)[0];
  assert.equal(stored.status,"reviewed_demo");
  assert.equal(stored.reviewedBy,"manager");
});

test("K21 即使文档原文、版本、章节未变，撤销其目标设备适用范围后仍必须阻止旧引用",()=>{
  const st=memory();
  const original=saveKnowledgeDraft(evaluateKnowledge(input()),"SCN-NORMAL","duty",st);
  const moved=SEED.documents.map(x=>x.id==="DOC-P002-MANUAL"?{...x,assetIds:["asset-p001"]}:x);
  const report=inspectKnowledgeCitations(original,moved);
  assert.equal(report.status,"citation_stale");
  assert.ok(report.missing.some(x=>x.includes("不再适用于目标设备")));
  assert.throws(()=>reviewKnowledgeDraft(original.id,"manager","已经重新核查原始设备适用范围",st,moved),/失效/);
});
test("K22 历史资料正文变更但沿用旧版号，仍不能复用已审核结论",()=>{
  const st=memory();
  const draft=saveKnowledgeDraft(evaluateKnowledge(input()),"SCN-NORMAL","duty",st);
  const changed=SEED.documents.map(x=>x.id==="DOC-P002-MANUAL"?{...x,contentExcerpt:"已完全替换的原文摘录，旧检查要求不能复用"}:x);
  assert.equal(inspectKnowledgeCitations(draft,changed).status,"citation_stale");
  assert.throws(()=>reviewKnowledgeDraft(draft.id,"manager","不得使用旧版核查要求",st,changed),/失效/);
});
test("K23 当前仅为资料缺口的演示核验草稿不得显示为证据有效",()=>{
  const st=memory();
  const draft=saveKnowledgeDraft(evaluateKnowledge(input("出口压力偏低")),"SCN-NORMAL","duty",st);
  assert.equal(draft.evidence.length,0);
  assert.equal(inspectKnowledgeCitations(draft,SEED.documents).status,"evidence_missing");
  const reviewed=reviewKnowledgeDraft(draft.id,"manager","仅审核资料缺口说明，没有实际可用原文",st,SEED.documents);
  assert.equal(inspectKnowledgeCitations(reviewed,SEED.documents).status,"evidence_missing");
  assert.equal(reviewed.status,"reviewed_demo");
});
test("K24 文档审核撤销、用户来源改变和显式删除标记都使引用失效",()=>{
  const draft=saveKnowledgeDraft(evaluateKnowledge(input()),"SCN-NORMAL","duty",memory());
  const unreviewed=SEED.documents.map(x=>x.id==="DOC-P002-MANUAL"?{...x,reviewed:false}:x);
  assert.equal(inspectKnowledgeCitations(draft,unreviewed).status,"citation_stale");
  const changedSource=SEED.documents.map(x=>x.id==="DOC-P002-MANUAL"?{...x,source:"user-upload" as const}:x);
  assert.equal(inspectKnowledgeCitations(draft,changedSource).status,"citation_stale");
  assert.equal(inspectKnowledgeCitations(draft,SEED.documents,["DOC-P002-MANUAL"]).status,"citation_stale");
});

test("K25 只有轴承/电机/出水等泛词的资料不可冒充振动、电流或供压专科证据",()=>{
  const cases=[
    {id:"DOC-VIBRATION-WRONG",symptom:"振动异常",text:"轴承装配尺寸及外形轮廓示意，本页未给出其他检查数据。"},
    {id:"DOC-PRESSURE-WRONG",symptom:"出口压力低",text:"出水管的颜色标记和管廊基础尺寸说明，仅作管道布置参考。"},
    {id:"DOC-CURRENT-WRONG",symptom:"电流偏高",text:"电机基础安装孔距及外壳结构说明，仅作为外观信息。"},
  ];
  for(const item of cases){
    const c=input(item.symptom);
    c.documents=[{
      ...SEED.documents[0],id:item.id,
      title:"泛相关但不能引用的演示资料",contentExcerpt:item.text,
    }];
    const result=evaluateKnowledge(c);
    assert.equal(result.documents.length,0,item.id+" must not be cited");
    assert.equal(result.confidence,"insufficient");
    assert.equal(result.checkSuggestions.length,0);
  }
});
