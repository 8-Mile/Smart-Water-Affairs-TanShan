/** V3 engineering baseline, never asserts construction, commissioning, or verified pipe connectivity. */
import type { Role } from "./types";
import { assertCan } from "./permissions";
import { CHECK_ROWS, POINT_ROWS, REQUIREMENT_ROWS, ISSUE_ROWS } from "./engineeringBaseline";

export type EngineeringKind = "check"|"instrument"|"requirement"|"issue";
export type EngineeringState = "unverified"|"submitted"|"reviewed_demo"|"blocked";
export interface EngineeringEntry {
  id:string;kind:EngineeringKind;scope:string;title:string;detail:string;priority:string;
  blocker:string;owner?:string;acceptance?:string;sourceRef:string;
}
export interface EngineeringReview {
  id:string;state:Exclude<EngineeringState,"unverified">;
  evidenceRef:string;note:string;submittedBy:Role;submittedAt:string;reviewedBy?:Role;reviewedAt?:string;
  history:{by:Role;at:string;action:string;note:string}[];
}
export interface EngineeringStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export const ENGINEERING_STORAGE_KEY = "tanggang-engineering-v3-evidence-v1";
export const ENGINEERING_BASELINE = "唐港智慧水务_六工艺软硬件需求与P0工程核查_V1.xlsx";
function rows(raw:string):string[][]{return raw.trim().split("\n").filter(Boolean).map(x=>x.split("|"));}
export const ENGINEERING_CHECKS:EngineeringEntry[]=rows(CHECK_ROWS).map((x,i)=>({
 id:x[0],kind:"check",scope:x[1],title:x[2],detail:"建议牵头方："+x[3]+"；核验后需提交："+x[4],
 priority:"P0",blocker:x[5],owner:x[3],acceptance:x[4],sourceRef:"P0现场核查清单!A"+(i+6),
}));
export const ENGINEERING_POINTS:EngineeringEntry[]=rows(POINT_ROWS).map((x,i)=>({
 id:x[0],kind:"instrument",scope:x[1],title:x[2],detail:x[3],priority:x[5],blocker:x[4],
 sourceRef:"测点及硬件台账!A"+(i+6),
}));
export const ENGINEERING_REQUIREMENTS:EngineeringEntry[]=rows(REQUIREMENT_ROWS).map((x,i)=>({
 id:x[0],kind:"requirement",scope:x[1],title:x[2],detail:x[3],priority:x[4],blocker:x[5],
 sourceRef:"六工艺需求矩阵!A"+(i+6),
}));
export const ENGINEERING_ISSUES:EngineeringEntry[]=rows(ISSUE_ROWS).map((x,i)=>({
 id:x[0],kind:"issue",scope:x[1],title:x[2],detail:x[2],priority:"P0",blocker:x[3],
 sourceRef:"口径冲突与红线!A"+(i+6),
}));
export const ENGINEERING_CATALOG:EngineeringEntry[]=[
 ...ENGINEERING_CHECKS,...ENGINEERING_POINTS,...ENGINEERING_REQUIREMENTS,...ENGINEERING_ISSUES,
];
export const ENGINEERING_STATUS_LABELS:Record<EngineeringState,string>={
 unverified:"待核验",submitted:"资料待复核",reviewed_demo:"DEMO资料已审阅",blocked:"证据不足/退回",
};
export const ENGINEERING_HARDWARE_RULES=[
 {id:"reuse",title:"A · 优先复用",condition:"现有PLC、SCADA、仪表、通信、时标和质量码满足业务验收",decision:"先做授权接入与软件集成，不重复采购"},
 {id:"gap",title:"B · 补足计量",condition:"自动化已验收，但关键液位、流量、压力、水质或电能缺乏可信测量",decision:"按点表与现场安装条件补点、标定、供电和接口"},
 {id:"automation",title:"C · 基础自动化先行",condition:"控制站、联锁、工控网络或HMI尚未安全验收",decision:"优先完成自控工程与FAT/SAT，不让AI直接控制"},
] as const;
export function engineeringEntry(id:string):EngineeringEntry|undefined{return ENGINEERING_CATALOG.find(x=>x.id===id);}
export function relatedEngineering(scope:string,limit=8):EngineeringEntry[]{
 const result=ENGINEERING_CATALOG.filter(x=>x.scope===scope ||
 (scope==="水池供水"&&x.scope==="水池供水（DEMO）"));
 return result.sort((a,b)=>Number(b.priority==="P0")-Number(a.priority==="P0")).slice(0,limit);
}
export function readEngineeringReviews(storage:EngineeringStorage):EngineeringReview[]{
 try {
  const raw:unknown=JSON.parse(storage.getItem(ENGINEERING_STORAGE_KEY)??"[]");
  if(!Array.isArray(raw))return [];
  const ids=new Set(ENGINEERING_CATALOG.map(x=>x.id));
  return (raw as EngineeringReview[]).filter(x=>x&&ids.has(x.id)&&
   ["submitted","reviewed_demo","blocked"].includes(x.state)&&Array.isArray(x.history));
 }catch{return [];}
}
function validText(value:string,name:string,min:number,max:number):string{
 const text=value.trim();
 if(text.length<min||text.length>max)throw new Error(name+"需"+min+"至"+max+"字");
 return text;
}
function storeReviews(storage:EngineeringStorage,reviews:EngineeringReview[]):void{
 storage.setItem(ENGINEERING_STORAGE_KEY,JSON.stringify(reviews.slice(0,ENGINEERING_CATALOG.length)));
}
export function submitEngineeringEvidence(storage:EngineeringStorage,id:string,role:Role,
 evidenceRef:string,note:string,at:string):EngineeringReview{
 assertCan(role,"engineering:submit");
 if(!engineeringEntry(id))throw new Error("未找到工程核查编号");
 const ref=validText(evidenceRef,"图纸号、合同号或现场记录编号",5,120);
 const explanation=validText(note,"核查说明",8,600);
 const previous=readEngineeringReviews(storage);
 const old=previous.find(x=>x.id===id);
 const saved:EngineeringReview={
  id,state:"submitted",evidenceRef:ref,note:explanation,submittedAt:at,submittedBy:role,
  history:[...(old?.history??[]),{by:role,at,action:"提交工程依据待复核",note:ref+"；"+explanation}],
 };
 storeReviews(storage,[saved,...previous.filter(x=>x.id!==id)]);
 return saved;
}
export function reviewEngineeringEvidence(storage:EngineeringStorage,id:string,role:Role,
 decision:"reviewed_demo"|"blocked",note:string,at:string):EngineeringReview{
 assertCan(role,"engineering:review");
 const explanation=validText(note,"复核说明",8,600);
 const all=readEngineeringReviews(storage);
 const existing=all.find(x=>x.id===id);
 if(!existing||existing.state!=="submitted")throw new Error("当前不存在可审核的工程依据提交");
 const saved:EngineeringReview={
  ...existing,state:decision,reviewedAt:at,reviewedBy:role,
  history:[...existing.history,{by:role,at,action:decision==="blocked"?"退回/证据不足":"DEMO资料审阅",note:explanation}],
 };
 storeReviews(storage,[saved,...all.filter(x=>x.id!==id)]);
 return saved;
}
export function engineeringReadiness(reviews:EngineeringReview[]){
 const map=new Map(reviews.map(x=>[x.id,x]));
 return {
  total:ENGINEERING_CHECKS.length,
  submitted:ENGINEERING_CHECKS.filter(x=>map.get(x.id)?.state==="submitted").length,
  reviewedDemo:ENGINEERING_CHECKS.filter(x=>map.get(x.id)?.state==="reviewed_demo").length,
  missing:ENGINEERING_CHECKS.filter(x=>map.get(x.id)?.state!=="reviewed_demo").length,
  fieldApproved:0,
  realControlReleased:false,
 };
}
