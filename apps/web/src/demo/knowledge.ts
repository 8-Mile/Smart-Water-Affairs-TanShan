/**
 * 专业知识与可追溯诊断 V1
 * 检索现有业务档案，不是网络搜索/向量RAG；只引用已审核、可读取且与设备匹配的摘录。
 * 绝不将DEMO文档的“已审核”夸大为真实工程审查；不自动推断根因、批准作业或控制设备。
 */
import { assertCan } from "./permissions";
import type {
  Alarm, Asset, DocumentRef, InspectionRecord, MaintenanceRecord, Role, WorkOrder,
} from "./types";

export const KNOWLEDGE_DRAFT_KEY = "tanggang-knowledge-diagnosis-v1";
export type KnowledgeCategory = "vibration"|"temperature"|"current"|"pressure"|"flow"|"leakage"|"general";
const CATEGORY_WORDS:Record<KnowledgeCategory,readonly string[]> = {
  // 不用“轴承/电机/出水”等泛词作为单独证据，这些术语无法确定异常机理。
  vibration:["振动","震动","异响","对中","地脚"],
  temperature:["温度","过热","发热","升温"],
  current:["电流","过载","功率"],
  pressure:["压力","低压","欠压","压降","供压"],
  flow:["流量","供水量","流速","缺水","供水不足"],
  leakage:["泄漏","渗漏","密封","漏水"],
  general:[],
};
const NAVIGABLE_KINDS = new Set<DocumentRef["kind"]>(["manual","procedure","inspection-standard","case","drawing","other","certificate"]);

export interface KnowledgeQuery {
  assetId: string;
  symptom: string;
  alarmId?: string;
}
export interface ParsedKnowledgeRequest {
  query:KnowledgeQuery|null;
  issue?:string;
}
/**
 * 狭义规则识别：明确要求查找依据才进入知识库，不能拦截旧健康诊断或设备操作。
 * 无设备ID时拒绝猜测；如由设备页面打开，可继承其显式设备上下文。
 */
export function parseKnowledgeRequest(
  prompt:string,assets:Asset[],contextAssetId?:string,
):ParsedKnowledgeRequest|null {
  const value=prompt.trim();
  if(!/(知识库|诊断依据|知识依据|证据来源|查找.{0,10}(?:资料|档案|手册|说明书|规程)|检索.{0,10}(?:资料|档案|说明书)|原文依据|手册依据|资料检索)/.test(value))return null;
  if(/(启动|停泵|开阀|关阀|控制设备|下发控制|自动派工)/.test(value))
    return {query:null,issue:"知识检索只能读取来源，不执行现场控制或派工"};
  const mentionedCode=/(?:^|[^A-Za-z0-9])([A-Z]{1,3})-?(\d{3})(?!\d)/i.exec(value);
  const code=mentionedCode ? mentionedCode[1].toUpperCase()+"-"+mentionedCode[2] : "";
  const explicit=code?assets.find(x=>x.code.toUpperCase()===code&&!x.archived):undefined;
  if(code&&!explicit)return {query:null,issue:"指定设备 "+code+" 不存在于当前场景"};
  const asset=explicit??assets.find(x=>x.id===contextAssetId&&!x.archived);
  if(!asset)return {query:null,issue:"请先指定设备编号，例如：查找P-002振动异常的诊断依据"};
  const key=/(振动|震动|异响|对中|轴承温度|温度|电流|压力|流量|渗漏|泄漏|密封)/.exec(value)?.[0];
  const symptom=key?key+"异常":"设备资料综合浏览";
  return {query:{assetId:asset.id,symptom}};
}

