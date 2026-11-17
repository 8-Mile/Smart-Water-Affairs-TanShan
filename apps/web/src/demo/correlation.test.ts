import test from "node:test";
import assert from "node:assert/strict";
import {buildSeed} from "./seed";
import {
  collectCorrelationSignals, buildCorrelationSnapshot, readCorrelation,
  recordDemoLink, reviewDemoLink, readScenarioCorrelation, acceptCorrelationCase,
  updateCorrelationCase, attachCorrelationOrder, saveCorrelation,
  caseId,linkId,
} from "./correlation";
import type {DutyEvent} from "./unattended";
import type {Alarm,WorkOrder} from "./types";

const SCENARIO="SCN-PUMP-FAULT";
const SEED=buildSeed(SCENARIO);
const seedSnapshot=(links:ReturnType<typeof readCorrelation>["links"]=[])=>
  buildCorrelationSnapshot(SEED.alarms,[],SEED.workorders,SEED.assets,links,SCENARIO);
const timestamp="2026-11-16T09:35:00Z";
const storage=()=>{const values=new Map<string,string>();return {
  values,getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,val:string)=>{values.set(key,val);},
};};
const relation=(state=readCorrelation(storage()))=>{
  const submitted=recordDemoLink(state,SCENARIO,"asset-p002","asset-sp004",
    "DRAWING-DEMO-001","模拟设想两个设备之间存在间接供水联系，现场尚无证据","duty",timestamp);
  return reviewDemoLink(submitted,linkId(SCENARIO,"asset-p002","asset-sp004"),
    "仅按人工录入的演示资料进行业务关联，仍须现场核实","manager",timestamp);
};

test("C1 正常工况只按设备业务ID归集，不把未接监护工艺误判正常",()=>{
  const seed=buildSeed("SCN-NORMAL");
  const result=buildCorrelationSnapshot(seed.alarms,[],seed.workorders,seed.assets,[],"SCN-NORMAL");
  assert.equal(result.signals.length,1);
  assert.equal(result.clusters.length,1);
  assert.equal(result.clusters[0].assetCode,"P-002");
  assert.equal(result.crossCandidates.length,0);
  assert.equal(result.clusters[0].existingOrders.some(o=>o.code==="WO-2026-014"),true);
});

test("C2 P002和射雾器异常属于两个工艺，时序接近不得自动宣称共因或并入同一处置组",()=>{
  const result=seedSnapshot();
  assert.equal(result.clusters.length,2);
  assert.equal(result.crossCandidates.length,1);
  assert.equal(result.unconfirmedCount,1);
  assert.equal(result.reviewedDemoCount,0);
  const candidate=result.crossCandidates[0];
  assert.equal(candidate.evidenceLevel,"temporal_only");
  assert.equal(candidate.from.id,"ALM-P002-02");
  assert.equal(candidate.to.id,"ALM-SP004-01");
  assert.ok(candidate.deltaHours>0);
  assert.match(candidate.message,/禁止自动认定共因/);
  assert.deepEqual(result.clusters.find(c=>c.assetCode==="P-002")?.linkedPairs,[]);
});

test("C3 只引用production告警、包含已确认但尚未关闭的信号，不把财务预算当生产故障",()=>{
  const signals=collectCorrelationSignals(SEED.alarms,[]);
  assert.equal(signals.length,3);
  assert.ok(signals.every(x=>x.source==="alarm"));
  assert.ok(signals.every(x=>!x.id.includes("MINING")));
  const acknowledged:Alarm={...SEED.alarms[0],status:"acknowledged"};
  assert.equal(collectCorrelationSignals([acknowledged],[])[0].active,true);
  const closed:Alarm={...SEED.alarms[0],status:"closed"};
  assert.equal(collectCorrelationSignals([closed],[])[0].active,false);
});

