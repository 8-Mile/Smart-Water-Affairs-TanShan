import test from "node:test";
import assert from "node:assert/strict";
import {
  FACILITIES,RELATIONS,topologyCases,topologySummary,relationById,
  facilityById,relationsForSubsystem,
} from "./engineeringTopology";
import {readEngineeringReviews,submitEngineeringEvidence,reviewEngineeringEvidence,engineeringEntry} from "./engineering";
function storage(){
 const items=new Map<string,string>();
 return {getItem:(key:string)=>items.get(key)??null,setItem:(key:string,value:string)=>{items.set(key,value);}};
}
const NOW="2026-11-16T13:00:00Z";
test("V3-T01 14个工程设施实体和10条关系存在唯一ID，无任何隐式物理连接",()=>{
 assert.equal(FACILITIES.length,14);
 assert.equal(RELATIONS.length,10);
 assert.equal(new Set(FACILITIES.map(x=>x.id)).size,14);
 assert.equal(new Set(RELATIONS.map(x=>x.id)).size,10);
 assert.ok(RELATIONS.every(x=>!x.fieldVerified&&!x.controlAuthorized));
 assert.ok(FACILITIES.every(x=>x.siteStatus==="unverified"));
});
test("V3-T02 每条关系的源与目标存在，并且每个关联前置CK和PT编号可溯源",()=>{
 for(const x of RELATIONS){
  assert.ok(facilityById(x.from),x.id+" missing from facility");
  assert.ok(facilityById(x.to),x.id+" missing to facility");
  assert.ok(x.checkIds.length>=1);
  assert.ok(x.pointIds.length>=1);
  for(const id of [...x.checkIds,...x.pointIds])assert.ok(engineeringEntry(id),x.id+" unresolved "+id);
 }
});
test("V3-T03 港口业务四段链明确入站、处理、清水池和冲洗终端，不扩展未经批准的回用去向",()=>{
 assert.equal(relationById("REL-02")?.from,"F-COLLECTION");
 assert.equal(relationById("REL-04")?.to,"F-CLEAR");
 assert.equal(relationById("REL-05")?.to,"F-FLUSH");
 assert.equal(relationById("REL-05")?.status,"design_direction");
 assert.equal(relationById("REL-06")?.status,"prohibited");
 assert.ok(relationById("REL-06")?.checkIds.includes("CK-016"));
});
test("V3-T04 模型不把雨前外排风险当成经过批准的排水路径",()=>{
 const x=relationById("REL-07")!;
 assert.equal(x.layer,"compliance");
 assert.equal(x.status,"prohibited");
 assert.ok(x.restrictions.includes("禁止"));
 assert.ok(x.checkIds.includes("CK-031"));
 assert.equal(x.controlAuthorized,false);
});
test("V3-T05 中压供水与射雾只作为未知物理关系，不能凭同一时间告警归因",()=>{
 const x=relationById("REL-08")!;
 assert.equal(x.status,"unconfirmed");
 assert.equal(x.fieldVerified,false);
 assert.ok(x.checkIds.includes("CK-019"));
 assert.ok(x.restrictions.includes("因"));
 assert.equal(relationsForSubsystem("spray").some(r=>r.id==="REL-08"),true);
 assert.equal(relationsForSubsystem("medium-pressure").some(r=>r.id==="REL-08"),true);
});
test("V3-T06 生活污水外送是项目范围外的业务方向，不暗示本项目自建处理设施",()=>{
 assert.equal(relationById("REL-09")?.status,"design_direction");
 assert.equal(facilityById("F-EXTERNAL")?.status,"external_boundary");
 assert.equal(relationsForSubsystem("domestic").length,1);
});
test("V3-T07 工控系统只读采集关系与设备物理水网分层，平台没有远控授权",()=>{
 const x=relationById("REL-10")!;
 assert.equal(x.layer,"control");
 assert.equal(x.status,"unconfirmed");
 assert.ok(x.restrictions.includes("不得"));
 assert.equal(x.controlAuthorized,false);
});
test("V3-T08 初始无一项现场审批，仍允许统计关系、禁止路径和核查需求",()=>{
 const summary=topologySummary([]);
 assert.deepEqual(summary,{total:10,fieldVerified:0,prohibited:2,fieldBlocked:10,reviewedEvidence:0,realControlAuthorized:false});
 const items=topologyCases([]);
 assert.equal(items.length,10);
 assert.ok(items.every(x=>x.blockingCheckIds.length>0&&x.reviewedDemo===0));
});
test("V3-T09 模拟资料审核只能更新证据台账的审阅计数，不能虚构现场验收或PLC放行",()=>{
 const st=storage();
 submitEngineeringEvidence(st,"CK-019","engineer","SUPPLY-TOPOLOGY-DEMO","中压泵与射雾器连接的工艺图还未获得正式签认",NOW);
 let items=topologyCases(readEngineeringReviews(st));
 assert.equal(items.find(x=>x.relation.id==="REL-08")?.submitted,1);
 reviewEngineeringEvidence(st,"CK-019","manager","reviewed_demo","本次只审阅了演示资料，未取得现场确认与签字",NOW);
 const summary=topologySummary(readEngineeringReviews(st));
 items=topologyCases(readEngineeringReviews(st));
 assert.equal(items.find(x=>x.relation.id==="REL-08")?.reviewedDemo,1);
 assert.equal(summary.reviewedEvidence,1);
 assert.equal(summary.fieldVerified,0);
 assert.equal(summary.realControlAuthorized,false);
});
test("V3-T10 受限水路与合规去向不存在任何可执行PLC指令入口",()=>{
 for(const x of RELATIONS.filter(x=>x.status==="prohibited")){
  assert.equal(x.fieldVerified,false);
  assert.equal(x.controlAuthorized,false);
  assert.ok(x.restrictions.length>10);
 }
 assert.equal(relationById("REL-999"),undefined);
});
