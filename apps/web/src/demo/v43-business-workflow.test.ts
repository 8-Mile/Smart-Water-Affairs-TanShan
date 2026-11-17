import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_INTEGRATED_BALANCE} from "./integratedBalance";
import {createBalanceCase,advanceBalanceCase,readBalanceCases} from "./balanceWorkflow";
import {createEmergencyCase,advanceEmergencyCase,overdueTasks,readEmergencyCases} from "./emergencyWorkflow";
import {submitWaterTrace,reviewWaterTrace,readWaterTraces} from "./waterTrace";
import {composeWaterLedgerSurface} from "./waterSurface";
import {applyMessages,surfaceToWidgets} from "./a2ui";
import {createWaterAnalysisReport,reviewWaterAnalysisReport,readWaterAnalysisReports} from "./waterAnalysisReport";
import {buildSeed} from "./seed";
import type {Dashboard} from "./types";
function storage(){
 const data=new Map<string,string>();
 return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
}
const T0="2026-11-17T08:00:00.000Z";
const T1="2026-11-17T08:50:00.000Z";
test("P0 rain: compare→submit→manual adoption→tracking→review, scenario and source survive",()=>{
 const local=storage();
 const candidate={...DEFAULT_INTEGRATED_BALANCE,rainMm:100,treatmentM3h:40};
 const draft=createBalanceCase(local,{scenarioId:"SCN-RAIN",actor:"water",candidate,purpose:"强降雨污染水处置核查",basis:"演示参数仅供人工核对",now:T0});
 assert.equal(draft.status,"draft");
 assert.ok(draft.candidateResult.pollutionOverflowM3>=0);
 assert.equal(readBalanceCases(local,"SCN-NORMAL").length,0);
 const submitted=advanceBalanceCase(local,draft.id,"submit","water",{note:"请管理者核对处理限制"},T0);
 assert.equal(submitted.status,"submitted");
 assert.throws(()=>advanceBalanceCase(local,draft.id,"adopt","water",{note:"同意采纳使用",approvalRef:"TEST-01",owner:"值班组"},T0),/只有管理岗位/);
 const adopted=advanceBalanceCase(local,draft.id,"adopt","manager",
  {note:"仅内部演示跟踪不下发指令",approvalRef:"MOCK-APPROVAL-01",owner:"值班负责人"},T0);
 assert.equal(adopted.status,"adopted");
 assert.throws(()=>advanceBalanceCase(local,draft.id,"close","manager",{note:"不应该跳过跟踪"},T1),/状态/);
 const tracked=advanceBalanceCase(local,draft.id,"track","water",
  {note:"已人工记录复核条件并重算",followUpRef:"MANUAL-1",observed:{...candidate,treatmentM3h:100}},T1);
 assert.equal(tracked.status,"tracking");assert.equal(tracked.tracking?.input.treatmentM3h,100);
 const closed=advanceBalanceCase(local,draft.id,"close","manager",
  {note:"仍需现场确认是否真正改善",followUpRef:"REVIEW-001",outcome:"unresolved"},T1);
 assert.equal(closed.status,"closed");assert.equal(closed.outcome,"unresolved");assert.equal(closed.history.length,5);
});
test("P0 emergency: no activation without approved plan, role feedback, overdue and escalation",()=>{
 const local=storage();
 const draft=createEmergencyCase(local,{actor:"duty",scenarioId:"SCN-PUMP-FAULT",
  kind:"supply",title:"中压供水影响联合处置",severity:"critical",eventId:"ALM-P002-01",assetId:"asset-p002",now:T0});
 assert.equal(draft.status,"draft");
 assert.equal(readEmergencyCases(local,"SCN-NORMAL").length,0);
 assert.throws(()=>advanceEmergencyCase(local,draft.id,"activate","manager",{planRef:"",commander:"张某"},T0),/编号/);
 const assigned=Object.fromEntries(draft.tasks.map(t=>[t.id,t.role+"值班联系人"]));
 const started=advanceEmergencyCase(local,draft.id,"activate","manager",
  {planRef:"TEST-PLAN-01",commander:"应急指挥",assignments:assigned,
   resourcesNote:"备用泵及联系人仍需要现场确认",resourceAssetIds:["asset-p002"]},T0);
 assert.equal(started.status,"active");
 assert.equal(overdueTasks(started,T1).length,3);
 assert.throws(()=>advanceEmergencyCase(local,draft.id,"feedback","water",
  {taskId:started.tasks[0].id,feedback:"复核相关设备与人员",evidenceRef:"CHK-1"},T1),/岗位/);
 const upgraded=advanceEmergencyCase(local,draft.id,"escalate","manager",
  {taskId:started.tasks[0].id,newAssignee:"新的值班联系人"},T1);
 assert.equal(upgraded.tasks[0].escalations,1);
 for(const task of started.tasks){
  advanceEmergencyCase(local,draft.id,"feedback",task.role,
   {taskId:task.id,feedback:"完成模拟核查并记录对应依据",evidenceRef:"CHECK-"+task.id},T1);
 }
 assert.equal(overdueTasks(readEmergencyCases(local)[0],T1).length,0);
 const reviewed=advanceEmergencyCase(local,draft.id,"submit-review","manager",
  {note:"记录岗位反馈与影响范围"},T1);
 assert.equal(reviewed.status,"review");
 const completed=advanceEmergencyCase(local,draft.id,"close","manager",
  {note:"模拟复盘已完成但现场恢复需独立确认",evidenceRef:"AUDIT-001"},T1);
 assert.equal(completed.status,"closed");
 assert.equal(completed.history.length,8);
});
test("P1 water trace: only verified DEMO documentation, no false field verification",()=>{
 const local=storage();
 const entry=submitWaterTrace(local,{scenarioId:"SCN-NORMAL",entryId:"LEDGER-001",
  pointLabel:"人工登记计量点-01",destination:"资料中记载的终端",evidenceRef:"DRAWING-01",note:"资料待现场确认",
  actor:"water",now:T0});
 assert.equal(entry.status,"pending");assert.equal(entry.fieldVerified,false);
 assert.throws(()=>reviewWaterTrace(local,entry.id,"duty",true,"核查依据充分",T1),/无权/);
 const reviewed=reviewWaterTrace(local,entry.id,"manager",true,"资料审核通过但需现场核实",T1);
 assert.equal(reviewed.status,"reviewed");assert.equal(reviewed.fieldVerified,false);
 assert.throws(()=>submitWaterTrace(local,{scenarioId:"SCN-NORMAL",entryId:"LEDGER-001",
  pointLabel:"覆盖计量点",destination:"其他终端",evidenceRef:"MOCK-2",note:"覆盖旧审核",actor:"water",now:T1}),/不能直接覆盖/);
 assert.equal(readWaterTraces(local,"SCN-NORMAL").length,1);
});
test("P1 water A2UI: monthly accounting chart is valid, daily requested case warns, report references dashboard version",()=>{
 const seed=buildSeed("SCN-NORMAL");
 const composed=composeWaterLedgerSurface(seed.ledger,"bar","生成近30天三类水资源使用趋势，并加入含矿污水处理量对比");
 assert.equal(composed.rejected,false);
 const applied=applyMessages(null,composed.messages,"admin");
 assert.equal(applied.rejected,false);
 assert.ok(applied.surface);
 const components=applied.surface!.components;
 const chart=components.find(x=>x.id==="water-ledger-chart");
 assert.equal(chart?.component,"TrendChart");
 assert.deepEqual((chart?.props?.series as {name:string}[]).map(s=>s.name),[
  "自来水源端补水（进项）","中水处理后外供（出项）","雨水收集入池（进项）",
  "含矿污水处理过程出站（非最终回用）"]);
 assert.ok(components.some(x=>x.id==="water-time-grain-warning"));
 assert.ok(components.some(x=>x.id==="water-circulation-missing"));
 const local=storage();
 const widgets=surfaceToWidgets(applied.surface!);
 const dashboard:Dashboard={id:"dash-water-test",name:"水资源分类分析",ownerId:"demo-user",
  ownerRole:"admin",scope:"personal",widgets,version:2,createdAt:T0,updatedAt:T0};
 const report=createWaterAnalysisReport(local,{dashboard,scenarioId:"SCN-NORMAL",actor:"admin",now:T0});
 assert.equal(report.status,"pending_review");assert.equal(report.dashboardVersion,2);
 assert.match(report.body,/不能作为日\/连续30天/);
 assert.match(report.body,/循环回路缺独立计量/);
 assert.throws(()=>reviewWaterAnalysisReport(local,report.id,"duty","已经审核通过",T1),/无权/);
 const final=reviewWaterAnalysisReport(local,report.id,"manager","核对月度账本和缺数说明",T1);
 assert.equal(final.status,"reviewed");assert.equal(readWaterAnalysisReports(local)[0].dashboardId,"dash-water-test");
});
