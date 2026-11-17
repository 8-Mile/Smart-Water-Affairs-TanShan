/**
 * V3.9 presentation guide. Navigation + explanation only.
 * Never performs business-state writes, resets scenarios, or fabricates results.
 */
import {defineStore} from "pinia";
import {computed,ref} from "vue";
import type {Role,ScenarioId} from "./types";

export type TourId="storm"|"fault"|"cost";
export type TourStepKind="storm-model"|"storm-basis"|"storm-evidence"|
 "fault-start"|"fault-detect"|"fault-asset"|"fault-repair"|"fault-accept"|"fault-close"|
 "cost-source"|"cost-compare";
export interface TourStep{
 id:TourStepKind;name:string;role?:Role;
 instruction:string;context:string;action:string;
}
export interface TourDefinition{
 id:TourId;label:string;objective:string;boundary:string;
 steps:TourStep[];
}
export const TOUR_DEFINITIONS:TourDefinition[]=[
 {id:"storm",label:"暴雨污染水",objective:"证明污染径流的收集、调蓄和处置风险如何被看清。",
  boundary:"各池与六套工艺不预设实体连通；库容、管网、合规去向尚待工程核实。",
  steps:[
   {id:"storm-model",name:"暴雨情景测算",role:"water",instruction:"选强降雨 60mm，查看污染径流来水、处理能力与未收集风险。",context:"不是所有雨水都必须处理；重点识别污染汇水范围和实际处置能力。",action:"进入污染水业务链"},
   {id:"storm-basis",name:"追查逐池工程依据",role:"water",instruction:"核查逐池编号、库容与水路关系是否有真实图纸和现场证据。",context:"未确认的池容和回用途径不能按已建成设施讲解。",action:"查看工程底账"},
   {id:"storm-evidence",name:"返回模型并留存结果",role:"water",instruction:"回到污染水业务链，按当前情景重新计算并保存一次模拟分析快照。",context:"快照只保存演示计算和未核条件，不是污水外排审批或设备调度指令。",action:"返回业务链保存快照"},
  ]},
 {id:"fault",label:"供水泵组异常",objective:"展示异常发现、设备定位、工单维修、验收及告警独立复核。",
  boundary:"场景与传感器值为MOCK；工单完成不等于设备实际恢复，告警需另行人工核查。",
  steps:[
   {id:"fault-start",name:"准备故障演示场景",role:"admin",instruction:"明确启用“泵组故障”模拟场景，确认 P-002 异常数据。不会清理已有记录。",context:"只切换模拟场景，原演示记录分别保存在各场景下。",action:"查看首页故障态"},
   {id:"fault-detect",name:"值班员查看待办",role:"duty",instruction:"查看当前岗位可以确认的活动告警，从真实列表进入 P-002 设备。",context:"事件总数不是个人待办数；值班员只能执行被授予的操作。",action:"进入值守事件中心"},
   {id:"fault-asset",name:"定位设备并确认异常",role:"duty",instruction:"查看 P-002 的测点和工单关联；定位原告警 ALM-P002-01，并按角色权限人工确认。",context:"确认只代表已接收告警，不等于已恢复。",action:"进入 P-002 设备工作台"},
   {id:"fault-repair",name:"运维记录维修结果",role:"engineer",instruction:"打开原关联工单 WO-2026-014，提交模拟故障原因和处理措施。",context:"使用原工单状态机和证据编号；不自动派工或控制设备。",action:"打开原关联工单"},
   {id:"fault-accept",name:"管理者验收工单",role:"manager",instruction:"由管理者对已完成的工单验收归档；注意原告警应仍独立存在。",context:"维修归档和报警复归是两个不同业务事实。",action:"进入工单验收"},
   {id:"fault-close",name:"独立核查告警关闭",role:"manager",instruction:"核对原关联工单并填写模拟复测依据，人工决定是否关闭告警。",context:"复测依据是人工演示输入，不是现场 SCADA 认证。",action:"查看原告警核查"},
  ]},
 {id:"cost",label:"三水源与成本",objective:"从水源匹配生成有编号的方案，再复算增量处理和输配成本。",
  boundary:"雨水、中水、自来水价格、供水路径、耗电均是演示假设，不承诺真实节约。",
  steps:[
   {id:"cost-source",name:"选择水源并保存方案",role:"water",instruction:"核对水质、可用水量与用途优先级，计算后保存“待审核供水建议”草稿。",context:"只有满足模拟供水约束的草稿才能用于后续成本核算。",action:"进入水源匹配"},
   {id:"cost-compare",name:"按原草稿编号核算成本",role:"water",instruction:"使用本轮保存的 WS 草稿编号，人工确认导入，重新计算费用与可比条件，并保存净效益草稿。",context:"按草稿输入重算，不复制旧节约金额；若没有完整成本口径应显示不可比。",action:"打开指定草稿成本核算"},
  ]},
];
export function tourDefinition(id:TourId):TourDefinition{
 return TOUR_DEFINITIONS.find(x=>x.id===id)!;
}
export function tourTarget(
 kind:TourStepKind,wsId?:string,
):{path:string;query?:Record<string,string>}|null{
 switch(kind){
  case "storm-model":case "storm-evidence":return {path:"/water/port-chain",query:{scenario:"storm"}};
  case "storm-basis":return {path:"/engineering/registry",query:{focus:"basins"}};
  case "fault-start":return {path:"/overview"};
  case "fault-detect":return {path:"/operations/events",query:{focus:"tasks"}};
  case "fault-asset":return {path:"/operations/asset-workspace",query:{assetId:"asset-p002",tab:"events"}};
  case "fault-repair":case "fault-accept":return {path:"/operations/workorders",query:{workOrderId:"wo-2026-014"}};
  case "fault-close":return {path:"/operations/events",query:{tab:"alarms",alarmId:"ALM-P002-01"}};
  case "cost-source":return {path:"/water/multi-source"};
  case "cost-compare":return wsId?{path:"/water/green-benefit",query:{supplyDraftId:wsId}}:null;
 }
}
interface TourRecord{
 id:TourId;step:number;
 previousRole:Role;previousScenario:ScenarioId;
 baselineSupplyIds:string[];baselineBenefitIds:string[];
 baselineSnapshotId:string;
}
const TOUR_SESSION_KEY="tanggang-v39-demo-tour-session";
function validRecord(value:unknown):value is TourRecord{
 if(!value||typeof value!=="object")return false;
 const v=value as Partial<TourRecord>;
 return TOUR_DEFINITIONS.some(x=>x.id===v.id)&&typeof v.step==="number"&&Number.isInteger(v.step)&&
 v.step>=0&&v.step<tourDefinition(v.id!).steps.length&&
 typeof v.previousRole==="string"&&typeof v.previousScenario==="string"&&
 Array.isArray(v.baselineSupplyIds)&&Array.isArray(v.baselineBenefitIds)&&
 typeof v.baselineSnapshotId==="string";
}
function load():TourRecord|null{
 try{const raw=sessionStorage.getItem(TOUR_SESSION_KEY);if(!raw)return null;
  const value:unknown=JSON.parse(raw);return validRecord(value)?value:null;
 }catch{return null;}
}
function save(value:TourRecord|null){
 try{if(value)sessionStorage.setItem(TOUR_SESSION_KEY,JSON.stringify(value));
  else sessionStorage.removeItem(TOUR_SESSION_KEY);}catch{ /* navigation remains usable */ }
}
export const useDemoTour=defineStore("demo-tour",()=>{
 const record=ref<TourRecord|null>(load());
 const launcherOpen=ref(false);
 const minimized=ref(false);
 const definition=computed(()=>record.value?tourDefinition(record.value.id):null);
 const step=computed(()=>definition.value?.steps[record.value?.step??0]??null);
 function start(id:TourId,role:Role,scenario:ScenarioId,
  baselineSupplyIds:string[],baselineBenefitIds:string[],snapshotId:string){
  record.value={id,step:0,previousRole:role,previousScenario:scenario,
   baselineSupplyIds:[...baselineSupplyIds],baselineBenefitIds:[...baselineBenefitIds],
   baselineSnapshotId:snapshotId};
  launcherOpen.value=false;minimized.value=false;save(record.value);
 }
 function move(next:number){
  if(!record.value||next<0||next>=tourDefinition(record.value.id).steps.length)return;
  record.value={...record.value,step:next};
  save(record.value);minimized.value=false;
 }
 function stop(){record.value=null;save(null);minimized.value=false;}
 return {record,launcherOpen,minimized,definition,step,start,move,stop};
});

/** Notify the open presenter of a successful write in an existing business page.
 * The event is a UI invalidation hint, not evidence or a business audit record. */
export const DEMO_EVIDENCE_UPDATED = "tanggang-demo-evidence-updated";
export function notifyDemoEvidenceUpdated():void{
 if(typeof window!=="undefined")window.dispatchEvent(new Event(DEMO_EVIDENCE_UPDATED));
}
