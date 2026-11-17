import {assessIntegratedBalance,DEFAULT_INTEGRATED_BALANCE,type IntegratedBalanceInput,type IntegratedBalanceResult} from "./integratedBalance";
import {assertCan} from "./permissions";
import type {Role,ScenarioId} from "./types";

/** 仅浏览器 DEMO 本地存档。拟采纳不等于实际审批、设备命令或环保合规判定。 */
export const BALANCE_CASE_KEY="tanggang-balance-cases-v1";
export type BalanceStage="draft"|"submitted"|"adopted"|"tracking"|"closed"|"rejected";
export interface BalanceTrace {at:string;by:Role;action:string;detail:string}
export interface BalanceCase {
 id:string;scenarioId:ScenarioId;status:BalanceStage;createdAt:string;createdBy:Role;
 baseline:IntegratedBalanceInput;candidate:IntegratedBalanceInput;
 baselineResult:IntegratedBalanceResult;candidateResult:IntegratedBalanceResult;
 purpose:string; basis:string; owner?:string;
 reviewRef?:string;reviewNote?:string;tracking?:{
  input:IntegratedBalanceInput;result:IntegratedBalanceResult;evidenceRef:string;note:string;at:string;
 };
 outcome?:"improved"|"unresolved"|"unchanged";closureRef?:string;closureNote?:string;
 history:BalanceTrace[];
}
type LocalStore=Pick<Storage,"getItem"|"setItem">;
export function readBalanceCases(storage:Pick<Storage,"getItem">,scenario?:ScenarioId):BalanceCase[]{
 try {
  const raw=JSON.parse(storage.getItem(BALANCE_CASE_KEY)??"[]") as unknown;
  if(!Array.isArray(raw))return [];
  return raw.filter((x):x is BalanceCase=>{
   if(!x||typeof x!=="object")return false;
   const c=x as BalanceCase;
   return typeof c.id==="string"&&typeof c.scenarioId==="string"&&
     Array.isArray(c.history)&&typeof c.status==="string"&&Boolean(c.candidateResult);
  }).filter(c=>!scenario||c.scenarioId===scenario).slice(-50);
 }catch{return [];}
}
function save(storage:LocalStore,cases:BalanceCase[]):void{
 storage.setItem(BALANCE_CASE_KEY,JSON.stringify(cases.slice(-50)));
}
const short=(text:string,n:number)=>text.trim().slice(0,n);
function required(text:string,label:string,min=5):string{
 const value=short(text,500);
 if(value.length<min)throw Error(label+"需要至少"+min+"个字符");
 return value;
}
function stamp(now:string):string{
 if(!Number.isFinite(Date.parse(now)))throw Error("记录时间无效");
 return now;
}
export function createBalanceCase(storage:LocalStore,input:{
 scenarioId:ScenarioId;actor:Role;candidate:IntegratedBalanceInput;
 purpose:string;basis:string;now:string;baseline?:IntegratedBalanceInput;
}):BalanceCase{
 assertCan(input.actor,"water:proposal");
 const baseline={...(input.baseline??DEFAULT_INTEGRATED_BALANCE)};
 const candidate={...input.candidate};
 const baseResult=assessIntegratedBalance(baseline);
 const candidateResult=assessIntegratedBalance(candidate);
 const all=readBalanceCases(storage);
 const id="WBC-"+input.scenarioId.slice(4)+"-"+String(all.filter(x=>x.scenarioId===input.scenarioId).length+1).padStart(3,"0");
 const item:BalanceCase={
  id,scenarioId:input.scenarioId,status:"draft",createdAt:stamp(input.now),createdBy:input.actor,
  baseline,candidate,baselineResult:baseResult,candidateResult,
  purpose:required(input.purpose,"分析目的",5),basis:required(input.basis,"输入依据",5),
  history:[{at:input.now,by:input.actor,action:"保存模拟方案草稿",detail:"仅用于水量守恒和约束比选；不发送控制命令"}],
 };
 if(all.some(x=>x.id===id))throw Error("方案编号发生冲突，请先整理已有记录");
 save(storage,[...all,item]);return item;
}
export type BalanceAction="submit"|"adopt"|"reject"|"track"|"close";
export function advanceBalanceCase(storage:LocalStore,id:string,action:BalanceAction,actor:Role,data:{
 note?:string;approvalRef?:string;owner?:string;followUpRef?:string;
 observed?:IntegratedBalanceInput;outcome?:"improved"|"unresolved"|"unchanged";
},now:string):BalanceCase{
 const all=readBalanceCases(storage);
 const index=all.findIndex(x=>x.id===id);
 if(index<0)throw Error("找不到指定方案编号，禁止替换为最新方案");
 const previous=all[index];
 const expected:Record<BalanceAction,BalanceStage>={
  submit:"draft",adopt:"submitted",reject:"submitted",track:"adopted",close:"tracking",
 };
 if(previous.status!==expected[action])throw Error("方案状态不允许执行该操作");
 if(action==="submit"||action==="track")assertCan(actor,"water:proposal");
 else if(actor!=="admin"&&actor!=="manager")throw Error("只有管理岗位可以审核拟采纳和结束复盘");
 const next:BalanceCase={...previous,history:[...previous.history]};
 let detail="";
 const note=short(data.note??"",500);
 if(action==="submit"){
  next.status="submitted";detail=required(note,"提交说明",6);
 }else if(action==="adopt"){
  next.reviewRef=required(data.approvalRef??"","内部研判依据编号",4);
  next.reviewNote=required(note,"人工核查说明",6);
  next.owner=required(data.owner??"","跟踪负责人",2);
  next.status="adopted";
  detail="管理岗位采纳为演示跟踪任务，参考 "+next.reviewRef+"；不代表现场调度审批或自动执行";
 }else if(action==="reject"){
  next.status="rejected";detail=required(note,"不采纳原因",6);
 }else if(action==="track"){
  if(!data.observed)throw Error("跟踪时必须提供当前复核条件");
  const observed={...data.observed};
  const result=assessIntegratedBalance(observed);
  const ref=required(data.followUpRef??"","复核依据",3);
  next.tracking={input:observed,result,evidenceRef:ref,note:required(note,"跟踪说明",6),at:stamp(now)};
  next.status="tracking";detail="补录复核模型结果与依据 "+ref+"；测量数据仍需现场证据";
 }else{
  if(!data.outcome)throw Error("请选择最终结果：改善/未解决/无变化");
  next.outcome=data.outcome;next.closureRef=required(data.followUpRef??"","复盘依据",3);
  next.closureNote=required(note,"复盘说明",8);next.status="closed";
  detail="人工复盘结束；结果："+data.outcome+"；依据 "+next.closureRef+"，不宣称现场自动恢复";
 }
 next.history.push({at:stamp(now),by:actor,action,detail});
 all[index]=next;save(storage,all);return next;
}
