/**
 * 跨系统事件协同V1：相同设备/已有工单引用是显式业务关联；
 * 时间接近只生成线索，不推断物理管线、根因或自动派单。
 * 人工录入的关系和复核均标记为DEMO，不表示现场已核实。
 */
import { assertCan } from "./permissions";
import type { Alarm, Asset, Role, WorkOrder } from "./types";
import type { DutyEvent } from "./unattended";

export const CORRELATION_KEY = "tanggang-correlation-v1";
const WINDOW_MS = 24 * 3600 * 1000;
export interface CorrelationSignal {
  ref: string;
  id: string;
  source: "alarm" | "duty";
  assetId: string;
  subsystemId: string;
  title: string;
  at: string;
  status: string;
  active: boolean;
  severity: "warning" | "critical";
  pointId?: string;
  workOrderId?: string;
}
export interface CorrelationLink {
  id: string;
  scenarioId: string;
  upstreamAssetId: string;
  downstreamAssetId: string;
  relation: "possible_supply" | "possible_shared_cause";
  evidenceRef: string;
  note: string;
  status: "submitted" | "reviewed_demo";
  source: "USER_ENTRY";
  createdBy: Role;
  createdAt: string;
  reviewedBy?: Role;
  reviewedAt?: string;
  reviewNote?: string;
}
export interface CorrelationPair {
  id: string;
  from: CorrelationSignal;
  to: CorrelationSignal;
  deltaHours: number;
  relation: CorrelationLink | null;
  evidenceLevel: "temporal_only" | "recorded_demo_assumption";
  message: string;
}
export interface CorrelationCluster {
  id: string;
  assetId: string;
  assetCode: string;
  subsystemId: string;
  title: string;
  severity: "warning" | "critical";
  signals: CorrelationSignal[];
  existingOrders: WorkOrder[];
  linkedPairs: CorrelationPair[];
}
export interface CorrelationSnapshot {
  signals: CorrelationSignal[];
  clusters: CorrelationCluster[];
  crossCandidates: CorrelationPair[];
  unconfirmedCount: number;
  reviewedDemoCount: number;
  summary: string[];
}
export type CaseStatus = "acknowledged" | "processing" | "pending_recovery" | "closed";
export interface CorrelationCase {
  id: string;
  scenarioId: string;
  rootAssetId: string;
  status: CaseStatus;
  signalRefs: string[];
  linkedPairIds: string[];
  relatedAssetIds: string[];
  workOrderId?: string;
  operatorNote: string;
  createdAt: string;
  createdBy: Role;
  updatedAt: string;
  audit: {at:string;by:Role;action:string;detail:string}[];
}
export interface CorrelationStorage {
  version: 1;
  links: CorrelationLink[];
  cases: CorrelationCase[];
}
export interface CorrelationStorageAdapter {
  getItem(key:string): string|null;
  setItem(key:string,value:string): void;
}
export const blankCorrelation=():CorrelationStorage=>({version:1,links:[],cases:[]});
export function readCorrelation(storage:CorrelationStorageAdapter):CorrelationStorage{
  try{
    const parsed:unknown=JSON.parse(storage.getItem(CORRELATION_KEY)??"null");
    if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)){
      const obj=parsed as Partial<CorrelationStorage>;
      if(obj.version===1&&Array.isArray(obj.links)&&Array.isArray(obj.cases))
        return {version:1,links:obj.links.filter(x=>x&&typeof x.id==="string"),
          cases:obj.cases.filter(x=>x&&typeof x.id==="string")};
    }
  }catch{/* corrupted local data must not imply no faults */}
  return blankCorrelation();
}
function persist(storage:CorrelationStorageAdapter,value:CorrelationStorage):void{
  storage.setItem(CORRELATION_KEY,JSON.stringify({
    version:1,links:value.links.slice(-60),cases:value.cases.slice(-60),
  } satisfies CorrelationStorage));
}
function canonicalPair(a:string,b:string):string{
  return [a,b].sort().join("~");
}
export function linkId(scenarioId:string,a:string,b:string):string{
  return scenarioId+"::"+canonicalPair(a,b);
}
export function caseId(scenarioId:string,assetId:string):string{
  return scenarioId+"::"+assetId;
}
function valueTime(t:string):number{return Date.parse(t);}
export function collectCorrelationSignals(alarms:Alarm[],events:DutyEvent[]):CorrelationSignal[]{
  const result:CorrelationSignal[]=[];
  for(const alarm of alarms){
    if(alarm.kind!=="production")continue;
    result.push({
      ref:"alarm:"+alarm.id,id:alarm.id,source:"alarm",
      assetId:alarm.assetId,subsystemId:alarm.subsystemId,title:alarm.title,
      at:alarm.occurredAt,status:alarm.status,
      active:alarm.status!=="closed",severity:alarm.level==="critical"?"critical":"warning",
      pointId:alarm.pointId,workOrderId:alarm.workOrderId,
    });
  }
  for(const event of events){
    result.push({
      ref:"duty:"+event.id,id:event.id,source:"duty",
      assetId:event.assetId,subsystemId:event.subsystemId,title:event.title,
      at:event.lastSeen,status:event.status,
      active:event.status!=="closed"&&event.status!=="dismissed",
      severity:event.level,workOrderId:event.workOrderId,
    });
  }
  return result.sort((a,b)=>(valueTime(b.at)||0)-(valueTime(a.at)||0) || a.ref.localeCompare(b.ref));
}
export function buildCorrelationSnapshot(
  alarms:Alarm[],events:DutyEvent[],orders:WorkOrder[],assets:Asset[],
  links:CorrelationLink[],scenarioId:string,
):CorrelationSnapshot{
  const signals=collectCorrelationSignals(alarms,events);
  const active=signals.filter(s=>s.active);
  const groups=new Map<string,CorrelationSignal[]>();
  for(const signal of active)groups.set(signal.assetId,[...(groups.get(signal.assetId)??[]),signal]);
  const crossCandidates:CorrelationPair[]=[];
  const pairs=new Set<string>();
  for(let i=0;i<active.length;i++){
    for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];
      if(a.subsystemId===b.subsystemId||a.assetId===b.assetId)continue;
      const pairKey=canonicalPair(a.assetId,b.assetId);
      if(pairs.has(pairKey))continue;
      const ta=valueTime(a.at),tb=valueTime(b.at);
      if(!Number.isFinite(ta)||!Number.isFinite(tb)||Math.abs(ta-tb)>WINDOW_MS)continue;
      const relation=links.find(x=>x.scenarioId===scenarioId
        &&canonicalPair(x.upstreamAssetId,x.downstreamAssetId)===pairKey
        &&x.status==="reviewed_demo")??null;
      const deltaHours=Math.round(Math.abs(ta-tb)/3600000*10)/10;
      crossCandidates.push({
        id:linkId(scenarioId,a.assetId,b.assetId),from:a,to:b,deltaHours,relation,
        evidenceLevel:relation?"recorded_demo_assumption":"temporal_only",
        message:relation
          ?"已有人工复核的DEMO假设关系，仅允许作为协同核查依据，仍不能推定共同根因。"
          :"仅发现不同时段接近的跨工艺异常；尚无现场管线连接或同源测点证据，禁止自动认定共因。",
      });
      pairs.add(pairKey);
    }
  }
  const clusters:CorrelationCluster[]=[...groups.entries()].map(([assetId,obs])=>{
    const asset=assets.find(x=>x.id===assetId);
    const codes=obs.map(x=>x.workOrderId).filter(Boolean) as string[];
    const existingOrders=orders.filter(o=>o.assetId===assetId ||codes.includes(o.id))
      .filter(o=>o.status!=="cancelled");
    const linkedPairs=crossCandidates.filter(x=>x.relation
      &&(x.from.assetId===assetId||x.to.assetId===assetId));
    return {
      id:caseId(scenarioId,assetId),assetId,assetCode:asset?.code??assetId,
      subsystemId:asset?.subsystemId??obs[0].subsystemId,
      title:asset?asset.name:obs[0].title,
      severity:(obs.some(x=>x.severity==="critical")?"critical":"warning") as CorrelationCluster["severity"],
      signals:obs,existingOrders,linkedPairs,
    };
  }).sort((a,b)=>Number(b.severity==="critical")-Number(a.severity==="critical")
    ||b.signals.length-a.signals.length||a.assetCode.localeCompare(b.assetCode));
  return {
    signals,clusters,crossCandidates,
    unconfirmedCount:crossCandidates.filter(x=>!x.relation).length,
    reviewedDemoCount:crossCandidates.filter(x=>x.relation).length,
    summary:[
      "同一设备的有效告警和智能值守事件可合并展示，保留各自事件ID和原工单引用；不代替业务告警本身。",
      "跨系统时间接近是线索，不构成物理连接或共同根因证据；未录入关系时绝不自动跨系统合并。",
      "本系统的物理连接标志尚未由现场确认；人工记录只在DEMO中审核，不能当成真实工程拓扑。",
    ],
  };
}
function requiredNote(note:string):string{
  const clean=note.trim();
  if(clean.length<8)throw new Error("请填写不少于8字的核查依据或处置说明");
  if(clean.length>500)throw new Error("说明不得超过500字");
  return clean;
}
export function recordDemoLink(
  existing:CorrelationStorage,scenarioId:string,a:string,b:string,
  evidenceRef:string,note:string,role:Role,at:string,
):CorrelationStorage{
  assertCan(role,"correlation:link");
  if(a===b||!a||!b)throw new Error("必须选择两个不同设备");
  if(!evidenceRef.trim()||evidenceRef.trim().length<5)
    throw new Error("必须输入来源图号、现场记录编号或待核资料编号；不得空口确认");
  const detail=requiredNote(note);
  const id=linkId(scenarioId,a,b);
  const old=existing.links.find(x=>x.id===id);
  if(old?.status==="reviewed_demo")throw new Error("关联关系已演示审核；修改前需重新核查");
  const link:CorrelationLink={
    id,scenarioId,upstreamAssetId:a,downstreamAssetId:b,
    relation:"possible_supply",evidenceRef:evidenceRef.trim(),note:detail,
    status:"submitted",source:"USER_ENTRY",createdBy:role,createdAt:at,
  };
  return {...existing,links:[...existing.links.filter(x=>x.id!==id),link]};
}
export function reviewDemoLink(
  existing:CorrelationStorage,id:string,reviewNote:string,role:Role,at:string,
):CorrelationStorage{
  assertCan(role,"correlation:review");
  const link=existing.links.find(x=>x.id===id);
  if(!link)throw new Error("未找到待核验的关系记录");
  if(link.status!=="submitted")throw new Error("关系已复核，不能重复审核");
  const explanation=requiredNote(reviewNote);
  const updated:CorrelationLink={...link,status:"reviewed_demo",reviewedBy:role,reviewedAt:at,reviewNote:explanation};
  return {...existing,links:existing.links.map(x=>x.id===id?updated:x)};
}
export function saveCorrelation(storage:CorrelationStorageAdapter,value:CorrelationStorage):void{
  persist(storage,value);
}
export function acceptCorrelationCase(
  state:CorrelationStorage,scenarioId:string,cluster:CorrelationCluster,
  role:Role,at:string,note:string,
):CorrelationStorage{
  assertCan(role,"correlation:handle");
  const detail=requiredNote(note);
  const linkedRefs=cluster.linkedPairs.flatMap(pair=>[pair.from.ref,pair.to.ref]);
  const linkedPairs=cluster.linkedPairs.map(pair=>pair.id);
  const relatedAssetIds=[...new Set([cluster.assetId,...cluster.linkedPairs.flatMap(p=>[p.from.assetId,p.to.assetId])])];
  const signalRefs=[...new Set([...cluster.signals.map(x=>x.ref),...linkedRefs])];
  if(state.cases.some(x=>x.status!=="closed"&&(
    x.id===cluster.id||x.linkedPairIds.some(id=>linkedPairs.includes(id))
    ||x.signalRefs.some(ref=>signalRefs.includes(ref))
  )))throw new Error("相关信号已存在待处理协同事件，请进入原事件继续处理，避免多头受理和重复派工");
  const record:CorrelationCase={
    id:cluster.id,scenarioId,rootAssetId:cluster.assetId,status:"acknowledged",
    signalRefs,
    linkedPairIds:linkedPairs,
    relatedAssetIds,
    operatorNote:detail,
    createdAt:at,createdBy:role,updatedAt:at,
    workOrderId:cluster.existingOrders.find(x=>x.status!=="archived")?.id,
    audit:[{at,by:role,action:"人工受理",detail:"依据当前有效事件及DEMO关系登记受理；未确认根因。"+detail}],
  };
  return {...state,cases:[...state.cases.filter(x=>x.id!==cluster.id),record]};
}
export function updateCorrelationCase(
  state:CorrelationStorage,id:string,
  to:CaseStatus,role:Role,at:string,note:string,
  signals:CorrelationSignal[],orders:WorkOrder[],
):CorrelationStorage{
  assertCan(role,"correlation:handle");
  const current=state.cases.find(x=>x.id===id);
  if(!current)throw new Error("事件不存在");
  const detail=requiredNote(note);
  const allowed:Record<CaseStatus,CaseStatus[]>={
    acknowledged:["processing"],processing:["pending_recovery"],
    pending_recovery:["closed"],closed:[],
  };
  if(!allowed[current.status].includes(to))throw new Error("事件状态不允许本次操作");
  if(to==="closed"){
    const missing=current.signalRefs.filter(ref=>!signals.some(s=>s.ref===ref));
    if(missing.length)throw new Error("部分原始证据已不可访问，禁止按已恢复关闭："+missing.join("、"));
    const unresolved=signals.filter(s=>current.signalRefs.includes(s.ref)&&s.active);
    if(unresolved.length)throw new Error("仍有源告警或值守事件未关闭："+unresolved.map(x=>x.id).join("、"));
    const involved=new Set(current.relatedAssetIds?.length?current.relatedAssetIds:[current.rootAssetId]);
    const newUnresolved=signals.filter(s=>involved.has(s.assetId)&&s.active);
    if(newUnresolved.length)throw new Error("相关设备存在新活动异常，禁止关闭协同事件");
    const related=orders.filter(o=>o.id===current.workOrderId
      ||(o.assetId===current.rootAssetId&&o.status!=="cancelled"));
    if(related.some(o=>o.status!=="archived"))throw new Error("关联工单尚未验收归档，不能宣称处置完成");
  }
  const next:CorrelationCase={
    ...current,status:to,updatedAt:at,operatorNote:detail,
    audit:[...current.audit,{at,by:role,action:to==="processing"?"进入协同处理":to==="pending_recovery"?"申请恢复核验":"人工关闭",detail}],
  };
  return {...state,cases:state.cases.map(x=>x.id===id?next:x)};
}
export function attachCorrelationOrder(
  state:CorrelationStorage,id:string,workOrderId:string,role:Role,at:string,
):CorrelationStorage{
  assertCan(role,"correlation:handle");
  const item=state.cases.find(x=>x.id===id);
  if(!item)throw new Error("请先受理关联事件");
  if(item.workOrderId&&item.workOrderId!==workOrderId)
    throw new Error("已有业务工单关联，不能重复建立或覆盖");
  if(item.workOrderId===workOrderId)return state;
  return {...state,cases:state.cases.map(x=>x.id===id?{
    ...x,workOrderId,updatedAt:at,
    audit:[...x.audit,{at,by:role,action:"关联工单",detail:workOrderId+"（未自动派工）"}],
  }:x)};
}
export const readScenarioCorrelation=(state:CorrelationStorage,id:string)=>({
  links:state.links.filter(x=>x.scenarioId===id),
  cases:state.cases.filter(x=>x.scenarioId===id),
});
