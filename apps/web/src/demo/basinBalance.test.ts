import test from "node:test";
import assert from "node:assert/strict";
import {MOCK_BASINS,saveBasinRecord,type BasinRecord} from "./basinRegistry";
import {
 BALANCE_STORAGE_KEY,MAX_BALANCE_CASES,calculateBasinBalance,readBasinBalanceCases,
 submitBasinBalanceCase,acknowledgeBasinBalanceCase,attachBasinBalanceWorkOrder,closeDemoBalanceCase,
 preflightBasinBalanceOrder,finishBasinDemoCase,exportBasinBalanceBackup,
 type BalanceInput,
} from "./basinBalance";
import type {Asset,MeasurePoint,WorkOrder} from "./types";
const now="2026-11-17T13:00:00+08:00";
const storage=()=>{
 const map=new Map<string,string>();
 return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
};
const mock=MOCK_BASINS[0];
const sample=(pool:BasinRecord=mock):BalanceInput=>({
 poolId:pool.id,poolRevision:pool.revision,startAt:"2026-11-17T08:00:00+08:00",
 endAt:"2026-11-17T10:00:00+08:00",
 startLevelM:2,endLevelM:2.1,inflowM3:500,outflowM3:200,basis:"MOCK",
 evidenceRef:"MOCK演示资料，不代表实际计量",
});
const normal=(pool:BasinRecord=mock):BalanceInput=>({...sample(pool),startAt:"2026-11-17T11:00:00+08:00",
 endAt:"2026-11-17T12:00:00+08:00",startLevelM:2,endLevelM:2,inflowM3:200,outflowM3:200});
const asset:Asset={
 id:"asset-basin-a",code:"A-BASIN",name:"候选池体测量设备",type:"水池",subsystemId:"rainwater",
 status:"unknown",source:"MOCK",area:"north",runtimeHours:0,startCount:0,archived:false,
};
const point:MeasurePoint={
 id:"asset-basin-a-level",assetId:asset.id,label:"池体液位",kind:"number",unit:"m",
 source:"MOCK",quality:"valid",samplePeriodMinutes:30,
};
const registered=(s:ReturnType<typeof storage>):BasinRecord=>saveBasinRecord(s,{
 code:"A-POLL-01",name:"现场待核污染水池",purpose:"polluted_collection",subsystemId:"rainwater",
 siteRef:"港区某待核分区",drawingRef:"DWG-RAIN-PID-001",drawingVersion:"A01",
 datumDescription:"设计高程基准，待现场水工专业核实",minLevelM:0,maxLevelM:5,
 assumedLevelM:2,levelPointId:point.id,knots:mock.knots.map(x=>({...x})),
},"engineer",now,[asset],[point]);

