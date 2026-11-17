/** V3.8 read-only role action index: neither a new workflow nor a personal inbox. */
import {can,type Action} from "./permissions";
import type {Alarm,Asset,Role,WorkOrder} from "./types";
import {mayClose,type DutyEvent} from "./unattended";

export type QueueOrigin="alarm"|"workorder"|"duty";
export type QueueLevel="critical"|"high"|"medium"|"low";
export interface RoleQueueTask {
 id:string;origin:QueueOrigin;sourceId:string;assetId:string;assetLabel:string;
 title:string;actionLabel:string;statusLabel:string;level:QueueLevel;at:string;
 to:{path:string;query:Record<string,string>};
}
export type IntegrityKind="missing_asset"|"missing_order"|"mismatched_asset"|"post_archive_review"|"missing_alarm";
export interface WorkflowIntegrityIssue {
 id:string;kind:IntegrityKind;sourceId:string;label:string;detail:string;
 assetId?:string;to:{path:string;query:Record<string,string>};
}
export interface RoleQueueResult {
 tasks:RoleQueueTask[];issues:WorkflowIntegrityIssue[];
 sourceCounts:{alarms:number;duty:number;orders:number};
}
const orderStages:Partial<Record<WorkOrder["status"],{permission:Action;action:string}>>={
 draft:{permission:"workorder:create",action:"提交草稿待派单"},
 pending_dispatch:{permission:"workorder:handle",action:"接单并填写负责人"},
 in_progress:{permission:"workorder:handle",action:"登记处理结果"},
 pending_acceptance:{permission:"workorder:accept",action:"验收或退回"},
};
const orderStatus:Record<WorkOrder["status"],string>={
 draft:"草稿",pending_dispatch:"待派单",in_progress:"维修中",
 pending_acceptance:"待验收",archived:"已归档",cancelled:"已取消",
};
const dutyStages:Partial<Record<DutyEvent["status"],string>>={
 pending_verification:"核查并确认",
 acknowledged:"开始处置",
 processing:"申请恢复验证",
 ready_to_close:"核验后人工关闭",
};
const levelRank:Record<QueueLevel,number>={critical:0,high:1,medium:2,low:3};
const orderLevel:Record<WorkOrder["priority"],QueueLevel>={
 urgent:"critical",high:"high",medium:"medium",low:"low",
};
const alarmLevel:Record<Alarm["level"],QueueLevel>={
 critical:"critical",warning:"high",info:"low",
};
const validAt=(at:string)=>{const n=Date.parse(at);return Number.isFinite(n)?n:0;};

