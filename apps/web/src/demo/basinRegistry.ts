/**
 * 唐港 V3.2 逐池设计资料台账 — local demo only.
 * No approved as-built basin ID, elevation datum, stage-storage relation or LIVE point is present.
 * DEMO review cannot grant field acceptance, hydraulic connectivity or PLC authorization.
 */
import {assertCan} from "./permissions";
import type {Asset, MeasurePoint, Role} from "./types";

export const BASIN_STORAGE_KEY="tanggang-v32-basin-registry-v1";
export type BasinPurpose="polluted_collection"|"first_flush"|"later_rain"|"ecological"|"clear_reuse"|"supply_storage";
export type BasinSubsystem="rainwater"|"mining"|"pool";
export type BasinState="mock_sample"|"submitted"|"reviewed_demo"|"returned";
export type BasinRole="polluted"|"clear"|null;
export interface VhNode{hM:number;volumeM3:number}
export interface BasinInput{
 code:string;name:string;purpose:BasinPurpose;subsystemId:BasinSubsystem;
 siteRef:string;drawingRef:string;drawingVersion:string;datumDescription:string;
 minLevelM:number;maxLevelM:number;assumedLevelM:number|null;
 levelPointId:string|null;knots:VhNode[];
}
export interface BasinHistory{at:string;by:Role;action:string;note:string;revision:number}
export interface BasinRecord extends BasinInput{
 id:string;revision:number;state:BasinState;source:"MOCK"|"USER_ENTRY";
 fieldVerified:false;controlReleased:false;archived:boolean;
 createdAt:string;updatedAt:string;submittedBy:Role|null;
 reviewedBy?:Role;reviewedAt?:string;reviewNote?:string;
 history:BasinHistory[];
}
export interface BasinStorage{getItem(key:string):string|null;setItem(key:string,value:string):void}
export const PURPOSE_LABELS:Record<BasinPurpose,string>={
 polluted_collection:"污染水收集池",first_flush:"初期雨水池",later_rain:"后期雨水池",
 ecological:"生态蓄水池",clear_reuse:"处理后清水池",supply_storage:"供水池",
};
export const PURPOSE_SUBSYSTEM:Readonly<Record<BasinPurpose,BasinSubsystem>>={
 polluted_collection:"rainwater",first_flush:"rainwater",later_rain:"rainwater",
 ecological:"rainwater",clear_reuse:"mining",supply_storage:"pool",
};
export const BASIN_REQUIREMENTS=[
 {id:"CK-004",label:"一池一号与批准图纸"},
 {id:"CK-005",label:"70,638.9与60,739m³容量口径冲突"},
 {id:"CK-007",label:"逐池V-H有效容积"},
 {id:"CK-009",label:"池间与处理入站真实连通"},
 {id:"CK-014",label:"清水池容量及出水路径"},
 {id:"CK-023",label:"PLC/SCADA点表"},
 {id:"PT-002",label:"液位与V-H曲线"},
 {id:"PT-013",label:"清水池液位及容量"},
] as const;
const at="2026-11-14T08:00:00+08:00";
export const MOCK_BASINS:readonly BasinRecord[]=[
 {id:"MOCK-POLLUTED-POOL",code:"MOCK-POOL-D",name:"假设污染水池（非实物）",purpose:"polluted_collection",
  subsystemId:"rainwater",siteRef:"MOCK示意分区，非51/52号泊位实测点",
  drawingRef:"MOCK-NO-DRAWING",drawingVersion:"模拟V1",datumDescription:"假设相对水深零点；不代表黄海高程或现场高程",
  minLevelM:0,maxLevelM:5,assumedLevelM:2,levelPointId:null,
  knots:[{hM:0,volumeM3:0},{hM:2,volumeM3:1800},{hM:5,volumeM3:6200}],
  revision:1,state:"mock_sample",source:"MOCK",fieldVerified:false,controlReleased:false,archived:false,
  createdAt:at,updatedAt:at,submittedBy:null,history:[],
 },
 {id:"MOCK-CLEAR-POOL",code:"MOCK-POOL-C",name:"假设清水池（非实物）",purpose:"clear_reuse",
  subsystemId:"mining",siteRef:"MOCK工艺图示意，非竣工清水池",
  drawingRef:"MOCK-NO-DRAWING",drawingVersion:"模拟V1",datumDescription:"假设相对水深零点；不代表现场实测高程",
  minLevelM:0,maxLevelM:4,assumedLevelM:1,levelPointId:null,
  knots:[{hM:0,volumeM3:0},{hM:1,volumeM3:450},{hM:4,volumeM3:2200}],
  revision:1,state:"mock_sample",source:"MOCK",fieldVerified:false,controlReleased:false,archived:false,
  createdAt:at,updatedAt:at,submittedBy:null,history:[],
 },
];
function error(message:string):never{throw new Error(message);}
function str(value:unknown,label:string,min:number,max:number):string{
 if(typeof value!=="string")return error(label+"必须为文本");
 const v=value.trim();
 if(v.length<min||v.length>max)return error(label+"必须为"+min+"–"+max+"字符");
 return v;
}
function finite(value:unknown,label:string,min:number,max:number):number{
 if(typeof value!=="number"||!Number.isFinite(value)||value<min||value>max)
  return error(label+"必须是有限数且位于["+min+","+max+"]");
 return value;
}
export function basinRole(purpose:BasinPurpose):BasinRole{
 if(purpose==="polluted_collection"||purpose==="first_flush")return "polluted";
 if(purpose==="clear_reuse")return "clear";
 return null;
}
export function verifyBasinInput(input:BasinInput,allowMockCode=false):BasinInput{
 const code=str(input.code,"池体编号",5,40).toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))error("池体编号只能使用字母、数字、横线与下划线");
 if(code.startsWith("MOCK-")&&!allowMockCode)error("MOCK-前缀保留给系统独立的模拟池");
 const purpose=input.purpose;
 if(!Object.hasOwn(PURPOSE_LABELS,purpose))error("池体用途非法");
 if(input.subsystemId!==PURPOSE_SUBSYSTEM[purpose])error("池体用途与所属工艺不一致");
 const name=str(input.name,"池体名称",2,80);
 const siteRef=str(input.siteRef,"站点或分区参考",3,120);
 const drawingRef=str(input.drawingRef,"图纸/资料编号",6,120);
 const drawingVersion=str(input.drawingVersion,"图纸版本",2,40);
 const datumDescription=str(input.datumDescription,"液位高程基准说明",6,240);
 const minLevelM=finite(input.minLevelM,"最低工作液位m",-1000,10000);
 const maxLevelM=finite(input.maxLevelM,"最高工作液位m",-1000,10000);
 if(maxLevelM<=minLevelM)error("最高工作液位必须高于最低工作液位");
 if(!Array.isArray(input.knots)||input.knots.length<3||input.knots.length>30)
  error("V-H曲线必须有3–30行液位(m)、累积库容(m³)数据");
 const knots=input.knots.map((x,i)=>({
  hM:finite(x?.hM,"第"+(i+1)+"个液位m",-1000,10000),
  volumeM3:finite(x?.volumeM3,"第"+(i+1)+"个累积库容m³",0,1e8),
 }));
 for(let i=1;i<knots.length;i++){
  if(knots[i].hM<=knots[i-1].hM)error("V-H液位必须严格递增，不可重复");
  if(knots[i].volumeM3<=knots[i-1].volumeM3)error("V-H累积库容必须严格递增");
 }
 if(minLevelM<knots[0].hM||maxLevelM>knots.at(-1)!.hM)
  error("工作液位必须在V-H曲线范围内，禁止外推");
 const assumedLevelM=input.assumedLevelM===null?null:finite(input.assumedLevelM,"模拟起始液位m",-1000,10000);
 if(assumedLevelM!==null&&(assumedLevelM<minLevelM||assumedLevelM>maxLevelM))
  error("模拟起始液位必须在最低与最高工作液位之间");
 const levelPointId=input.levelPointId===null?null:str(input.levelPointId,"液位点ID",3,120);
 return {code,name,purpose,subsystemId:input.subsystemId,siteRef,drawingRef,drawingVersion,
  datumDescription,minLevelM,maxLevelM,assumedLevelM,levelPointId,knots};
}
/** Linear interpolation only between documented knots; no extrapolation, no implicit aggregation. */
export function interpolateBasinVolume(knots:readonly VhNode[],hM:number):number{
 if(!Number.isFinite(hM)||hM<knots[0]?.hM||hM>knots.at(-1)!.hM)
  return error("液位超出有效V-H曲线，禁止外推容量");
 if(hM===knots[0].hM)return knots[0].volumeM3;
 for(let i=1;i<knots.length;i++){
  if(hM<=knots[i].hM){
   const left=knots[i-1],right=knots[i];
   return left.volumeM3+(hM-left.hM)*(right.volumeM3-left.volumeM3)/(right.hM-left.hM);
  }
 }
 return error("无法计算给定液位的库容");
}
export function basinVolumes(input:BasinInput){
 const checked=verifyBasinInput(input,(input as BasinRecord).source==="MOCK");
 const minVolume=interpolateBasinVolume(checked.knots,checked.minLevelM);
 const maxVolume=interpolateBasinVolume(checked.knots,checked.maxLevelM);
 const effectiveCapacityM3=maxVolume-minVolume;
 const currentVolumeM3=checked.assumedLevelM===null?null:interpolateBasinVolume(checked.knots,checked.assumedLevelM)-minVolume;
 return {
  minVolumeM3:minVolume,maxVolumeM3:maxVolume,effectiveCapacityM3,
  mockInitialM3:currentVolumeM3,
  mockFreeM3:currentVolumeM3===null?null:effectiveCapacityM3-currentVolumeM3,
  actualAcceptedCapacityM3:null as null,verifiedFieldMeasurement:false as const,
 };
}
export function parseBasinCurve(text:string):VhNode[]{
 const lines=text.replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
 if(lines.length<3||lines.length>30)error("V-H曲线需要3–30行数据");
 const nodes=lines.map((line,i)=>{
  const cols=line.split(/[,，;\s]+/).filter(Boolean);
  if(cols.length!==2||cols.some(x=>!x||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(x)))
   return error("第"+(i+1)+"行必须是‘液位m,累积库容m³’，不得含单位文字");
  return {hM:Number(cols[0]),volumeM3:Number(cols[1])};
 });
 // Input verification requires full profile, monotonic can be verified here independently.
 for(let i=1;i<nodes.length;i++){
  if(nodes[i].hM<=nodes[i-1].hM||nodes[i].volumeM3<=nodes[i-1].volumeM3)
   error("V-H曲线应按液位与累积库容双重严格递增填写");
 }
 return nodes;
}
function isPlain(x:unknown):x is Record<string,unknown>{return typeof x==="object"&&x!==null&&!Array.isArray(x);}
export function readBasinRecords(storage:BasinStorage):BasinRecord[]{
 try{
  const raw:unknown=JSON.parse(storage.getItem(BASIN_STORAGE_KEY)??"[]");
  if(!Array.isArray(raw))return [];
  const codes=new Set<string>();const result:BasinRecord[]=[];
  for(const value of raw.slice(0,120)){
   if(!isPlain(value))continue;
   const x=value as unknown as BasinRecord;
   if(x.fieldVerified!==false||x.controlReleased!==false||x.source!=="USER_ENTRY"||
     x.id!=="BASIN-"+x.code||!Number.isInteger(x.revision)||x.revision<1||
     !["submitted","reviewed_demo","returned"].includes(x.state)||
     !Array.isArray(x.history)||!["admin","manager","engineer","water","duty"].includes(x.submittedBy??"")||
     typeof x.archived!=="boolean")continue;
   try{
    const verified=verifyBasinInput(x);
    if(codes.has(verified.code))continue;
    codes.add(verified.code);
    result.push({...x,...verified});
   }catch{continue;}
  }
  return result;
 }catch{return [];}
}
export function allBasinRecords(storage:BasinStorage):BasinRecord[]{
 return [...MOCK_BASINS,...readBasinRecords(storage)];
}
export function pointBindingCheck(pool:BasinInput,pointId:string|null,assets:readonly Asset[],
 points:readonly MeasurePoint[],records:readonly BasinRecord[]):{ok:boolean;reason:string}{
 if(!pointId)return {ok:false,reason:"未绑定池体专属液位点。不可据此推算真实库容"};
 const point=points.find(x=>x.id===pointId),asset=assets.find(x=>x.id===point?.assetId);
 if(!point||!asset||asset.archived)return {ok:false,reason:"找不到对应有效资产与测点"};
 if(asset.subsystemId!==pool.subsystemId)return {ok:false,reason:"测点所属工艺与池体所属工艺不一致"};
 if(point.kind!=="number"||point.unit!=="m"||!/(液位|水位)/.test(point.label))
  return {ok:false,reason:"需要单位为m的液位或水位测点；百分比%不可直接代入V-H曲线"};
 if(!/(池|井|罐|液位|水位)/.test(asset.type))
  return {ok:false,reason:"测点所属资产不是已建立的池体/井/罐测量设备，需核实仪表物理归属"};
 if(records.some(x=>!x.archived&&x.code!==pool.code&&x.levelPointId===pointId))
  return {ok:false,reason:"此液位点已绑定另一个池体，不允许重复映射"};
 return {ok:true,reason:"仅为台账候选绑定；设备/仪表现场归属、基准与标定仍未正式确认"};
}
export function saveBasinRecord(storage:BasinStorage,input:BasinInput,role:Role,now:string,
 assets:readonly Asset[],points:readonly MeasurePoint[]):BasinRecord{
 assertCan(role,"engineering:submit");
 if(!Number.isFinite(Date.parse(now)))error("操作时间不合法");
 const clean=verifyBasinInput(input);
 const existing=readBasinRecords(storage);
 if(existing.length>=80&&!existing.some(x=>x.code===clean.code))error("本地台账最多80个池体");
 const old=existing.find(x=>x.code===clean.code);
 if(old?.archived)error("归档池体不能直接覆盖，应由管理者处理");
 if(clean.levelPointId){
  const link=pointBindingCheck(clean,clean.levelPointId,assets,points,existing);
  if(!link.ok)error(link.reason);
 }
 const revision=(old?.revision??0)+1;
 const entry:BasinRecord={
  ...clean,id:"BASIN-"+clean.code,revision,state:"submitted",source:"USER_ENTRY",
  fieldVerified:false,controlReleased:false,archived:false,createdAt:old?.createdAt??now,
  updatedAt:now,submittedBy:role,
  history:[...(old?.history??[]),{at:now,by:role,action:old?"修改池体资料草稿":"登记逐池资料草稿",
   note:"设计图号："+clean.drawingRef+" "+clean.drawingVersion+"；仅本地待核记录",revision}],
 };
 storage.setItem(BASIN_STORAGE_KEY,JSON.stringify([entry,...existing.filter(x=>x.code!==clean.code)]));
 return entry;
}
export function reviewBasinRecord(storage:BasinStorage,code:string,role:Role,
 decision:"reviewed_demo"|"returned",note:string,now:string):BasinRecord{
 assertCan(role,"engineering:review");
 const explanation=str(note,"复核说明",8,400);
 const items=readBasinRecords(storage),old=items.find(x=>x.code===code);
 if(!old||old.archived||old.state!=="submitted")error("只能复核待审阅的用户池体草稿");
 const next:BasinRecord={...old,state:decision,reviewedBy:role,reviewedAt:now,reviewNote:explanation,
  updatedAt:now,history:[...old.history,{at:now,by:role,action:decision==="returned"?"资料退回":"DEMO资料已审阅（非现场验收）",
   note:explanation,revision:old.revision}]};
 storage.setItem(BASIN_STORAGE_KEY,JSON.stringify([next,...items.filter(x=>x.code!==code)]));
 return next;
}
export function archiveBasinRecord(storage:BasinStorage,code:string,role:Role,reason:string,now:string):BasinRecord{
 assertCan(role,"engineering:review");
 const why=str(reason,"归档原因",8,400),items=readBasinRecords(storage),old=items.find(x=>x.code===code);
 if(!old||old.archived)error("未找到可归档的用户池体");
 const next:BasinRecord={...old,archived:true,updatedAt:now,history:[...old.history,{by:role,at:now,
  action:"归档池体台账",revision:old.revision,note:why}]};
 storage.setItem(BASIN_STORAGE_KEY,JSON.stringify([next,...items.filter(x=>x.code!==code)]));
 return next;
}
export function basinForScenario(pool:BasinRecord,target:BasinRole){
 if(!target||basinRole(pool.purpose)!==target||pool.archived)error("池体用途与污染水/清水模型不一致，或池体已归档");
 const v=basinVolumes(pool);
 if(v.mockInitialM3===null)error("没有模拟起始液位，无法转换为情景初始库容");
 return {
  target,sourceId:pool.id,sourceRevision:pool.revision,source:"MOCK" as const,
  capacityM3:v.effectiveCapacityM3,initialM3:v.mockInitialM3,
  fieldVerified:false as const,datumDescription:pool.datumDescription,
 };
}

