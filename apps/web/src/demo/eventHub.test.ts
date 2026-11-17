import test from "node:test";
import assert from "node:assert/strict";
import {buildEventHub,filterHubEvents} from "./eventHub";
import type {Alarm} from "./types";
import type {DutyEvent} from "./unattended";

const alarm:Alarm={
 id:"AL-001",code:"AL-001",assetId:"asset-p002",subsystemId:"medium-pressure",
 kind:"production",level:"critical",title:"出口压力异常",detail:"需要现场复核",
 occurredAt:"2026-11-17T09:00:00+08:00",status:"active",workOrderId:"WO-1",
};
const duty:DutyEvent={
 id:"UT-001",assetId:"asset-p002",subsystemId:"medium-pressure",kind:"low_pressure",
 title:"巡查发现供水异常",level:"warning",status:"pending_verification",
 firstSeen:"2026-11-17T08:50:00+08:00",lastSeen:"2026-11-17T09:05:00+08:00",
 occurrences:2,validRecoveryChecks:0,detail:"仅模拟巡查",evidence:["MOCK"],history:[],
};
const assets=[{id:"asset-p002",code:"P-002",name:"2号泵"}];
const orders=[{id:"WO-1",code:"WO-2026-001"}];

test("V35-01 相同设备的告警与巡查不被合并为一条事件",()=>{
 const snapshot=buildEventHub([alarm],[duty],assets,orders);
 assert.equal(snapshot.open,2);
 assert.equal(snapshot.assetCount,1);
 assert.equal(snapshot.events.length,2);
 assert.deepEqual(new Set(snapshot.events.map(x=>x.ref)),
  new Set(["alarm:AL-001","duty:UT-001"]));
 assert.equal(snapshot.events.find(x=>x.origin==="alarm")?.workOrderCode,"WO-2026-001");
 assert.equal(snapshot.events.find(x=>x.origin==="duty")?.workOrderCode,undefined);
});
test("V35-02 保留原告警与值守状态，已关闭不计入待办",()=>{
 const inputAlarm={...alarm,status:"closed" as const};
 const inputDuty={...duty,status:"dismissed" as const};
 const snapshot=buildEventHub([inputAlarm],[inputDuty],assets,orders);
 assert.equal(snapshot.open,0);
 assert.equal(snapshot.alarms,0);
 assert.equal(snapshot.duty,0);
 assert.equal(snapshot.critical,0);
 assert.equal(filterHubEvents(snapshot.events,"open","all","").length,0);
 assert.equal(filterHubEvents(snapshot.events,"closed","all","").length,2);
 assert.equal(alarm.status,"active");
 assert.equal(duty.status,"pending_verification");
});
test("V35-03 工单引用失效时明确标记，不提供虚假工单",()=>{
 const snapshot=buildEventHub([alarm],[duty],assets,[]);
 assert.equal(snapshot.events.find(x=>x.origin==="alarm")?.isMissingWorkOrder,true);
 assert.equal(snapshot.hasOrder,0);
 assert.equal(filterHubEvents(snapshot.events,"all","alarm","P-002").length,1);
 assert.equal(filterHubEvents(snapshot.events,"all","duty","UT-001").length,1);
 assert.equal(filterHubEvents(snapshot.events,"all","alarm","不存在").length,0);
});
test("V35-04 严重性和状态决定队列排序，不因来源类型优先合并",()=>{
 const delayed={...alarm,id:"AL-002",code:"AL-002",level:"warning" as const,
   occurredAt:"2026-11-17T12:00:00+08:00",workOrderId:undefined};
 const old={...alarm,id:"AL-003",code:"AL-003",level:"critical" as const,status:"closed" as const,
   occurredAt:"2026-11-18T12:00:00+08:00",workOrderId:undefined};
 const snapshot=buildEventHub([delayed,old,alarm],[duty],assets,orders);
 assert.equal(snapshot.events[0].ref,"alarm:AL-001");
 assert.equal(snapshot.events.at(-1)?.ref,"alarm:AL-003");
 assert.equal(snapshot.events.length,4);
});