export interface KnowledgeDocumentHit {
  id:string;title:string;version:string;kind:DocumentRef["kind"];
  updatedAt:string;sourceLabel:string;source:"demo"|"user-upload";
  section:string; excerpt:string;matchedTerms:string[];
  score:number;
  citation:string;
  fingerprint:string;
  path:string;
  isDemo:boolean;
}
export interface ExcludedKnowledgeDocument {
  id:string;title:string;reason:string;
}
export interface KnowledgeRecord {
  refId:string; kind:"inspection"|"maintenance"|"workorder"|"alarm";
  title:string;at:string;text:string;source:"MOCK"|"USER_ENTRY";
  path:string;
}
export interface KnowledgeResult {
  query:KnowledgeQuery;
  category:KnowledgeCategory;
  asset:Asset|null;
  alarm:Alarm|null;
  documents:KnowledgeDocumentHit[];
  excluded:ExcludedKnowledgeDocument[];
  related:KnowledgeRecord[];
  findings:string[];
  checkSuggestions:{text:string;supportingDocumentIds:string[]}[];
  confidence:"reference_only"|"insufficient";
  warnings:string[];
}
export interface KnowledgeContext {
  query:KnowledgeQuery;
  assets:Asset[];
  documents:DocumentRef[];
  removedDocumentIds:string[];
  inspections:InspectionRecord[];
  maintenance:MaintenanceRecord[];
  workorders:WorkOrder[];
  alarms:Alarm[];
  seedInspectionIds?:string[];
  seedMaintenanceIds?:string[];
  seedWorkorderIds?:string[];
  seedAlarmIds?:string[];
}
export interface KnowledgeDraft {
  id:string;scenarioId:string;assetId:string;
  source:"MOCK_CONTEXT";
  status:"pending_review"|"reviewed_demo";
  query:KnowledgeQuery;
  category:KnowledgeCategory;
  createdAt:string;createdBy:Role;
  title:string;
  description:string;
  evidence:Pick<KnowledgeDocumentHit,"id"|"version"|"section"|"citation"|"fingerprint"|"source"|"isDemo">[];
  recordRefs:string[];
  warnings:string[];
  reviewedAt?:string;reviewedBy?:Role;reviewNote?:string;
}
export interface KnowledgeStorage {
  getItem(key:string):string|null;setItem(key:string,value:string):void;
}
/** Lightweight change token for excerpt equality; NOT a cryptographic signature. */
export function excerptFingerprint(value:string):string {
  let hash=2166136261;
  for(let i=0;i<value.length;i++){
    hash^=value.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(16).padStart(8,"0");
}
function normalized(value:string):string{
  return value.toLowerCase().replace(/\s+/g," ").trim().slice(0,200);
}
function categoryOf(text:string):KnowledgeCategory{
  // Category detection favors specific incident symptoms; does not invent a topic from asset.
  if(/压力|低压|欠压|压降|供压/.test(text))return "pressure";
  if(/流量|供水不足|缺水/.test(text))return "flow";
  if(/振动|震动|异响|对中|地脚/.test(text))return "vibration";
  if(/温度|过热|发热|升温/.test(text))return "temperature";
  if(/电流|过载|电机/.test(text))return "current";
  if(/泄漏|渗漏|密封|漏水/.test(text))return "leakage";
  return "general";
}
function rankMatched(text:string,category:KnowledgeCategory):string[]{
  const words=CATEGORY_WORDS[category];
  return words.filter(w=>text.includes(w));
}
function excerptAt(text:string,words:string[]):string{
  const compact=text.replace(/\s+/g," ").trim();
  if(!compact)return "";
  const first=words.map(t=>compact.indexOf(t)).filter(i=>i>=0).sort((a,b)=>a-b)[0];
  if(first===undefined) return compact.slice(0,180);
  // Keep the literal, directly searchable source excerpt, not a model-generated rewrite.
  const start=Math.max(0,first-55),end=Math.min(compact.length,first+125);
  return (start?"…":"")+compact.slice(start,end)+(end<compact.length?"…":"");
}
function reviewDocument(doc:DocumentRef,removed:Set<string>):string|null{
  if(removed.has(doc.id)||doc.unavailable)return "原档案引用已删除或内容不可用";
  if(!doc.reviewed)return "文档未经审核，不可作为诊断引用";
  if(!NAVIGABLE_KINDS.has(doc.kind))return "文件类别不支持诊断引用";
  if(!doc.contentExcerpt?.trim())return "未读取可核查原文，只有文件元数据或摘要";
  if(!doc.version.trim())return "未登记文档版本";
  if(!doc.lineOrSection?.trim())return "缺少可定位章节或位置";
  return null;
}
function isPresent(text:string):boolean{return normalized(text).length>0;}
export function evaluateKnowledge(context:KnowledgeContext):KnowledgeResult{
  const {query}=context;
  const asset=context.assets.find(a=>a.id===query.assetId&&!a.archived)??null;
  const alarm=query.alarmId
    ? context.alarms.find(a=>a.id===query.alarmId&&a.assetId===query.assetId)??null:null;
  const topic=normalized(query.symptom||alarm?.title||"");
  const category=categoryOf(topic || alarm?.title || "");
  const removed=new Set(context.removedDocumentIds);
  const documents:KnowledgeDocumentHit[]=[],excluded:ExcludedKnowledgeDocument[]=[];
  const warnings=[
    "检索仅针对当前设备绑定的档案摘录，非全文语义检索；超过256KB的本地文本、PDF/DOCX尚无全文索引。",
    "DEMO中的文档已审核仅表示演示数据标志，不等于厂家文件或现场技术负责人正式批准。",
    "相似的维修案例与时间重叠不能证明本次故障根因；不自动判定原因，建议均需人工核查，不启停设备。",
  ];
  if(!asset)warnings.push("设备不存在或已退役，不能产生诊断结论。");
  if(query.alarmId&&!alarm)warnings.push("事件编号未找到或与目标设备不匹配，不能引用该告警。");
  const categoryTerms=CATEGORY_WORDS[category];
  for(const doc of (asset?context.documents.filter(d=>d.assetIds.includes(asset.id)):[])){
    const reject=reviewDocument(doc,removed);
    if(reject){excluded.push({id:doc.id,title:doc.title,reason:reject});continue;}
    // Only actual excerpt content can provide subject evidence. Title/summary alone are not enough.
    const excerpt=doc.contentExcerpt??"";
    const matching=category==="general" ? []:rankMatched(excerpt,category);
    if(category!=="general"&&!matching.length)continue;
    if(category==="general"&&!isPresent(query.symptom))continue;
    // For an unspecific general query, list the documents for browsing, not a diagnosis.
    const exact=categoryTerms.filter(w=>topic.includes(w)&&excerpt.includes(w));
    const score=(exact.length*10)+(matching.length*3)+(doc.kind==="manual"||doc.kind==="procedure"?2:0);
    documents.push({
      id:doc.id,title:doc.title,version:doc.version,kind:doc.kind,
      source:doc.source,sourceLabel:doc.sourceLabel,
      updatedAt:doc.updatedAt,section:doc.lineOrSection??"",
      excerpt:excerptAt(excerpt,matching),
      matchedTerms:matching,score,
      citation:`[${doc.id} · ${doc.version} · ${doc.lineOrSection}]`,
      fingerprint:excerptFingerprint(excerpt),
      path:"/archives?docId="+encodeURIComponent(doc.id),isDemo:doc.source==="demo",
    });
  }
  documents.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const related:KnowledgeRecord[]=[];
  if(asset){
    const sample=(id:string|undefined,seeds:string[]|undefined):"MOCK"|"USER_ENTRY"=>
      id&&seeds?.includes(id)?"MOCK":"USER_ENTRY";
    for(const record of context.inspections.filter(x=>x.assetId===asset.id)){
      const text=record.items.map(x=>x.label+"："+x.value).join("；")+
        (record.note?"；"+record.note:"");
      if(category!=="general"&&rankMatched(text,category).length===0)continue;
      related.push({refId:record.id,kind:"inspection",title:`巡检记录 ${record.id}`,
        at:record.inspectedAt,text,source:sample(record.id,context.seedInspectionIds),
        path:"/operations/assets?tab=records&assetId="+encodeURIComponent(asset.id)});
    }
    for(const record of context.maintenance.filter(x=>x.assetId===asset.id)){
      if(category!=="general"&&rankMatched(record.summary,category).length===0)continue;
      related.push({refId:record.id,kind:"maintenance",title:`维修履历 ${record.id}`,
        at:record.at,text:record.summary,source:sample(record.id,context.seedMaintenanceIds),
        path:"/operations/assets?tab=records&assetId="+encodeURIComponent(asset.id)});
    }
    for(const order of context.workorders.filter(x=>x.assetId===asset.id
      &&(x.status==="archived"||x.acceptance?.accepted===true))){
      const text=[order.symptom,order.suggestion,order.result?.measures].filter(Boolean).join("；");
      if(category!=="general"&&rankMatched(text,category).length===0)continue;
      related.push({refId:order.id,kind:"workorder",title:`已验收工单 ${order.code}`,at:order.createdAt,
        text,source:sample(order.id,context.seedWorkorderIds),
        path:"/operations/workorders?workOrderId="+encodeURIComponent(order.id)});
    }
  }
  if(alarm)related.unshift({
    refId:alarm.id,kind:"alarm",title:`原始告警 ${alarm.code}`,at:alarm.occurredAt,
    text:alarm.title+"；"+alarm.detail,source:sampleSource(alarm.id,context.seedAlarmIds),
    path:"/operations/alarms?alarmId="+encodeURIComponent(alarm.id),
  });
  related.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.refId.localeCompare(b.refId));
  const findings:string[]=[];
  if(asset)findings.push(`当前对象：${asset.code} · ${asset.name}。归属工艺：${asset.subsystemId}；当前设备状态：${asset.status}（MOCK/当前DEMO）。`);
  if(alarm)findings.push(`已定位原始告警 ${alarm.code}（${alarm.status}）：${alarm.title}。告警描述属于原业务记录，不构成根因判断。`);
  if(topic)findings.push(`用户核查主题：${query.symptom||alarm?.title}。规则识别类别：${category}，只在当前设备的档案摘录中核对。`);
  else findings.push("未指定异常主题，可浏览设备资料，但不会生成诊断结论。");
  if(documents.length) findings.push(`检索到${documents.length}条设备适用且带版本/章节的演示内已审核原文片段；点击原文编号核验摘录。`);
  else findings.push("没有检索到同时满足设备适用、主题匹配、已审核及原文可定位条件的资料，不形成有证据的故障建议。");
  const checkSuggestions:KnowledgeResult["checkSuggestions"]=[];
  if(category!=="general"&&asset&&documents.length>0){
    // Generic *verification activity* supported by exact document citations; no guessed fault cause.
    checkSuggestions.push({
      text:`建议人工核对以下已引用资料中与“${query.symptom||alarm?.title||category}”相关的检查项及实际现场读数，确认异常是否存在；无法自动证明根因。`,
      supportingDocumentIds:documents.slice(0,3).map(x=>x.id),
    });
    if(category==="vibration"&&documents.some(x=>x.excerpt.includes("对中")))
      checkSuggestions.push({text:"文档摘录涉及联轴器对中，可安排人工核对对中检查要求；该检查方向不能代表对实际设备故障原因的确认。",
        supportingDocumentIds:documents.filter(x=>x.excerpt.includes("对中")).slice(0,3).map(x=>x.id)});
  }
  if(!asset||!documents.length)warnings.push("依据不足：仅保留原始告警/工单或巡检事实，禁止生成故障原因及维修措施结论。");
  if(excluded.length)warnings.push(`${excluded.length}份设备绑定资料因为未审核、版本/章节不全或原文不可用而未被采纳。`);
  return {
    query:{...query},category,asset,alarm,documents,excluded,related,findings,checkSuggestions,
    confidence:category!=="general"&&documents.length&&asset?"reference_only":"insufficient",warnings,
  };
}
function sampleSource(id:string,seeds?:string[]):"MOCK"|"USER_ENTRY"{
  return seeds?.includes(id)?"MOCK":"USER_ENTRY";
}

