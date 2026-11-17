import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHandoverReport, isHandoverRequest, readHandoverReports, reviewHandoverReport,
  saveHandoverDraft, HANDOVER_STORAGE_KEY,
  type HandoverInput,
} from "./handover";
import type { Asset, Alarm, WorkOrder } from "./types";
import type { DutyEvent, PatrolRecord } from "./unattended";

const pump: Asset = {
  id:"asset-p002",code:"P-002",name:"中压供水2号泵",subsystemId:"medium-pressure",
  type:"离心泵",status:"running",source:"MOCK",area:"north",runtimeHours:2250,
  startCount:320,archived:false,
};
const checked:PatrolRecord = {
  id:"PAT-00009",at:"2026-11-16T10:20:00.000Z",subsystemId:"medium-pressure",
  mode:"normal",result:"normal",
  checks:[
    {id:"telemetry",name:"压力数据质量",result:"normal",value:"有效",note:"MOCK采样",source:"MOCK"},
    {id:"pressure",name:"2号泵出口压力",result:"normal",value:"1.20 MPa",note:"演示阈值",source:"MOCK"},
  ],
};
const duty:DutyEvent = {
  id:"UT-00001",subsystemId:"medium-pressure",assetId:"asset-p002",
  kind:"low_pressure",title:"供水压力异常",level:"warning",
  status:"pending_verification",firstSeen:"2026-11-16T10:15:00Z",lastSeen:"2026-11-16T10:19:00Z",
  occurrences:2,validRecoveryChecks:0,detail:"P-002压力低，需要核实",evidence:[],history:[],
};
const alarm:Alarm = {
  id:"alarm-1",code:"ALM-001",assetId:"asset-p002",subsystemId:"medium-pressure",
  kind:"production",level:"warning",title:"压力低",detail:"关联P-002",
  occurredAt:"2026-11-16T10:15:00Z",status:"active",
};
const order:WorkOrder = {
  id:"wo-1",code:"WO-001",title:"P-002检查任务",assetId:"asset-p002",
  source:"inspection",evidenceIds:["UT-00001"],symptom:"压力低",suggestion:"现场核实",
  status:"pending_dispatch",priority:"medium",createdBy:"duty",createdAt:"2026-11-16T10:20:00Z",history:[],
};
const input = ():HandoverInput=>({
  scenarioId:"SCN-NORMAL",referenceTime:"2026-11-15T12:00:00.000Z",
  preparedAt:"2026-11-16T10:30:00.000Z",preparedBy:"duty",
  patrol:{...checked,checks:[...checked.checks]},activeEvents:[],alarms:[],workorders:[],
  healthAsset:{...pump},healthReadings:{vibration:null,temperature:null,current:null},
  totalSubsystems:6,
});
function memory() {
  const data = new Map<string,string>();
  return { data, storage: {
    getItem:(key:string)=>data.get(key)??null,
    setItem:(key:string,value:string)=>{data.set(key,value);},
  }};
}
test("只识别交班报告生成意图，查询历史报告和生产控制均不误触",()=>{
  assert.equal(isHandoverRequest("帮我完成今天的运行检查，整理异常情况，生成交班报告"),true);
  assert.equal(isHandoverRequest("生成今天的交接班报告"),true);
  assert.equal(isHandoverRequest("查询交班报告"),false);
  assert.equal(isHandoverRequest("启动水泵并生成交班报告"),false);
});
test("无异常不虚构故障，也不能把五套未覆盖工艺宣称正常",()=>{
  const result=buildHandoverReport(input());
  assert.equal(result.openDutyCount,0);
  assert.equal(result.activeProductionAlarmCount,0);
  assert.equal(result.outstandingOrderCount,0);
  assert.equal(result.patrol.id,"PAT-00009");
  assert.equal(result.coverage.configured,1);
  assert.equal(result.coverage.total,6);
  assert.ok(result.issues.some(x=>x.kind==="coverage"));
  assert.match(result.text,/不代表当天24小时连续监护|不代表当天/);
  assert.match(result.text,/MOCK/);
  assert.equal(result.health?.score,null);
  assert.equal(result.steps.find(x=>x.id==="health")?.status,"blocked");
});
test("异常关联原值守事件、生产告警及未完工单，不把已关闭对象当成待办",()=>{
  const i=input();
  i.activeEvents=[duty,{...duty,id:"UT-00002",status:"closed"}];
  i.alarms=[alarm,{...alarm,id:"alarm-closed",status:"closed"}];
  i.workorders=[order,{...order,id:"wo-archived",status:"archived"}];
  i.patrol={...checked,result:"abnormal"};
  const result=buildHandoverReport(i);
  assert.equal(result.openDutyCount,1);
  assert.equal(result.activeProductionAlarmCount,1);
  assert.equal(result.outstandingOrderCount,1);
  assert.ok(result.issues.some(x=>x.id==="UT-00001"));
  assert.ok(result.issues.some(x=>x.id==="alarm-1"));
  assert.ok(result.issues.some(x=>x.id==="wo-1"));
  assert.ok(result.issues.every(x=>!["wo-archived","UT-00002","alarm-closed"].includes(x.id)));
  assert.match(result.text,/UT-00001/);
});
test("巡查没有执行时步骤标为受阻，报告明确要求补查",()=>{
  const i=input();i.patrol=null;
  const result=buildHandoverReport(i);
  assert.equal(result.patrol.result,"not_run");
  assert.equal(result.steps[0].status,"blocked");
  assert.ok(result.warnings.some(x=>x.includes("未执行巡查")));
  assert.match(result.text,/未执行/);
});
test("有效健康读数时调用主泵规则，但不能隐去种子参考时刻",()=>{
  const i=input();
  i.healthReadings={vibration:1.1,temperature:47,current:71};
  const result=buildHandoverReport(i);
  assert.ok(typeof result.health?.score === "number");
  assert.equal(result.steps.find(x=>x.id==="health")?.status,"done");
  assert.match(result.text,/2026-11-15/);
  assert.ok(result.warnings.some(x=>x.includes("MOCK")));
});
test("角色权限、确认保存与幂等防重复，草稿不构成实际派工",()=>{
  const {storage}=memory();
  const result=buildHandoverReport(input());
  assert.throws(()=>saveHandoverDraft(result,"viewer",storage),/无权/);
  assert.throws(()=>saveHandoverDraft(result,"engineer",storage),/无权/);
  assert.throws(()=>saveHandoverDraft(result,"manager",storage),/角色已变化/);
  const saved=saveHandoverDraft(result,"duty",storage);
  assert.equal(saved.status,"pending_review");
  saveHandoverDraft(result,"duty",storage);
  assert.equal(readHandoverReports(storage).length,1);
  assert.match(storage.getItem(HANDOVER_STORAGE_KEY)??"",/PAT-00009/);
});
test("值班员不能审核；管理者必须填写意见，审核后不可重复归档",()=>{
  const {storage}=memory();
  const report=saveHandoverDraft(buildHandoverReport(input()),"duty",storage);
  assert.throws(()=>reviewHandoverReport(report.id,"duty","核实了",storage,"2026-11-16T11:00:00Z"),/无权/);
  assert.throws(()=>reviewHandoverReport(report.id,"manager","",storage,"2026-11-16T11:00:00Z"),/审核意见/);
  const approved=reviewHandoverReport(report.id,"manager","模拟审核，现场五套工艺需补充巡检",storage,"2026-11-16T11:00:00Z");
  assert.equal(approved.status,"reviewed");
  assert.equal(approved.reviewedBy,"manager");
  assert.match(approved.text,/现场五套工艺需补充巡检/);
  assert.throws(()=>reviewHandoverReport(report.id,"manager","再签一次",storage,"2026-11-16T12:00:00Z"),/不得重复/);
});
test("损坏的本地记录容错、缺少泵档案保留缺数提示、无效生成时间拒绝",()=>{
  const {storage,data}=memory();
  data.set(HANDOVER_STORAGE_KEY,"{broken");
  assert.deepEqual(readHandoverReports(storage),[]);
  const i=input();i.healthAsset=null;
  const result=buildHandoverReport(i);
  assert.equal(result.health,null);
  assert.ok(result.warnings.some(x=>x.includes("P-002泵档案缺失")));
  i.preparedAt="nonsense";
  assert.throws(()=>buildHandoverReport(i),/生成时间无效/);
});