test("V33-01 同周期水量守恒残差方向及阈值，仅演示，不判定漏水",()=>{
 const r=calculateBasinBalance(mock,sample());
 assert.equal(r.startStorageM3,1800);
 assert.equal(r.endStorageM3,1946.67);
 assert.equal(r.meteredNetM3,300);
 assert.equal(r.residualM3,-153.33);
 assert.equal(r.toleranceM3,35);
 assert.equal(r.suspected,true);
 assert.equal(r.outOfBounds,false);
});
test("V33-02 正常例未触发演示阈值不等于现场正常，且计算无状态副作用",()=>{
 const r=calculateBasinBalance(mock,normal());
 assert.equal(r.residualM3,0);assert.equal(r.suspected,false);
 assert.equal(r.hours,1);assert.equal(r.predictedEndM3,1800);
});
test("V33-03 时窗、量纲、过界、版本、负累计量、无限值均阻断计算",()=>{
 const base=sample();
 const fails:Partial<BalanceInput>[]=[
  {endAt:base.startAt},{endAt:"2026-11-26T10:00:00+08:00"},
  {startAt:"garbled"},{startLevelM:10},{endLevelM:-1},
  {inflowM3:-1},{inflowM3:Infinity},{outflowM3:NaN},
  {poolRevision:3},{poolId:"MOCK-CLEAR-POOL"},
  {basis:"LIVE" as BalanceInput["basis"]},
 ];
 for(const patch of fails){
  assert.throws(()=>calculateBasinBalance(mock,{...base,...patch}),"should fail "+JSON.stringify(patch));
 }
 const archived={...mock,archived:true};
 assert.throws(()=>calculateBasinBalance(archived,base),/归档/);
});
test("V33-04 预测期末储量超出单池上限需提示风险，无跨池补偿",()=>{
 const r=calculateBasinBalance(mock,{...sample(),inflowM3:9999,outflowM3:0});
 assert.equal(r.outOfBounds,true);assert.equal(r.suspected,true);
});
test("V33-05 保存来源、快照和审计; viewer不能保存，未受理不得跳流程",()=>{
 const s=storage();
 assert.throws(()=>submitBasinBalanceCase(s,mock,sample(),"viewer",now),/无权/);
 assert.throws(()=>submitBasinBalanceCase(s,mock,{...sample(),evidenceRef:"短"},"duty",now),/8/);
 const incident=submitBasinBalanceCase(s,mock,sample(),"duty",now);
 assert.equal(incident.status,"needs_ack");assert.equal(incident.poolSource,"MOCK");
 assert.equal(readBasinBalanceCases(s)[0].id,incident.id);
 assert.equal(incident.history.length,1);
 assert.throws(()=>acknowledgeBasinBalanceCase(s,incident.id,"viewer","核实单位时间与水位基准",now),/无权/);
 assert.throws(()=>acknowledgeBasinBalanceCase(s,incident.id,"duty","短",now),/8/);
 const next=acknowledgeBasinBalanceCase(s,incident.id,"duty","核实同周期的水尺及流量统计口径",now);
 assert.equal(next.status,"acknowledged");assert.equal(next.history.length,2);
 assert.throws(()=>acknowledgeBasinBalanceCase(s,incident.id,"duty","再次受理禁止重复",now),/仅可/);
});
test("V33-06 MOCK池禁止生成指向真实资产的工单；未触发偏差的记录无需受理",()=>{
 const s=storage();
 const a=submitBasinBalanceCase(s,mock,sample(),"duty",now);
 acknowledgeBasinBalanceCase(s,a.id,"duty","同周期累计量暂未核实",now);
 const order={id:"wo-test",code:"WO-2026-999",title:"[逐池核查] "+a.id,assetId:asset.id,status:"draft",
  evidenceIds:[a.id]} as WorkOrder;
 assert.throws(()=>attachBasinBalanceWorkOrder(s,a.id,"duty",mock,[asset],[point],order,now),/MOCK池/);
 const safe=submitBasinBalanceCase(s,mock,normal(),"duty",now);
 assert.equal(safe.status,"recorded");
 assert.throws(()=>acknowledgeBasinBalanceCase(s,safe.id,"duty","手工正常演示数据，不受理",now),/仅可/);
});
test("V33-07 USER_ENTRY候选测点可人工创建核查工单，必须严格复用实际测点资产",()=>{
 const s=storage();const pool=registered(s);
 const incident=submitBasinBalanceCase(s,pool,{...sample(pool),basis:"MANUAL_UNVERIFIED"},"duty",now);
 acknowledgeBasinBalanceCase(s,incident.id,"duty","人工核验该池液位与流量口径",now);
 const order={id:"wo-check",code:"WO-2026-990",title:"[逐池核查] "+incident.id,
  assetId:asset.id,status:"draft",evidenceIds:[incident.id]} as WorkOrder;
 assert.throws(()=>attachBasinBalanceWorkOrder(s,incident.id,"duty",pool,[asset],[point],
  {...order,assetId:"someone-else"},now),/不一致/);
 assert.throws(()=>attachBasinBalanceWorkOrder(s,incident.id,"duty",pool,[asset],[point],
  {...order,evidenceIds:[]},now),/含本次核查ID/);
 assert.throws(()=>attachBasinBalanceWorkOrder(s,incident.id,"engineer",pool,[asset],[point],order,now),/无权/);
 const linked=attachBasinBalanceWorkOrder(s,incident.id,"duty",pool,[asset],[point],order,now);
 assert.equal(linked.status,"workorder_draft");assert.equal(linked.linkedWorkOrderId,order.id);
 const retried=attachBasinBalanceWorkOrder(s,incident.id,"duty",pool,[asset],[point],order,now);
 assert.equal(retried.history.length,linked.history.length); // retry is idempotent
});
test("V33-08 不得仅凭核查工单草稿闭环：需归档和后续同池同版本正常快照+复核权限",()=>{
 const s=storage();const pool=registered(s);
 const first=submitBasinBalanceCase(s,pool,{...sample(pool),basis:"MANUAL_UNVERIFIED"},"duty",now);
 acknowledgeBasinBalanceCase(s,first.id,"duty","核对水量累计与测点基准",now);
 const order={id:"wo-check",code:"WO-2026-990",title:"[逐池核查] "+first.id,
  assetId:asset.id,status:"draft",evidenceIds:[first.id]} as WorkOrder;
 attachBasinBalanceWorkOrder(s,first.id,"duty",pool,[asset],[point],order,now);
 const recheck=submitBasinBalanceCase(s,pool,{...normal(pool),basis:"MANUAL_UNVERIFIED"},"duty",
  "2026-11-17T13:01:00+08:00");
 assert.throws(()=>closeDemoBalanceCase(s,first.id,"viewer",now,"记录后续水量平衡依据",recheck.id,
  [{...order,status:"archived"}]),/无权/);
 assert.throws(()=>closeDemoBalanceCase(s,first.id,"manager",now,"记录后续水量平衡依据",recheck.id,
  [order]),/尚未验收/);
 assert.throws(()=>closeDemoBalanceCase(s,first.id,"manager",now,"记录后续水量平衡依据","unknown",
  [{...order,status:"archived"}]),/需要同池/);
 const closed=closeDemoBalanceCase(s,first.id,"manager",now,"根据同池后续人工复核记录并完成演示工单",
  recheck.id,[{...order,status:"archived"}]);
 assert.equal(closed.status,"closed_demo");assert.equal(closed.recoveryCaseId,recheck.id);
 assert.match(closed.history.at(-1)?.action??"",/不代表现场消项/);
 assert.throws(()=>closeDemoBalanceCase(s,first.id,"manager",now,"再关闭是不允许的",recheck.id,
  [{...order,status:"archived"}]),/尚未关联/);
});
test("V33-09 本地数据损坏不污染其他系统；缺失数据直接返回空",()=>{
 const s=storage();
 assert.deepEqual(readBasinBalanceCases(s),[]);
 s.setItem(BALANCE_STORAGE_KEY,"not json");
 assert.deepEqual(readBasinBalanceCases(s),[]);
 s.setItem(BALANCE_STORAGE_KEY,JSON.stringify([{id:"BB-FAKE",result:{suspected:true},input:{basis:"MOCK"}}]));
 assert.deepEqual(readBasinBalanceCases(s),[]);
});

