/**
 * 唐港 V3.3：单池同周期水量守恒核查。
 * 所有数据为MOCK或人工待核资料，绝无PLC写入、现场验收和自动生产告警。
 */
import {assertCan} from "./permissions";
import {interpolateBasinVolume,pointBindingCheck,readBasinRecords,type BasinRecord,type BasinStorage} from "./basinRegistry";
import type {Asset,MeasurePoint,Role,WorkOrder} from "./types";

export const BALANCE_STORAGE_KEY="tanggang-v33-basin-balance-v1";
export const MAX_BALANCE_CASES=80;
export type BalanceBasis="MOCK"|"MANUAL_UNVERIFIED";
export type BalanceStatus="recorded"|"needs_ack"|"acknowledged"|"workorder_draft"|"closed_demo"|"demo_finished";
export interface BalanceInput{
 poolId:string;poolRevision:number;startAt:string;endAt:string;startLevelM:number;endLevelM:number;
 inflowM3:number;outflowM3:number;basis:BalanceBasis;evidenceRef:string;
}
export interface BalanceResult{
 startStorageM3:number;endStorageM3:number;observedDeltaM3:number;meteredNetM3:number;
 predictedEndM3:number;residualM3:number;toleranceM3:number;hours:number;
 outOfBounds:boolean;suspected:boolean;
}
export interface BalanceHistory{at:string;by:Role;action:string;note:string}
export interface BalanceCase{
 id:string;poolId:string;poolCode:string;poolRevision:number;poolSource:"MOCK"|"USER_ENTRY";
 input:BalanceInput;result:BalanceResult;status:BalanceStatus;createdAt:string;createdBy:Role;
 history:BalanceHistory[];linkedWorkOrderId?:string;linkedWorkOrderCode?:string;linkedAssetId?:string;
 recoveryCaseId?:string;
}
function fail(s:string):never{throw new Error(s);}
const numeric=(n:unknown,name:string,min:number,max:number):number=>{
 if(typeof n!=="number"||!Number.isFinite(n)||n<min||n>max)fail(name+"必须是"+min+"到"+max+"范围内的有限数");
 return n as number;
};
const dateMs=(v:string,label:string):number=>{
 if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(v))
  fail(label+"必须为带年月日及分钟的ISO时间");
 const t=Date.parse(v);
 if(!Number.isFinite(t))fail(label+"时间不合法");
 return t;
};
const isObj=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const round=(n:number)=>Math.round(n*100)/100;
const validBasis=(b:unknown):b is BalanceBasis=>b==="MOCK"||b==="MANUAL_UNVERIFIED";
const validStatus=(s:unknown):s is BalanceStatus=>["recorded","needs_ack","acknowledged","workorder_draft","closed_demo","demo_finished"].includes(String(s));

/** Residual = V_end - V_start - (intake - discharge). The thresholds are DEMO-only. */
export function calculateBasinBalance(pool:BasinRecord,input:BalanceInput):BalanceResult{
 if(pool.archived||pool.id!==input.poolId||pool.revision!==input.poolRevision)
  fail("池号、修订版本不匹配或池体已归档；请刷新并重新核算");
 if(!validBasis(input.basis))fail("数据来源非法");
 const start=dateMs(input.startAt,"开始"),end=dateMs(input.endAt,"结束");
 const hours=(end-start)/3600000;
 if(hours<=0||hours>168)fail("起止时间必须为递增且不超过7天的同一核算周期");
 const hi0=numeric(input.startLevelM,"起始液位",pool.minLevelM,pool.maxLevelM);
 const hi1=numeric(input.endLevelM,"结束液位",pool.minLevelM,pool.maxLevelM);
 const qIn=numeric(input.inflowM3,"周期进水量",0,1e8);
 const qOut=numeric(input.outflowM3,"周期出水量",0,1e8);
 const datum=interpolateBasinVolume(pool.knots,pool.minLevelM);
 const startStorageM3=interpolateBasinVolume(pool.knots,hi0)-datum;
 const endStorageM3=interpolateBasinVolume(pool.knots,hi1)-datum;
 const observedDeltaM3=endStorageM3-startStorageM3;
 const meteredNetM3=qIn-qOut;
 const predictedEndM3=startStorageM3+meteredNetM3;
 // DEMO heuristic only, not a standard or engineering approval threshold.
 const toleranceM3=Math.max(20,round((qIn+qOut)*0.05));
 const capacity=interpolateBasinVolume(pool.knots,pool.maxLevelM)-datum;
 const outOfBounds=predictedEndM3<0||predictedEndM3>capacity;
 const residualM3=observedDeltaM3-meteredNetM3;
 return {startStorageM3:round(startStorageM3),endStorageM3:round(endStorageM3),
  observedDeltaM3:round(observedDeltaM3),meteredNetM3:round(meteredNetM3),
  predictedEndM3:round(predictedEndM3),residualM3:round(residualM3),toleranceM3,
  hours:round(hours),outOfBounds,suspected:outOfBounds||Math.abs(residualM3)>toleranceM3};
}