export function readKnowledgeDrafts(storage:KnowledgeStorage,scenarioId?:string):KnowledgeDraft[]{
  try{
    const raw:unknown=JSON.parse(storage.getItem(KNOWLEDGE_DRAFT_KEY)??"[]");
    if(!Array.isArray(raw))return [];
    const docs=(raw as KnowledgeDraft[]).filter(x=>x&&typeof x.id==="string"&&
      ["pending_review","reviewed_demo"].includes(x.status));
    return scenarioId?docs.filter(x=>x.scenarioId===scenarioId):docs;
  }catch{return [];}
}
export function saveKnowledgeDraft(
  result:KnowledgeResult,scenarioId:string,role:Role,storage:KnowledgeStorage,
):KnowledgeDraft{
  assertCan(role,"knowledge:save");
  if(!result.asset)throw new Error("设备不存在，不能保存诊断草稿");
  const now=new Date().toISOString();
  const draft:KnowledgeDraft={
    id:"KBR-"+Date.now().toString(36).toUpperCase()+"-"+Math.random().toString(36).slice(2,7).toUpperCase(),
    scenarioId,assetId:result.asset.id,source:"MOCK_CONTEXT",status:"pending_review",
    query:{...result.query},category:result.category,createdAt:now,createdBy:role,
    title:result.asset.code+" · 知识证据核验（DEMO）",
    description:result.checkSuggestions.length?
      result.checkSuggestions.map(x=>x.text).join("；"):
      "文档依据不足，需补充经核实的设备资料与现场测量后再做诊断；不允许凭空给出根因。",
    evidence:result.documents.map(x=>({id:x.id,version:x.version,section:x.section,
      citation:x.citation,fingerprint:x.fingerprint,source:x.source,isDemo:x.isDemo})),
    recordRefs:result.related.map(x=>x.kind+":"+x.refId),
    warnings:[...result.warnings],
  };
  const existing=readKnowledgeDrafts(storage);
  storage.setItem(KNOWLEDGE_DRAFT_KEY,JSON.stringify([draft,...existing].slice(0,30)));
  return draft;
}
/** 仅审查当前资料是否还能支撑历史草稿；即使草稿已经审核，原文删除/变更也必须即时标失效。 */
export type KnowledgeCitationCheck = {
  valid: boolean;
  hasEvidence: boolean;
  missing: string[];
  status: "valid_reference" | "evidence_missing" | "citation_stale";
};
export function inspectKnowledgeCitations(
  draft:Pick<KnowledgeDraft,"assetId"|"evidence">,
  currentDocuments:DocumentRef[],
  removedDocumentIds:string[]=[],
):KnowledgeCitationCheck {
  const removed=new Set(removedDocumentIds);
  const missing:string[]=[];
  for(const citation of draft.evidence){
    const doc=currentDocuments.find(x=>x.id===citation.id);
    let reason="";
    if(!doc||removed.has(citation.id)||doc.unavailable)reason="原文已删除或不可访问";
    else if(!doc.assetIds.includes(draft.assetId))reason="原文不再适用于目标设备";
    else if(!doc.reviewed)reason="原文审核状态已撤销";
    else if(!doc.contentExcerpt?.trim()||!doc.version?.trim()||!doc.lineOrSection?.trim())reason="原文或版本章节缺失";
    else if(doc.version!==citation.version||doc.lineOrSection!==citation.section
      ||excerptFingerprint(doc.contentExcerpt)!==citation.fingerprint)
      reason="原文正文、章节或版本已变更";
    else if(doc.source!==citation.source)reason="来源类型发生变化";
    if(reason)missing.push(citation.id+"："+reason);
  }
  return {
    valid:missing.length===0&&draft.evidence.length>0,
    hasEvidence:draft.evidence.length>0,
    missing,
    status:missing.length?"citation_stale":draft.evidence.length?"valid_reference":"evidence_missing",
  };
}
export function reviewKnowledgeDraft(
  id:string,role:Role,note:string,storage:KnowledgeStorage,
  currentDocuments:DocumentRef[],
):KnowledgeDraft{
  assertCan(role,"knowledge:review");
  const value=note.trim();
  if(value.length<8)throw new Error("请填写至少8字的审核意见，并核对来源和适用条件");
  const all=readKnowledgeDrafts(storage);
  const index=all.findIndex(x=>x.id===id);
  if(index<0)throw new Error("记录不存在");
  const original=all[index];
  if(original.status!=="pending_review")throw new Error("记录已审核");
  const validation=inspectKnowledgeCitations(original,currentDocuments);
  if(validation.status==="citation_stale")
    throw new Error("引用资料失效："+validation.missing.join("；")+"。请重新检索并生成核验草稿");
  const updated:KnowledgeDraft={...original,status:"reviewed_demo",reviewedAt:new Date().toISOString(),
    reviewedBy:role,reviewNote:value};
  all[index]=updated;storage.setItem(KNOWLEDGE_DRAFT_KEY,JSON.stringify(all));
  return updated;
}
