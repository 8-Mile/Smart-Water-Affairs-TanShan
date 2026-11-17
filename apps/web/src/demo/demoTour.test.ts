import test from "node:test";
import assert from "node:assert/strict";
import {createPinia,setActivePinia} from "pinia";
import {TOUR_DEFINITIONS,tourTarget,useDemoTour} from "./demoTour";

test("V39-01 三条业务路线名称与步骤ID唯一，均能定位原系统页面",()=>{
 assert.deepEqual(TOUR_DEFINITIONS.map(x=>x.id),["storm","fault","cost"]);
 const ids=TOUR_DEFINITIONS.flatMap(x=>x.steps.map(s=>s.id));
 assert.equal(new Set(ids).size,ids.length);
 for(const flow of TOUR_DEFINITIONS){
  assert.ok(flow.steps.length>=2);
  assert.ok(flow.objective);
  assert.ok(flow.boundary);
  for(const step of flow.steps){
   const target=tourTarget(step.id,"WS-TEST");
   assert.ok(target?.path.startsWith("/"));
  }
 }
});
test("V39-02 未取得本轮WS草稿时不能构造成本页伪编号链接",()=>{
 assert.equal(tourTarget("cost-compare",undefined),null);
 assert.deepEqual(tourTarget("cost-compare","WS-ABC"),{
  path:"/water/green-benefit",query:{supplyDraftId:"WS-ABC"},
 });
});
test("V39-03 故障业务六步保留原工单编号，告警人工关闭另行核查",()=>{
 const flow=TOUR_DEFINITIONS.find(x=>x.id==="fault")!;
 assert.equal(flow.steps.length,6);
 assert.deepEqual(flow.steps.map(x=>x.role),["admin","duty","duty","engineer","manager","manager"]);
 assert.deepEqual(tourTarget("fault-repair"),{
  path:"/operations/workorders",query:{workOrderId:"wo-2026-014"},
 });
 assert.deepEqual(tourTarget("fault-close"),{
  path:"/operations/events",query:{tab:"alarms",alarmId:"ALM-P002-01"},
 });
});
test("V39-04 导览步骤变化不修改业务Store，只更新当前演示会话",()=>{
 setActivePinia(createPinia());
 const tour=useDemoTour();
 tour.stop();
 tour.start("fault","manager","SCN-NORMAL",["WS-1"],["GNB-1"],"PCHAIN-1");
 assert.equal(tour.record?.id,"fault");
 assert.equal(tour.record?.previousRole,"manager");
 assert.equal(tour.record?.previousScenario,"SCN-NORMAL");
 assert.equal(tour.record?.step,0);
 tour.move(3);
 assert.equal(tour.step?.id,"fault-repair");
 tour.move(999);
 assert.equal(tour.record?.step,3);
 tour.stop();
 assert.equal(tour.record,null);
});