/** An editable, auditable survey handoff. USER_ENTRY only; no fake project pools. */
export function exportBasinSurveyCsv(records:readonly BasinRecord[]):string{
 const headers=["池体独立编号","池体名称","用途","所属工艺","站点分区","图纸或资料编号","图纸版本","液位基准",
  "最低工作液位m","最高工作液位m","假设起始液位m","候选液位测点ID","V-H曲线(Hm:Vm³)",
  "资料来源","资料状态","修订版","真实现场已验收","工程是否允许自动控制"];
 const fields=(pool:BasinRecord):unknown[]=>[
  pool.code,pool.name,PURPOSE_LABELS[pool.purpose],pool.subsystemId,pool.siteRef,
  pool.drawingRef,pool.drawingVersion,pool.datumDescription,pool.minLevelM,pool.maxLevelM,
  pool.assumedLevelM??"",pool.levelPointId??"",
  pool.knots.map(x=>x.hM+":"+x.volumeM3).join(";"),
  pool.source,pool.state,pool.revision,"否","否",
 ];
 const escapeCell=(value:unknown):string=>{
  let s=String(value??"");
  // Prevent spreadsheet formula execution when operators open exported CSV in Excel.
  if(/^\s*[=+@-]/.test(s)&&typeof value==="string")s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
 };
 const valid=records.filter(p=>p.source==="USER_ENTRY"&&!p.archived&&p.fieldVerified===false);
 return [headers,...valid.map(fields)].map(row=>row.map(escapeCell).join(",")).join("\r\n")+"\r\n";
}