export function buildRoleQueue(
 role:Role,alarms:readonly Alarm[],workorders:readonly WorkOrder[],
 dutyEvents:readonly DutyEvent[],assets:readonly Pick<Asset,"id"|"code"|"name"|"archived">[],
):RoleQueueResult{
 const assetMap=new Map(assets.map(a=>[a.id,a]));
 const orderMap=new Map(workorders.map(o=>[o.id,o]));
 const alarmMap=new Map(alarms.map(a=>[a.id,a]));
 const assetValid=(id:string)=>{const a=assetMap.get(id);return !!a&&!a.archived;};
 const assetLabel=(id:string)=>{
  const a=assetMap.get(id);
  return a?a.code+" · "+a.name:"设备不存在："+id;
 };
 const tasks:RoleQueueTask[]=[];
 const issues:WorkflowIntegrityIssue[]=[];
 const issueKeys=new Set<string>();
 function issue(x:WorkflowIntegrityIssue){
  if(issueKeys.has(x.id))return;
  issueKeys.add(x.id);issues.push(x);
 }
 const assetTo=(id:string)=>({
  path:"/operations/asset-workspace",query:{assetId:id,tab:"events"},
 });
 const orderTo=(id:string)=>({path:"/operations/workorders",query:{workOrderId:id}});
 for(const order of workorders){
  const a=assetMap.get(order.assetId);
  if(!a)issue({id:"order:asset:"+order.id,kind:"missing_asset",sourceId:order.id,
   label:"工单 "+order.code+" 设备引用失效",detail:"先核实原设备，不能指派到另一台设备。",
   to:orderTo(order.id)});
  if(order.alarmId){
   const linked=alarmMap.get(order.alarmId);
   if(!linked)issue({id:"order:alarm:"+order.id,kind:"missing_alarm",sourceId:order.id,
    label:"工单 "+order.code+" 告警引用失效",detail:"原告警不存在；不补造证据。",
    assetId:order.assetId,to:orderTo(order.id)});
   else if(linked.assetId!==order.assetId)issue({
    id:"order:mismatch:"+order.id,kind:"mismatched_asset",sourceId:order.id,
    label:"工单 "+order.code+" 与告警设备不一致",detail:"需人工核查原始绑定。",
    assetId:order.assetId,to:orderTo(order.id)});
   else if(linked.workOrderId&&linked.workOrderId!==order.id)issue({
    id:"order:conflict:"+order.id,kind:"mismatched_asset",sourceId:order.id,
    label:"工单 "+order.code+" 与告警所指工单不一致",detail:"需核实原引用，不合并工单。",
    assetId:order.assetId,to:orderTo(order.id)});
  }
  const stage=orderStages[order.status];
  if(stage&&assetValid(order.assetId)&&can(role,stage.permission))tasks.push({
   id:"order:"+order.id,origin:"workorder",sourceId:order.id,
   assetId:order.assetId,assetLabel:assetLabel(order.assetId),
   title:order.code+" · "+order.title,actionLabel:stage.action,statusLabel:orderStatus[order.status],
   level:orderLevel[order.priority],at:order.history.at(-1)?.at??order.createdAt,to:orderTo(order.id),
  });
 }
 for(const alarm of alarms){
  const a=assetMap.get(alarm.assetId);
  if(!a)issue({id:"alarm:asset:"+alarm.id,kind:"missing_asset",sourceId:alarm.id,
   label:"告警 "+alarm.code+" 设备引用失效",detail:"先核实原设备，不改写事件。",
   to:{path:"/operations/events",query:{tab:"alarms",alarmId:alarm.id}}});
  if(alarm.workOrderId){
   const linked=orderMap.get(alarm.workOrderId);
   if(!linked)issue({id:"alarm:order:"+alarm.id,kind:"missing_order",sourceId:alarm.id,
    label:"告警 "+alarm.code+" 原工单引用失效",
    detail:"工单ID不可用；不等于已处理，也不能无提示重复建单。",
    assetId:alarm.assetId,to:assetTo(alarm.assetId)});
   else if(linked.assetId!==alarm.assetId)issue({
    id:"alarm:mismatch:"+alarm.id,kind:"mismatched_asset",sourceId:alarm.id,
    label:"告警 "+alarm.code+" 与工单设备不一致",
    detail:"需人工核对设备与工单来源，不自动修改绑定。",
    assetId:alarm.assetId,to:assetTo(alarm.assetId)});
   else if(linked.status==="archived"&&alarm.status!=="closed")issue({
    id:"alarm:post-archive:"+alarm.id,kind:"post_archive_review",sourceId:alarm.id,
    label:"告警 "+alarm.code+" 仍未关闭",
    detail:"工单已归档，但告警独立；需核查现场恢复依据，不代表原工单办理有错。",
    assetId:alarm.assetId,to:assetTo(alarm.assetId)});
  }
  if(alarm.status==="acknowledged"&&assetValid(alarm.assetId)&&can(role,"alarm:close")&&
   (!alarm.workOrderId||(orderMap.get(alarm.workOrderId)?.status==="archived"&&
     orderMap.get(alarm.workOrderId)?.assetId===alarm.assetId))){
   tasks.push({
    id:"alarm-close:"+alarm.id,origin:"alarm",sourceId:alarm.id,
    assetId:alarm.assetId,assetLabel:assetLabel(alarm.assetId),title:alarm.title,
    actionLabel:"人工核查依据后关闭",statusLabel:"已确认待独立关闭",
    level:alarmLevel[alarm.level],at:alarm.occurredAt,
    to:{path:"/operations/events",query:{tab:"alarms",alarmId:alarm.id}},
   });
  }
  if(alarm.status==="active"&&assetValid(alarm.assetId)&&can(role,"alarm:ack"))tasks.push({
   id:"alarm:"+alarm.id,origin:"alarm",sourceId:alarm.id,
   assetId:alarm.assetId,assetLabel:assetLabel(alarm.assetId),title:alarm.title,
   actionLabel:"确认并核查告警",statusLabel:"活动告警",
   level:alarmLevel[alarm.level],at:alarm.occurredAt,to:assetTo(alarm.assetId),
  });
 }
 for(const duty of dutyEvents){
  const a=assetMap.get(duty.assetId);
  const to={path:"/operations/events",query:{tab:"duty",eventId:duty.id}};
  if(!a)issue({id:"duty:asset:"+duty.id,kind:"missing_asset",sourceId:duty.id,
   label:"巡查 "+duty.id+" 设备引用失效",detail:"不能随意替换来源设备。",to});
  if(duty.workOrderId){
   const linked=orderMap.get(duty.workOrderId);
   if(!linked)issue({id:"duty:order:"+duty.id,kind:"missing_order",sourceId:duty.id,
    label:"巡查 "+duty.id+" 工单不可用",detail:"核对原工单，不能重复派单。",
    assetId:duty.assetId,to});
   else if(linked.assetId!==duty.assetId)issue({
    id:"duty:mismatch:"+duty.id,kind:"mismatched_asset",sourceId:duty.id,
    label:"巡查 "+duty.id+" 与工单设备不一致",
    detail:"需核实事件来源，不自动改写设备。",assetId:duty.assetId,to});
  }
  const action=dutyStages[duty.status];
  if(action&&assetValid(duty.assetId)&&can(role,"unattended:confirm")){
   // Closing requires the original recovery counter and (for pressure) an accepted work order.
   if(duty.status==="ready_to_close"&&!mayClose(duty))continue;
   if(duty.status==="ready_to_close"&&duty.kind==="low_pressure"&&
    (!duty.workOrderId||orderMap.get(duty.workOrderId)?.status!=="archived"))continue;
   tasks.push({id:"duty:"+duty.id,origin:"duty",sourceId:duty.id,
    assetId:duty.assetId,assetLabel:assetLabel(duty.assetId),title:duty.title,
    actionLabel:action,statusLabel:duty.status,
    level:duty.level==="critical"?"critical":"high",at:duty.lastSeen,to});
  }
 }
 tasks.sort((a,b)=>levelRank[a.level]-levelRank[b.level]||
  validAt(a.at)-validAt(b.at)||a.id.localeCompare(b.id));
 return {tasks,issues:issues.sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)),
  sourceCounts:{alarms:tasks.filter(t=>t.origin==="alarm").length,
   duty:tasks.filter(t=>t.origin==="duty").length,
   orders:tasks.filter(t=>t.origin==="workorder").length}};
}
export interface RoleShortcut {label:string;hint:string;path:string;permission:Action}
const shortcuts:Record<Role,RoleShortcut[]>={
 duty:[
  {label:"运行事件",hint:"告警确认与巡查处置",path:"/operations/events",permission:"process:read"},
  {label:"工单与巡检",hint:"查看草稿及关联工单",path:"/operations/workorders",permission:"process:read"},
  {label:"交班报告",hint:"生成并提交交班草稿",path:"/data/reports",permission:"handover:save"},
 ],
 engineer:[
  {label:"设备工作台",hint:"设备状态与维修履历",path:"/operations/asset-workspace",permission:"process:read"},
  {label:"工单办理",hint:"接单及填写处理结果",path:"/operations/workorders",permission:"workorder:handle"},
  {label:"设备健康",hint:"规则评分与趋势核查",path:"/decision/health",permission:"process:read"},
 ],
 manager:[
  {label:"工单验收",hint:"核查处理记录与验收",path:"/operations/workorders?status=pending_acceptance",permission:"workorder:accept"},
  {label:"经营总览",hint:"港区运行与关键指标",path:"/overview",permission:"process:read"},
  {label:"工程缺口",hint:"现场核查条件与证据",path:"/engineering/registry",permission:"engineering:review"},
 ],
 water:[
  {label:"港口环保水链",hint:"分区收集到合法去向",path:"/water/port-chain",permission:"process:read"},
  {label:"水源优化",hint:"待核实多水源方案",path:"/water/multi-source",permission:"water:proposal"},
  {label:"工程底账",hint:"校核池容、测点及证据",path:"/engineering/registry",permission:"engineering:submit"},
 ],
 admin:[
  {label:"管理工作台",hint:"权限与角色配置",path:"/admin/roles",permission:"admin:write"},
  {label:"设备工作台",hint:"设备证据与维修流程",path:"/operations/asset-workspace",permission:"process:read"},
  {label:"运行事件",hint:"完整事件与业务处置",path:"/operations/events",permission:"process:read"},
 ],
 viewer:[
  {label:"综合总览",hint:"查看模拟运行概况",path:"/overview",permission:"process:read"},
  {label:"事件中心",hint:"只读核查证据与状态",path:"/operations/events",permission:"process:read"},
  {label:"设备档案",hint:"查看可访问的设备资料",path:"/archives",permission:"process:read"},
 ],
};
export function roleShortcuts(role:Role):RoleShortcut[]{
 return shortcuts[role].filter(entry=>can(role,entry.permission));
}
