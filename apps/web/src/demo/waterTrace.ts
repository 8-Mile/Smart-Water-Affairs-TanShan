import {assertCan} from "./permissions";
import type {Role,ScenarioId} from "./types";
export const WATER_TRACE_KEY="tanggang-water-trace-v1";
export type WaterTraceStatus="pending"|"reviewed"|"rejected";
export interface WaterTraceRecord {
 id:string;entryId:string;scenarioId:ScenarioId;status:WaterTraceStatus;
 pointLabel:string;destination:string;evidenceRef:string;note:string;
 createdBy:Role;updatedAt:string;reviewedBy?:Role;reviewNote?:string;
 source:"USER_ENTRY";fieldVerified:false;
}
type LocalStore=Pick<Storage,"getItem"|"setItem">;
const txt=(s:string,label:string,n=3)=>{
 const v=s.trim().slice(0,300);if(v.length<n)throw Error(label+"至少"+n+"字");return v;
};
export function readWaterTraces(storage:Pick<Storage,"getItem">,scenario?:ScenarioId):WaterTraceRecord[]{
 try{
  const values=JSON.parse(storage.getItem(WATER_TRACE_KEY)??"[]") as unknown;
  return Array.isArray(values)?values.filter((x):x is WaterTraceRecord=>
   Boolean(x&&typeof x==="object"&&typeof x.entryId==="string"&&typeof x.status==="string"))
   .filter(x=>!scenario||x.scenarioId===scenario).slice(-100):[];
 }catch{return [];}
}
function save(storage:LocalStore,rows:WaterTraceRecord[]):void{
 storage.setItem(WATER_TRACE_KEY,JSON.stringify(rows.slice(-100)));
}
export function submitWaterTrace(storage:LocalStore,data:{
 scenarioId:ScenarioId;entryId:string;pointLabel:string;destination:string;evidenceRef:string;note:string;
 actor:Role;now:string;
}):WaterTraceRecord{
 assertCan(data.actor,"engineering:submit");
 if(!Number.isFinite(Date.parse(data.now)))throw Error("时间无效");
 const all=readWaterTraces(storage);
 const id=data.scenarioId+":"+txt(data.entryId,"水量记录编号");
 const current=all.find(x=>x.id===id);
 if(current?.status==="reviewed")throw Error("已审核的演示映射不能直接覆盖，请走版本核查流程");
 const item:WaterTraceRecord={
  id,entryId:data.entryId,scenarioId:data.scenarioId,status:"pending",
  pointLabel:txt(data.pointLabel,"计量点"),destination:txt(data.destination,"去向/终端"),
  evidenceRef:txt(data.evidenceRef,"图纸或数据引用"),
  note:txt(data.note,"映射说明",5),createdBy:data.actor,updatedAt:data.now,
  source:"USER_ENTRY",fieldVerified:false,
 };
 save(storage,[...all.filter(x=>x.id!==id),item]);return item;
}
export function reviewWaterTrace(storage:LocalStore,id:string,actor:Role,approved:boolean,note:string,now:string):WaterTraceRecord{
 assertCan(actor,"engineering:review");
 const all=readWaterTraces(storage),idx=all.findIndex(x=>x.id===id);
 if(idx<0)throw Error("未找到登记映射，不能凭空审核");
 const existing=all[idx];if(existing.status!=="pending")throw Error("映射已处理，不可重复审核");
 const updated:WaterTraceRecord={
  ...existing,status:approved?"reviewed":"rejected",
  reviewedBy:actor,reviewNote:txt(note,"复核说明",6),updatedAt:now,
  fieldVerified:false, // 内部审阅记录不是现场物理管线验收
 };
 all[idx]=updated;save(storage,all);return updated;
}