export function readBasinBalanceCases(storage:BasinStorage):BalanceCase[]{
 try{
  const raw:unknown=JSON.parse(storage.getItem(BALANCE_STORAGE_KEY)??"[]");
  if(!Array.isArray(raw))return [];
  const ids=new Set<string>(),result:BalanceCase[]=[];
  for(const v of raw.slice(0,100)){
   if(!isObj(v)||typeof v.id!=="string"||!/^BB-[A-Z0-9-]+$/.test(v.id)||
    ids.has(v.id)||typeof v.poolId!=="string"||!/^((MOCK|BASIN)-[A-Z0-9_-]+)$/.test(v.poolId)||
    !isObj(v.input)||!isObj(v.result)||!validBasis(v.input.basis)||!validStatus(v.status)||
    !Number.isFinite(v.result.residualM3)||typeof v.result.suspected!=="boolean"||
    !Array.isArray(v.history))continue;
   ids.add(v.id);result.push(v as unknown as BalanceCase);
  }
  return result;
 }catch{return [];}
}
const persist=(storage:BasinStorage,items:BalanceCase[])=>{
 // No silent deletion of historical records, especially records linked to a work order.
 if(items.length>MAX_BALANCE_CASES)fail("本机核查记录已达"+MAX_BALANCE_CASES+"条上限；请先导出备份，不能自动清除历史记录");
 storage.setItem(BALANCE_STORAGE_KEY,JSON.stringify(items));
};
/** Explicit portable backup; no automatic import of untrusted data into operational records. */
export function exportBasinBalanceBackup(storage:BasinStorage,now:string):string{
 const at=nowValid(now);
 return JSON.stringify({schema:"tanggang-basin-balance-backup-v1",exportedAt:at,
  note:"仅本机DEMO核算与人工核查记录，不代表现场原始计量证据",
  cases:readBasinBalanceCases(storage)},null,2);
}

const nowValid=(s:string)=>{dateMs(s,"操作");return s;};
const noteValid=(s:string)=>{
 const v=typeof s==="string"?s.trim():"";
 if(v.length<8||v.length>400)fail("核查说明需填写8–400个字符");
 return v;
};
export function submitBasinBalanceCase(storage:BasinStorage,pool:BasinRecord,input:BalanceInput,
 role:Role,now:string):BalanceCase{
 assertCan(role,"engineering:submit");
 const calculated=calculateBasinBalance(pool,input);
 const evidenceRef=noteValid(input.evidenceRef);
 const items=readBasinBalanceCases(storage);
 if(items.length>=MAX_BALANCE_CASES)fail("本机已保存80条核查记录，禁止静默覆盖；请先导出备份并进行数据归档");
 const at=nowValid(now);
 const prefix="BB-"+Date.parse(at).toString(36).toUpperCase()+"-";
 let serial=1;
 while(items.some(x=>x.id===prefix+String(serial).padStart(2,"0")))serial++;
 const id=prefix+String(serial).padStart(2,"0");
 const clean={...input,evidenceRef};
 const item:BalanceCase={id,poolId:pool.id,poolCode:pool.code,poolRevision:pool.revision,
  poolSource:pool.source,input:clean,result:calculated,
  status:calculated.suspected?"needs_ack":"recorded",createdAt:at,createdBy:role,
  history:[{at,by:role,action:"保存单池待核水量快照",
   note:"数据源："+input.basis+"；仅演示残差阈值，现场未验收"}]};
 if(items.some(x=>x.id===id))fail("核算ID冲突，请重新提交");
 persist(storage,[item,...items]);return item;
}
export function acknowledgeBasinBalanceCase(storage:BasinStorage,id:string,role:Role,
 note:string,now:string):BalanceCase{
 assertCan(role,"engineering:submit");
 const items=readBasinBalanceCases(storage),old=items.find(x=>x.id===id);
 if(!old||old.status!=="needs_ack")fail("仅可人工确认尚未受理的疑似残差");
 const at=nowValid(now),why=noteValid(note);
 const next:BalanceCase={...old,status:"acknowledged",history:[...old.history,
  {at,by:role,action:"受理模拟异常核查（非实时生产告警）",note:why}]};
 persist(storage,[next,...items.filter(x=>x.id!==id)]);
 return next;
}
/**
 * Preflight before creating a work order in the separate Pinia/localStorage store.
 * This reduces orphan drafts but is NOT a cross-store database transaction.
 */
