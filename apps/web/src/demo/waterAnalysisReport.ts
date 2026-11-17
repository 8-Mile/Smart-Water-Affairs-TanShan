import {assertCan} from "./permissions";
import type {Dashboard,Role,ScenarioId} from "./types";
export const WATER_ANALYSIS_REPORT_KEY="tanggang-water-analysis-reports-v1";
export interface WaterAnalysisReport {
 id:string;scenarioId:ScenarioId;dashboardId:string;dashboardVersion:number;
 title:string;createdAt:string;createdBy:Role;status:"pending_review"|"reviewed";
 source:"MOCK";periods:string[];body:string;reviewNote?:string;reviewedAt?:string;reviewedBy?:Role;
}
type LocalStore=Pick<Storage,"getItem"|"setItem">;
export function readWaterAnalysisReports(storage:Pick<Storage,"getItem">,scenario?:ScenarioId):WaterAnalysisReport[]{
 try {
  const rows=JSON.parse(storage.getItem(WATER_ANALYSIS_REPORT_KEY)??"[]") as unknown;
  return Array.isArray(rows)?rows.filter((x):x is WaterAnalysisReport=>Boolean(x&&typeof x==="object"&&typeof x.id==="string"&&typeof x.body==="string"))
   .filter(x=>!scenario||x.scenarioId===scenario).slice(-30):[];
 }catch{return [];}
}
function persist(storage:LocalStore,cases:WaterAnalysisReport[]):void{
 storage.setItem(WATER_ANALYSIS_REPORT_KEY,JSON.stringify(cases.slice(-30)));
}
export function createWaterAnalysisReport(storage:LocalStore,input:{
 dashboard:Dashboard;scenarioId:ScenarioId;actor:Role;now:string;
}):WaterAnalysisReport{
 assertCan(input.actor,"dashboard:edit:self");
 const dashboard=input.dashboard;
 const chart=dashboard.widgets.find(w=>w.id==="water-ledger-chart"&&w.component==="TrendChart");
 if(!chart)throw Error("只能将带有可核算月度账本图表的已保存看板生成水资源报告");
 const periods=Array.isArray(chart.props.labels)
   ?chart.props.labels.filter((x):x is string=>typeof x==="string"): [];
 if(!periods.length)throw Error("缺少有来源的账本统计周期");
 const series=Array.isArray(chart.props.series)?chart.props.series:[];
 const lines=[
  "# 水资源利用分析（待审核草稿）",
  "来源：本地MOCK账本 / A2UI受控图表；非实际生产计量",
  "关联看板："+dashboard.id+" v"+dashboard.version,
  "账本周期："+periods.join("、")+"（按月；不能作为日/连续30天真实实测）",
  "",
  "## 分口径指标",
 ];
 for(const row of series){
  if(!row||typeof row!=="object")continue;
  const item=row as {name?:unknown;values?:unknown};
  const label=typeof item.name==="string"?item.name:"未命名";
  const values=Array.isArray(item.values)?item.values.map(v=>typeof v==="number"?v.toLocaleString("zh-CN")+" m³":"缺数"):[];
  lines.push("- "+label+"："+values.map((v,i)=>periods[i]+" "+v).join("；"));
 }
 lines.push("","## 口径与限制",
  "- 自来水为源端补水进项，中水为处理后外供出项，雨水为收集入池进项；不同环节不可直接相加。",
  "- 循环回路缺独立计量，不得由雨水入池、中水外供或处理站出水推算。",
  "- 末端实际用水、计量点、单位电耗及真实管网连通尚需现场工程资料与实测。",
  "- 本文为AI辅助编制的本地模拟分析初稿，须经授权人员审核后方可内部使用。");
 const all=readWaterAnalysisReports(storage);
 const id="WAR-"+input.scenarioId.slice(4)+"-"+String(all.filter(x=>x.scenarioId===input.scenarioId).length+1).padStart(3,"0");
 if(all.some(x=>x.id===id))throw Error("报告编号冲突");
 const item:WaterAnalysisReport={
  id,scenarioId:input.scenarioId,dashboardId:dashboard.id,dashboardVersion:dashboard.version,
  title:dashboard.name+" · 水资源分析",createdAt:input.now,createdBy:input.actor,
  status:"pending_review",source:"MOCK",periods,body:lines.join("\n"),
 };
 persist(storage,[...all,item]);return item;
}
export function reviewWaterAnalysisReport(storage:LocalStore,id:string,actor:Role,note:string,now:string):WaterAnalysisReport{
 assertCan(actor,"handover:review");
 const all=readWaterAnalysisReports(storage),index=all.findIndex(x=>x.id===id);
 if(index<0)throw Error("指定分析报告不存在");
 const current=all[index];
 if(current.status!=="pending_review")throw Error("报告已审核，不可重复审批");
 if(note.trim().length<6)throw Error("请至少填写6个字的报告审核依据");
 const next:WaterAnalysisReport={
  ...current,status:"reviewed",reviewNote:note.trim().slice(0,500),reviewedAt:now,reviewedBy:actor,
 };
 all[index]=next;persist(storage,all);return next;
}