test("C4 值守事件和生产告警同设备归集但保留源ID、时间、状态和已有工单引用",()=>{
  const event:DutyEvent={
    id:"UT-001",subsystemId:"medium-pressure",assetId:"asset-p002",
    kind:"low_pressure",title:"演示P002出口低压",level:"warning",status:"acknowledged",
    firstSeen:timestamp,lastSeen:timestamp,occurrences:2,validRecoveryChecks:0,
    workOrderId:"wo-2026-014",detail:"请复核",evidence:["asset-p002-pressure"],history:[],
  };
  const r=buildCorrelationSnapshot(SEED.alarms,[event],SEED.workorders,SEED.assets,[],SCENARIO);
  const cluster=r.clusters.find(c=>c.assetCode==="P-002")!;
  assert.equal(cluster.signals.length,3);
  assert.ok(cluster.signals.some(x=>x.ref==="duty:UT-001"));
  assert.ok(cluster.signals.some(x=>x.ref==="alarm:ALM-P002-01"));
  assert.equal(cluster.existingOrders.filter(x=>x.id==="wo-2026-014").length,1);
});

test("C5 待审核的人工假设关系不得加入协同组，管理者演示复核后仅作为核查线索",()=>{
  const submitted=recordDemoLink(readCorrelation(storage()),SCENARIO,
    "asset-p002","asset-sp004","DRAWING-DEMO-001","关系仅为演示推定，真实图纸未核查",
    "duty",timestamp);
  let r=seedSnapshot(submitted.links);
  assert.equal(r.unconfirmedCount,1);
  assert.equal(r.clusters.find(c=>c.assetCode==="P-002")?.linkedPairs.length,0);
  assert.throws(()=>reviewDemoLink(submitted,submitted.links[0].id,"同意模拟复核","duty",timestamp),/无权/);
  assert.throws(()=>reviewDemoLink(submitted,submitted.links[0].id,"短","manager",timestamp),/不少于8字/);
  const reviewed=reviewDemoLink(submitted,submitted.links[0].id,
    "仅在演示中接受这项关联假设，现场必须验证管网","manager",timestamp);
  r=seedSnapshot(reviewed.links);
  assert.equal(r.unconfirmedCount,0);
  assert.equal(r.reviewedDemoCount,1);
  assert.equal(r.clusters.find(c=>c.assetCode==="P-002")!.linkedPairs.length,1);
  assert.match(r.crossCandidates[0].message,/不能推定共同根因/);
});

test("C6 受理一个同设备/跨系统联合线索记录，另一端不得再创建重复协同处置",()=>{
  const state=relation();
  const r=seedSnapshot(state.links);
  const p002=r.clusters.find(c=>c.assetCode==="P-002")!;
  const spray=r.clusters.find(c=>c.assetCode==="SP-004")!;
  const accepted=acceptCorrelationCase(state,SCENARIO,p002,"duty",timestamp,
    "值班员先行复核异常信号并现场排查水力连接");
  assert.equal(accepted.cases.length,1);
  assert.equal(accepted.cases[0].workOrderId,"wo-2026-014");
  assert.equal(accepted.cases[0].signalRefs.length,3);
  assert.equal(accepted.cases[0].linkedPairIds.length,1);
  assert.throws(()=>acceptCorrelationCase(accepted,SCENARIO,spray,"duty",timestamp,
    "不能另行对同组跨系统线索重复创建独立协同单"),/重复派工|多头受理/);
  assert.throws(()=>acceptCorrelationCase(accepted,SCENARIO,p002,"duty",timestamp,
    "再次对原设备提出处理"),/重复派工|多头受理/);
});

