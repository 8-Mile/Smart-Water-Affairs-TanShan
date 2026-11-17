import {assertCan} from "./permissions";
import type {Role,ScenarioId} from "./types";

/** 从演示预案模板组织任务，不构成真实已批准应急预案/电话通知/PLC控制。 */
export const EMERGENCY_CASE_KEY="tanggang-emergency-cases-v1";
export type EmergencyKind="supply"|"rain"|"equipment";
export type EmergencyStatus="draft"|"active"|"review"|"closed";
export type EmergencyTaskState="pending"|"done";
export interface EmergencyTask {
 id:string;title:string;role:Role;assignee:string;state:EmergencyTaskState;
 deadlineMinutes:number;dueAt?:string;respondedAt?:string;
 note?:string;evidenceRef?:string;escalations:number;
}
export interface EmergencyCase {
 id:string;scenarioId:ScenarioId;kind:EmergencyKind;eventId?:string;assetId?:string;
 title:string;status:EmergencyStatus;severity:"critical"|"warning";
 planTemplate:string;approvedPlanRef?:string;commandBy?:string;
 resourceAvailability?:string;resourceAssetIds?:string[];
 createdAt:string;createdBy:Role;activatedAt?:string;
 tasks:EmergencyTask[];reviewEvidenceRef?:string;reviewNote?:string;
 history:{at:string;actor:Role;action:string;detail:string}[];
}
type LocalStore=Pick<Storage,"getItem"|"setItem">;
export const EMERGENCY_TEMPLATES:Record<EmergencyKind,{
 label:string;plan:string;tasks:{role:Role;title:string;minutes:number}[];
}>={
 supply:{label:"关键供水中断",plan:"供水异常协同模板（DEMO，尚无现场批准编号）",tasks:[
  {role:"duty",title:"核查告警与影响用水对象",minutes:15},
  {role:"engineer",title:"核查泵组、阀门、压力及备用条件",minutes:30},
  {role:"water",title:"核查环保用水限制和可替代水源",minutes:40},
 ]},
 rain:{label:"极端降雨积水风险",plan:"雨污水应急调蓄模板（DEMO，尚无现场批准编号）",tasks:[
  {role:"duty",title:"复核雨量、池位和设施状态",minutes:15},
  {role:"water",title:"核查处理能力、出水水质和回用途径",minutes:25},
  {role:"engineer",title:"复核排水设备与现场可用资源",minutes:30},
 ]},
 equipment:{label:"重要设备故障",plan:"重要设备故障协同模板（DEMO，尚无现场批准编号）",tasks:[
  {role:"duty",title:"确认故障、通知岗位并核查生产影响",minutes:15},
  {role:"engineer",title:"核查设备历史并形成维修措施",minutes:35},
  {role:"manager",title:"确认生产约束和恢复复核责任",minutes:45},
 ]},
};
function nonempty(v:string,label:string,min=3):string{
 const t=v.trim().slice(0,500);
 if(t.length<min)throw Error(label+"至少"+min+"字");
 return t;
}
export function readEmergencyCases(storage:Pick<Storage,"getItem">,scenario?:ScenarioId):EmergencyCase[]{
 try{
  const rows=JSON.parse(storage.getItem(EMERGENCY_CASE_KEY)??"[]") as unknown;
  return Array.isArray(rows)?rows.filter((c):c is EmergencyCase=>Boolean(c&&typeof c==="object"&&typeof c.id==="string"&&Array.isArray(c.tasks)&&Array.isArray(c.history)))
    .filter(c=>!scenario||c.scenarioId===scenario).slice(-50):[];
 }catch{return [];}
}
function persist(storage:LocalStore,cases:EmergencyCase[]):void{
 storage.setItem(EMERGENCY_CASE_KEY,JSON.stringify(cases.slice(-50)));
}
export function createEmergencyCase(storage:LocalStore,input:{
 scenarioId:ScenarioId;actor:Role;kind:EmergencyKind;title:string;severity:"critical"|"warning";
 eventId?:string;assetId?:string;now:string;
}):EmergencyCase{
 assertCan(input.actor,"emergency:create");
 if(!Number.isFinite(Date.parse(input.now)))throw Error("事件时间无效");
 const all=readEmergencyCases(storage);
 const id="EMG-"+input.scenarioId.slice(4)+"-"+String(all.filter(x=>x.scenarioId===input.scenarioId).length+1).padStart(3,"0");
 if(all.some(x=>x.id===id))throw Error("任务编号冲突");
 const template=EMERGENCY_TEMPLATES[input.kind];
 const draft:EmergencyCase={
  id,scenarioId:input.scenarioId,kind:input.kind,eventId:input.eventId,assetId:input.assetId,
  title:nonempty(input.title,"事件说明",4),severity:input.severity,status:"draft",
  planTemplate:template.plan,createdAt:input.now,createdBy:input.actor,
  tasks:template.tasks.map((t,i)=>({
   id:id+"-T"+(i+1),title:t.title,role:t.role,assignee:"",state:"pending",deadlineMinutes:t.minutes,escalations:0,
  })),
  history:[{at:input.now,actor:input.actor,action:"创建应急草稿",detail:"仅推荐演示预案模板，尚未批准或通知现场"}],
 };
 persist(storage,[...all,draft]);return draft;
}
export type EmergencyAction="activate"|"feedback"|"escalate"|"submit-review"|"close";
export function advanceEmergencyCase(storage:LocalStore,id:string,action:EmergencyAction,actor:Role,
 data:{planRef?:string;commander?:string;assignments?:Record<string,string>;
 resourcesNote?:string;resourceAssetIds?:string[];
 taskId?:string;feedback?:string;evidenceRef?:string;newAssignee?:string;note?:string},now:string
):EmergencyCase{
 const all=readEmergencyCases(storage),index=all.findIndex(c=>c.id===id);
 if(index<0)throw Error("找不到指定应急事件编号");
 const prev=all[index],next:EmergencyCase={...prev,tasks:prev.tasks.map(t=>({...t})),history:[...prev.history]};
 if(!Number.isFinite(Date.parse(now)))throw Error("操作时间无效");
 let detail="";
 if(action==="activate"){
  assertCan(actor,"emergency:review");
  if(prev.status!=="draft")throw Error("只有草稿可以启动");
  next.approvedPlanRef=nonempty(data.planRef??"","已批准预案编号",4);
  next.commandBy=nonempty(data.commander??"","模拟指挥负责人",2);
  next.resourceAvailability=nonempty(data.resourcesNote??"","候选设备和应急资源可用性说明",6);
  next.resourceAssetIds=[...new Set((data.resourceAssetIds??[]).filter(x=>typeof x==="string"&&x.trim()))];
  for(const task of next.tasks){
   task.assignee=nonempty(data.assignments?.[task.id]??"","岗位联络人",2);
   task.dueAt=new Date(Date.parse(now)+task.deadlineMinutes*60000).toISOString();
  }
  next.status="active";next.activatedAt=now;
  detail="人工核对预案依据及候选资源："+next.resourceAvailability+"；没有发送真实通知或工控命令";
 }else if(action==="feedback"){
  assertCan(actor,"emergency:handle");
  if(prev.status!=="active")throw Error("仅在执行中能反馈");
  const task=next.tasks.find(t=>t.id===data.taskId);if(!task)throw Error("未找到任务");
  if(actor!=="admin"&&actor!=="manager"&&actor!==task.role)throw Error("当前岗位不能代替其他岗位反馈");
  if(task.state==="done")throw Error("不能重复完成同一任务");
  task.note=nonempty(data.feedback??"","现场反馈",6);
  task.evidenceRef=nonempty(data.evidenceRef??"","反馈证据编号",3);
  task.respondedAt=now;task.state="done";
  detail=task.title+"，依据："+task.evidenceRef+"；模拟记录非现场实时反馈";
 }else if(action==="escalate"){
  assertCan(actor,"emergency:review");
  if(prev.status!=="active")throw Error("只能升级执行中的任务");
  const task=next.tasks.find(t=>t.id===data.taskId);if(!task||task.state==="done")throw Error("只允许升级未完成的任务");
  if(!task.dueAt||Date.parse(now)<=Date.parse(task.dueAt))throw Error("任务尚未超时，不能触发升级");
  task.assignee=nonempty(data.newAssignee??"","接替负责人",2);
  task.escalations+=1;task.dueAt=new Date(Date.parse(now)+task.deadlineMinutes*60000).toISOString();
  detail="超时升级："+task.title+"，转派 "+task.assignee+"；仅记录本地模拟升级，未发送外部通知";
 }else if(action==="submit-review"){
  assertCan(actor,"emergency:review");
  if(prev.status!=="active"||next.tasks.some(t=>t.state!=="done"))throw Error("全部岗位任务留有反馈证据后才能提交复盘");
  next.status="review";detail=nonempty(data.note??"","提交复盘说明",6);
 }else{
  assertCan(actor,"emergency:review");
  if(prev.status!=="review")throw Error("应急事件尚未进入复盘审核");
  next.reviewNote=nonempty(data.note??"","复盘结论",8);
  next.reviewEvidenceRef=nonempty(data.evidenceRef??"","复盘依据编号",3);
  next.status="closed";detail="完成模拟复盘归档，依据："+next.reviewEvidenceRef;
 }
 next.history.push({at:now,actor,action,detail});all[index]=next;persist(storage,all);return next;
}
export function overdueTasks(item:EmergencyCase,now:string):EmergencyTask[]{
 if(item.status!=="active")return [];
 return item.tasks.filter(t=>t.state!=="done"&&Boolean(t.dueAt)&&Date.parse(now)>Date.parse(t.dueAt!));
}
