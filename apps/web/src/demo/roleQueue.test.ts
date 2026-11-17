import test from "node:test";
import assert from "node:assert/strict";
import {buildRoleQueue,roleShortcuts} from "./roleQueue";
import type {Alarm,Asset,WorkOrder} from "./types";
import type {DutyEvent} from "./unattended";
const asset={id:"A",code:"A-01",name:"试验泵",archived:false} as Asset;
const alarm={id:"AL-1",code:"AL-1",assetId:"A",subsystemId:"pump",kind:"production",
 level:"critical",status:"active",occurredAt:"2026-11-10T00:00:00Z",title:"压力异常",detail:"测试"} as Alarm;
const order=(status:WorkOrder["status"],id="WO-1"):WorkOrder=>({
 id,code:id,title:"检修",assetId:"A",source:"manual",evidenceIds:[],
 symptom:"异常",suggestion:"复查",status,priority:"high",createdBy:"DEMO",
 createdAt:"2026-11-10T00:00:00Z",history:[],
});
const duty={id:"UT-1",assetId:"A",status:"pending_verification",title:"巡检异常",level:"warning",
 lastSeen:"2026-11-10T00:00:00Z",kind:"low_pressure"} as DutyEvent;
const result=(role:Parameters<typeof buildRoleQueue>[0],o:WorkOrder[]=[],a:Alarm[]=[alarm],d:DutyEvent[]=[])=>buildRoleQueue(role,a,o,d,[asset]);
test("V38-01 角色只接收授权动作",()=>{
 assert.deepEqual(result("duty",[order("pending_acceptance")]).tasks.map(x=>x.origin),["alarm"]);
 assert.deepEqual(result("engineer",[order("pending_dispatch")]).tasks.map(x=>x.origin),["workorder"]);
 assert.deepEqual(result("manager",[order("pending_acceptance")]).tasks.map(x=>x.origin),["workorder"]);
 assert.equal(result("viewer",[order("in_progress")],[],[duty]).tasks.length,0);
 assert.deepEqual(result("water",[order("draft")],[],[]).tasks.map(x=>x.actionLabel),["提交草稿待派单"]);
});
test("V38-02 四种工单状态对应角色动作，终态不产生任务",()=>{
 const statuses=["draft","pending_dispatch","in_progress","pending_acceptance","archived","cancelled"] as const;
 const expected=["提交草稿待派单","接单并填写负责人","登记处理结果","验收或退回"];
 const tasks=result("admin",statuses.map((s,i)=>order(s,"WO-"+i)),[],[]).tasks;
 assert.equal(tasks.length,4);
 assert.deepEqual(tasks.map(t=>t.actionLabel).sort(),expected.sort());
});
test("V38-03 同设备告警、巡查和工单保留独立动作，严重事件优先",()=>{
 const items=result("admin",[order("in_progress")],[alarm],[duty]).tasks;
 assert.equal(items.length,3);
 assert.deepEqual(items.map(x=>x.origin),["alarm","duty","workorder"]);
 assert.equal(new Set(items.map(x=>x.id)).size,3);
 assert.equal(result("duty",[],[{...alarm,status:"acknowledged"}]).tasks.length,0);
});
test("V38-04 失效设备不得生成可办理候选，保留核查风险",()=>{
 const q=buildRoleQueue("admin",[],[{...order("pending_dispatch"),assetId:"MISSING"}],[],[asset]);
 assert.equal(q.tasks.length,0);
 assert.equal(q.issues[0].kind,"missing_asset");
});
test("V38-05 失效工单、跨设备错绑、工单已归档但告警仍活动分别提示，不改状态",()=>{
 const a={...alarm,workOrderId:"WO-1"};
 assert.ok(result("admin",[],[a]).issues.some(x=>x.kind==="missing_order"));
 assert.ok(result("admin",[{...order("in_progress"),assetId:"OTHER"}],[a]).issues.some(x=>x.kind==="mismatched_asset"));
 assert.ok(result("admin",[order("archived")],[a]).issues.some(x=>x.kind==="post_archive_review"));
 assert.equal(a.status,"active");
});
test("V38-06 低压事件无归档工单不得显示直接关闭，仍有待复核行动",()=>{
 const ready={...duty,status:"ready_to_close",validRecoveryChecks:2} as DutyEvent;
 assert.equal(result("duty",[],[],[duty,ready]).tasks.length,1);
 assert.equal(result("manager",[order("archived","WO-2")],[],[{...ready,workOrderId:"WO-2"}]).tasks.length,1);
});
test("V38-07 岗位快捷入口没有越权操作",()=>{
 assert.ok(roleShortcuts("manager").some(x=>x.label==="工单验收"));
 assert.ok(roleShortcuts("engineer").some(x=>x.label==="工单办理"));
 assert.ok(roleShortcuts("water").some(x=>x.label==="水源优化"));
 assert.ok(roleShortcuts("viewer").every(x=>x.permission==="process:read"));
});

test("V38-08 工单归档且告警已确认后管理者才有独立关闭动作，单纯归档不算关闭",()=>{
 const acknowledged={...alarm,status:"acknowledged" as const,workOrderId:"WO-1"};
 assert.equal(result("manager",[order("in_progress")],[acknowledged]).tasks.length,0);
 const q=result("manager",[order("archived")],[acknowledged]);
 assert.equal(q.tasks.length,1);
 assert.equal(q.tasks[0].actionLabel,"人工核查依据后关闭");
 assert.equal(result("duty",[order("archived")],[acknowledged]).tasks.length,0);
 assert.equal(acknowledged.status,"acknowledged");
});