test("C7 状态机要求人工说明，闭环时源告警仍活动即阻断，即使人工按了恢复按钮",()=>{
  const seed=seedSnapshot();
  const item=seed.clusters.find(x=>x.assetCode==="P-002")!;
  let s=acceptCorrelationCase(readCorrelation(storage()),SCENARIO,item,"duty",timestamp,
    "基于已有工单和关联告警确认需要继续现场核查");
  assert.throws(()=>updateCorrelationCase(s,item.id,"closed","manager",timestamp,
    "我想直接跳过处理流程",collectCorrelationSignals(SEED.alarms,[]),SEED.workorders),/不允许/);
  s=updateCorrelationCase(s,item.id,"processing","duty",timestamp,
    "已进入现场复查准备阶段",collectCorrelationSignals(SEED.alarms,[]),SEED.workorders);
  s=updateCorrelationCase(s,item.id,"pending_recovery","manager",timestamp,
    "申请逐个核验异常信号和在办工单",collectCorrelationSignals(SEED.alarms,[]),SEED.workorders);
  assert.throws(()=>updateCorrelationCase(s,item.id,"closed","manager",timestamp,
    "异常源信号仍然没有关闭",collectCorrelationSignals(SEED.alarms,[]),SEED.workorders),/仍有源告警/);
  assert.equal(s.cases[0].status,"pending_recovery");
});

test("C8 人工闭环必须源证据可访问且已解除、原工单已验收；从不代替原告警关闭",()=>{
  const item=seedSnapshot().clusters.find(x=>x.assetCode==="P-002")!;
  let s=acceptCorrelationCase(readCorrelation(storage()),SCENARIO,item,"manager",timestamp,
    "本轮要先核实原始报警处理和工单验收记录");
  const originalSignals=collectCorrelationSignals(SEED.alarms,[]);
  s=updateCorrelationCase(s,item.id,"processing","manager",timestamp,
    "安排对设备进行模拟核查",originalSignals,SEED.workorders);
  s=updateCorrelationCase(s,item.id,"pending_recovery","manager",timestamp,
    "申请恢复核验但不能省略原始证据核查",originalSignals,SEED.workorders);
  const signalsClosed=collectCorrelationSignals(SEED.alarms.map(a=>({...a,status:"closed"})),[]);
  assert.throws(()=>updateCorrelationCase(s,item.id,"closed","manager",timestamp,
    "模拟原始告警现已关闭",[],SEED.workorders),/不可访问/);
  assert.throws(()=>updateCorrelationCase(s,item.id,"closed","manager",timestamp,
    "模拟原始告警现已关闭",signalsClosed,SEED.workorders),/工单尚未验收归档/);
  const archivedOrders=SEED.workorders.map(o=>({...o,status:"archived" as const}));
  s=updateCorrelationCase(s,item.id,"closed","manager",timestamp,
    "模拟原始报警已解除，已有工单全部完工验收",signalsClosed,archivedOrders);
  assert.equal(s.cases[0].status,"closed");
  assert.equal(s.cases[0].audit.length,4);
});

test("C9 未核实资料或无权限不得造关系，复核必须由管理者承担",()=>{
  const initial=readCorrelation(storage());
  assert.throws(()=>recordDemoLink(initial,SCENARIO,"asset-p002","asset-sp004","",
    "待核实物理关系", "duty",timestamp),/必须输入来源/);
  assert.throws(()=>recordDemoLink(initial,SCENARIO,"asset-p002","asset-sp004","Drawing-DEMO-1",
    "这太短","duty",timestamp),/不少于8字/);
  assert.throws(()=>recordDemoLink(initial,SCENARIO,"asset-p002","asset-sp004","Drawing-DEMO-1",
    "现场记录尚未审核的人工假设关系","viewer",timestamp),/无权/);
  assert.throws(()=>recordDemoLink(initial,SCENARIO,"asset-p002","asset-p002","Drawing-DEMO-1",
    "设备不能与自己绑定假设关联","manager",timestamp),/不同设备/);
});