export function preflightBasinBalanceOrder(storage:BasinStorage,id:string,role:Role,
 pool:BasinRecord,assets:readonly Asset[],points:readonly MeasurePoint[],assetId:string):BalanceCase{
 assertCan(role,"workorder:create");
 const old=readBasinBalanceCases(storage).find(x=>x.id===id);
 if(!old||old.status!=="acknowledged"||old.poolId!==pool.id||
  old.poolRevision!==pool.revision||pool.archived)
  fail("核查记录未受理或池体版本已变化，不能创建设备工单");
 if(pool.source!=="USER_ENTRY"||!pool.levelPointId)
  fail("MOCK池和无专属液位点的池体不能创建设备工单");
 if(old.input.basis!=="MANUAL_UNVERIFIED")
  fail("MOCK输入不得关联用户登记池体的真实候选设备工单");
 const binding=pointBindingCheck(pool,pool.levelPointId,assets,points,readBasinRecords(storage));
 const point=points.find(x=>x.id===pool.levelPointId);
 if(!binding.ok||!point||point.assetId!==assetId)
  fail("工单设备与该池唯一候选液位测点不一致："+binding.reason);
 return old;
}
export function finishBasinDemoCase(storage:BasinStorage,id:string,role:Role,
 note:string,now:string):BalanceCase{
 assertCan(role,"engineering:submit");
 const items=readBasinBalanceCases(storage),old=items.find(x=>x.id===id);
 if(!old||old.poolSource!=="MOCK"||old.status!=="acknowledged")
  fail("只有已人工受理的MOCK核查才能结束模拟演练");
 const next:BalanceCase={...old,status:"demo_finished",history:[...old.history,
  {at:nowValid(now),by:role,action:"结束MOCK演练（非现场恢复/非工单验收）",note:noteValid(note)}]};
 persist(storage,[next,...items.filter(x=>x.id!==id)]);
 return next;
}
export function attachBasinBalanceWorkOrder(storage:BasinStorage,id:string,role:Role,
 pool:BasinRecord,assets:readonly Asset[],points:readonly MeasurePoint[],
 order:WorkOrder,now:string):BalanceCase{
 assertCan(role,"workorder:create");
 const items=readBasinBalanceCases(storage),old=items.find(x=>x.id===id);
 if(old?.status==="workorder_draft"&&old.linkedWorkOrderId===order.id)return old; // idempotent retry
 preflightBasinBalanceOrder(storage,id,role,pool,assets,points,order.assetId);
 if(order.status!=="draft"||!order.evidenceIds.includes(id)||!order.title.includes(id))
  fail("仅允许关联含本次核查ID的设备核查工单草稿");
 const at=nowValid(now);
 const next:BalanceCase={...old!,status:"workorder_draft",linkedWorkOrderId:order.id,
  linkedWorkOrderCode:order.code,linkedAssetId:order.assetId,
  history:[...old!.history,{at,by:role,action:"关联设备核查工单草稿",
   note:"仅核实候选设备与计量证据："+order.code+"；不据此判断设备损坏或放行控制"}]};
 persist(storage,[next,...items.filter(x=>x.id!==id)]);
 return next;
}
export function closeDemoBalanceCase(storage:BasinStorage,id:string,role:Role,now:string,
 note:string,recheckId:string,orders:readonly WorkOrder[]):BalanceCase{
 assertCan(role,"engineering:review");
 const items=readBasinBalanceCases(storage),old=items.find(x=>x.id===id);
 if(!old||old.status!=="workorder_draft"||!old.linkedWorkOrderId)
  fail("尚未关联工单，不能关闭模拟核查");
 const order=orders.find(x=>x.id===old.linkedWorkOrderId);
 if(!order||order.status!=="archived")fail("关联工单尚未验收归档，不能闭环");
 const recheck=items.find(x=>x.id===recheckId);
 if(!recheck||recheck.id===old.id||recheck.poolId!==old.poolId||
  recheck.poolRevision!==old.poolRevision||recheck.result.suspected||
  dateMs(recheck.input.startAt,"复核开始")<dateMs(old.input.endAt,"原核查结束"))
  fail("需要同池同版、原核算结束之后且未触发演示阈值的新水量复核快照");
 const at=nowValid(now),why=noteValid(note);
 const next:BalanceCase={...old,status:"closed_demo",recoveryCaseId:recheck.id,
  history:[...old.history,{at,by:role,action:"DEMO人工复核闭环（不代表现场消项）",
   note:why+"；核算："+recheck.id+"；工单："+order.code}]};
 persist(storage,[next,...items.filter(x=>x.id!==id)]);
 return next;
}