test("V34-01 MOCK核查已受理后可单独结束演练，不需要伪造工单恢复",()=>{
 const s=storage(),a=submitBasinBalanceCase(s,mock,sample(),"duty",now);
 assert.throws(()=>finishBasinDemoCase(s,a.id,"duty","只是演练结束而非恢复",now),/已人工受理/);
 acknowledgeBasinBalanceCase(s,a.id,"duty","演练核算残差核实说明",now);
 assert.throws(()=>finishBasinDemoCase(s,a.id,"viewer","仅限可核查人员结束演练",now),/无权/);
 const done=finishBasinDemoCase(s,a.id,"duty","仅完成MOCK演示，不代表现场问题恢复",now);
 assert.equal(done.status,"demo_finished");
 assert.equal(done.history.length,3);
 assert.equal(done.linkedWorkOrderId,undefined);
 assert.throws(()=>finishBasinDemoCase(s,a.id,"duty","不允许重复结束演练",now),/已人工受理/);
});
test("V34-02 核查快照本机导出含历史；80条上限不再自动丢失旧数据",()=>{
 const s=storage(),first=submitBasinBalanceCase(s,mock,sample(),"duty",now);
 const backup=JSON.parse(exportBasinBalanceBackup(s,now));
 assert.equal(backup.cases.length,1);
 assert.equal(backup.schema,"tanggang-basin-balance-backup-v1");
 assert.equal(backup.cases[0].id,first.id);
 const records=Array.from({length:MAX_BALANCE_CASES},(_,i)=>({...first,id:"BB-TEST-"+String(i).padStart(2,"0")}));
 s.setItem(BALANCE_STORAGE_KEY,JSON.stringify(records));
 assert.equal(readBasinBalanceCases(s).length,MAX_BALANCE_CASES);
 assert.throws(()=>submitBasinBalanceCase(s,mock,sample(),"duty",now),/禁止静默覆盖/);
 assert.equal(JSON.parse(s.getItem(BALANCE_STORAGE_KEY)??"[]").length,MAX_BALANCE_CASES);
});
test("V34-03 MOCK输入不得绑定候选设备工单，预校验必须先通过",()=>{
 const s=storage(),pool=registered(s);
 const incident=submitBasinBalanceCase(s,pool,sample(pool),"duty",now);
 acknowledgeBasinBalanceCase(s,incident.id,"duty","待核查时间与仪表对应关系",now);
 assert.throws(()=>preflightBasinBalanceOrder(s,incident.id,"duty",pool,[asset],[point],asset.id),/MOCK输入/);
 const corrected=submitBasinBalanceCase(s,pool,{...sample(pool),basis:"MANUAL_UNVERIFIED"},"duty",
  "2026-11-17T13:02:00+08:00");
 assert.throws(()=>preflightBasinBalanceOrder(s,corrected.id,"duty",pool,[asset],[point],asset.id),/未受理/);
 acknowledgeBasinBalanceCase(s,corrected.id,"duty","待核查时间与仪表对应关系",now);
 assert.equal(preflightBasinBalanceOrder(s,corrected.id,"duty",pool,[asset],[point],asset.id).id,corrected.id);
 assert.throws(()=>preflightBasinBalanceOrder(s,corrected.id,"duty",pool,[asset],[point],"another-asset"),/不一致/);
});