test("C10 同一关联事件只能绑定一个工单，重复点击同一工单幂等；只读角色不能改事件",()=>{
  const item=seedSnapshot().clusters.find(x=>x.assetCode==="SP-004")!;
  let s=acceptCorrelationCase(readCorrelation(storage()),SCENARIO,item,"duty",timestamp,
    "为射雾器异常准备待确认的独立检查记录");
  s=attachCorrelationOrder(s,item.id,"wo-test-1","duty",timestamp);
  assert.equal(attachCorrelationOrder(s,item.id,"wo-test-1","duty",timestamp),s);
  assert.throws(()=>attachCorrelationOrder(s,item.id,"wo-test-2","duty",timestamp),/重复建立/);
  assert.throws(()=>updateCorrelationCase(s,item.id,"processing","viewer",timestamp,
    "访客不应执行设备事件处置",collectCorrelationSignals(SEED.alarms,[]),SEED.workorders),/无权/);
});

test("C11 错误JSON容错、持久化以及场景隔离，不把一个演示工况受理记录混到另一个",()=>{
  const store=storage();
  store.setItem("tanggang-correlation-v1","json broken");
  assert.deepEqual(readCorrelation(store),{version:1,links:[],cases:[]});
  const state=relation();
  saveCorrelation(store,state);
  assert.equal(readCorrelation(store).links.length,1);
  assert.equal(readScenarioCorrelation(readCorrelation(store),SCENARIO).links.length,1);
  assert.equal(readScenarioCorrelation(readCorrelation(store),"SCN-NORMAL").links.length,0);
  assert.equal(caseId(SCENARIO,"asset-p002"),"SCN-PUMP-FAULT::asset-p002");
});

test("C12 独立工艺同时报警不等于拥有现场水力关系；即使主题相同也只有时间线索",()=>{
  const alarm1:Alarm={...SEED.alarms[0],id:"ALM-A",assetId:"asset-p002",subsystemId:"medium-pressure",title:"出口压力异常",occurredAt:timestamp};
  const alarm2:Alarm={...alarm1,id:"ALM-B",assetId:"asset-sp004",subsystemId:"spray",occurredAt:"2026-11-16T09:40:00Z"};
  const snap=buildCorrelationSnapshot([alarm1,alarm2],[],[] as WorkOrder[],SEED.assets,[],SCENARIO);
  assert.equal(snap.crossCandidates.length,1);
  assert.equal(snap.clusters.length,2);
  assert.equal(snap.clusters[0].linkedPairs.length,0);
  assert.equal(snap.crossCandidates[0].evidenceLevel,"temporal_only");
});

test("C13 跨系统已关联后，另一套工艺出现新活动告警时同样阻断关闭",()=>{
  const state=relation();
  const cluster=seedSnapshot(state.links).clusters.find(x=>x.assetCode==="P-002")!;
  let workflow=acceptCorrelationCase(state,SCENARIO,cluster,"manager",timestamp,
    "人工受理中压泵与射雾器的模拟联合核查任务");
  assert.deepEqual(workflow.cases[0].relatedAssetIds.sort(),["asset-p002","asset-sp004"].sort());
  const original=collectCorrelationSignals(SEED.alarms,[]);
  workflow=updateCorrelationCase(workflow,cluster.id,"processing","manager",timestamp,
    "开始复核原始报警和可能的间接供水连接",original,SEED.workorders);
  workflow=updateCorrelationCase(workflow,cluster.id,"pending_recovery","manager",timestamp,
    "已完成记录检查但未说明真实现场所有异常消失",original,SEED.workorders);
  const originalClosed:Alarm[]=SEED.alarms.map(a=>({...a,status:"closed"}));
  const newSpray:Alarm={...SEED.alarms.find(x=>x.id==="ALM-SP004-01")!,id:"ALM-SP004-NEW",status:"active"};
  const signals=collectCorrelationSignals([...originalClosed,newSpray],[]);
  const orders=SEED.workorders.map(o=>({...o,status:"archived" as const}));
  assert.throws(()=>updateCorrelationCase(workflow,cluster.id,"closed","manager",timestamp,
    "虽然原始报警已关闭但关联射雾器又有新的活动异常",signals,orders),/相关设备存在新活动异常/);
  assert.equal(workflow.cases[0].status,"pending_recovery");
});
