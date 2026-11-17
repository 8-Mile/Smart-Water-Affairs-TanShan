import {expect,test} from "@playwright/test";
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v38")){
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v38","1");
  }
 });
});
async function role(page:import("@playwright/test").Page,value:"admin"|"manager"|"duty"|"engineer"|"water"|"viewer"){
 await page.locator(".role-headline").waitFor({state:"visible"});
 await page.evaluate(async v=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  useDemoStore().setRole(v);
 },value);
}
test("V38-UI01 从首页协同处置直接打开岗位待办；旧导航和四工作区不变",async({page})=>{
 await page.goto("/overview",{waitUntil:"networkidle"});
 await page.locator(".work-panel header").getByRole("link",{name:/岗位待办/}).click();
 await expect(page).toHaveURL(/operations\/events\?focus=tasks/);
 await expect(page.locator(".role-queue.expanded")).toBeVisible();
 await expect(page.locator(".role-headline")).toContainText("系统管理员");
 await expect(page.locator(".role-headline")).toContainText("3 项");
 await expect(page.locator(".hub-tabs>button")).toHaveCount(4);
 await expect(page.locator(".hub-stats>div")).toHaveCount(4);
 await expect(page.locator(".role-shortcuts a")).toHaveCount(3);
 await page.getByRole("button",{name:"收起岗位待办"}).click();
 await expect(page.locator(".role-content")).toHaveCount(0);
 await expect(page.locator(".hub-event-row").first()).toBeVisible();
 await page.getByRole("button",{name:"查看本岗位待办"}).click();
 await expect(page.locator(".task-row")).toHaveCount(3);
});
test("V38-UI02 同一页面切换角色立刻重算，无权限岗位不显示虚假个人待办",async({page})=>{
 await page.goto("/operations/events?focus=tasks",{waitUntil:"networkidle"});
 await role(page,"duty");
 await expect(page.locator(".role-headline")).toContainText("2 项");
 await expect(page.locator(".task-row")).toHaveCount(2);
 await expect(page.locator(".task-row").filter({hasText:"登记处理结果"})).toHaveCount(0);
 await role(page,"engineer");
 await expect(page.locator(".role-headline")).toContainText("1 项");
 await expect(page.locator(".task-row")).toHaveCount(1);
 await expect(page.locator(".task-row")).toContainText("WO-2026-014");
 await role(page,"manager");
 await expect(page.locator(".role-headline")).toContainText("0 项");
 await expect(page.locator(".no-tasks")).toContainText("并不意味着设备");
 await expect(page.locator(".role-shortcuts")).toContainText("工单验收");
 await role(page,"water");
 await expect(page.locator(".role-shortcuts")).toContainText("水源优化");
 await expect(page.locator(".task-row")).toHaveCount(0);
 await role(page,"viewer");
 await expect(page.locator(".task-row")).toHaveCount(0);
 await expect(page.locator(".role-shortcuts")).toContainText("只读");
});
test("V38-UI03 值班员通过任务进入同一设备确认告警；岗位计数随原状态变化且不自动关闭",async({page})=>{
 await page.goto("/operations/events?focus=tasks");
 await role(page,"duty");
 const original=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {orders:s.workorders.length,alarm:s.alarms.find(a=>a.id==="ALM-P002-01")?.status};
 });
 await expect(page.locator(".task-row")).toHaveCount(2);
 await page.locator(".task-row").filter({hasText:"中压供水2号泵振动偏高"}).click();
 await expect(page).toHaveURL(/assetId=asset-p002&tab=events/);
 await page.getByRole("button",{name:"确认告警"}).first().click();
 await page.goto("/operations/events?focus=tasks");
 await expect(page.locator(".task-row")).toHaveCount(1);
 const next=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {orders:s.workorders.length,alarm:s.alarms.find(a=>a.id==="ALM-P002-01")?.status};
 });
 expect(original.alarm).toBe("active");
 expect(next.alarm).toBe("acknowledged");
 expect(next.orders).toBe(original.orders);
 await expect(page.locator(".hub-event-row").filter({hasText:"ALM-P002-01"})).toBeVisible();
});
test("V38-UI04 运维办理→管理者待验收→验收归档，岗位队列各阶段不留幽灵任务",async({page})=>{
 await page.goto("/operations/events?focus=tasks");
 await role(page,"engineer");
 await page.locator(".task-row").filter({hasText:"WO-2026-014"}).click();
 await expect(page).toHaveURL(/operations\/workorders\?workOrderId=wo-2026-014/);
 const drawer=page.locator(".n-drawer:visible");
 await expect(drawer).toContainText("维修中");
 await drawer.getByRole("button",{name:"提交处理结果",exact:true}).click();
 await drawer.getByPlaceholder("故障 / 异常原因（必填）").fill("模拟现场复核：泵组联轴器偏差");
 await drawer.getByPlaceholder("处理措施（必填）").fill("模拟处置：重新对中并复测振动、核验仪表采样");
 await drawer.getByRole("button",{name:"确认提交处理结果"}).click();
 await expect(drawer).toContainText("待验收");
 await page.goto("/operations/events?focus=tasks");
 await expect(page.locator(".task-row")).toHaveCount(0);
 await role(page,"manager");
 await expect(page.locator(".task-row")).toHaveCount(1);
 await expect(page.locator(".task-row")).toContainText("验收或退回");
 await page.locator(".task-row").first().click();
 await expect(page.locator(".n-drawer:visible")).toContainText("待验收");
 await page.locator(".n-drawer:visible").getByRole("button",{name:"验收通过并归档",exact:true}).click();
 await page.locator(".n-drawer:visible").getByRole("button",{name:"确认验收通过",exact:true}).click();
 await page.goto("/operations/events?focus=tasks");
 await expect(page.locator(".task-row")).toHaveCount(0);
 await expect(page.locator(".hub-event-row").filter({hasText:"ALM-P002-01"})).toBeVisible();
 await expect(page.locator(".role-shortcuts")).toContainText("工单验收");
 const after=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {alarm:s.alarms.find(x=>x.id==="ALM-P002-01")?.status,
   workOrder:s.workorders.find(x=>x.id==="wo-2026-014")?.status};
 });
 expect(after.alarm).toBe("active");
 expect(after.workOrder).toBe("archived");
});
test("V38-UI05 值守产生待核查异常后自动纳入岗位队列，不自动生成重复工单",async({page})=>{
 await page.goto("/operations/events?focus=tasks");
 await role(page,"duty");
 const before=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const {useUnattendedStore}=await import("/src/demo/unattendedStore.ts");
  return {orders:useDemoStore().workorders.length,duty:useUnattendedStore().events.length};
 });
 await page.evaluate(async()=>{
  const {useUnattendedStore}=await import("/src/demo/unattendedStore.ts");
  useUnattendedStore().simulate("pressure");
 });
 await expect(page.locator(".task-row")).toHaveCount(3);
 await expect(page.locator(".task-row").filter({hasText:"供水压力"})).toHaveCount(1);
 await page.locator(".task-row").filter({hasText:"供水压力"}).click();
 await expect(page).toHaveURL(/operations\/events\?tab=duty&eventId=UT-/);
 const after=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const {useUnattendedStore}=await import("/src/demo/unattendedStore.ts");
  return {orders:useDemoStore().workorders.length,duty:useUnattendedStore().events.length};
 });
 expect(after.duty).toBe(before.duty+1);
 expect(after.orders).toBe(before.orders);
});
test("V38-UI06 人为注入引用断裂后只显示核查提示，不能冒充已处理或自动创建工单",async({page})=>{
 await page.goto("/operations/events?focus=tasks");
 const originalCount=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  const alarm=s.alarms.find(x=>x.id==="ALM-P002-01");
  if(!alarm)throw Error("expected seed alarm missing");
  s.userState.alarms.push({...alarm,workOrderId:"WO-NOT-FOUND"});
  return s.workorders.length;
 });
 await expect(page.locator(".role-actions")).toContainText("关联待核");
 await page.getByRole("button",{name:"展开核查清单"}).click();
 await expect(page.locator(".integrity-list")).toContainText("原工单引用失效");
 await expect(page.locator(".integrity-list")).toContainText("不等于已处理");
 expect(await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  return useDemoStore().workorders.length;
 })).toBe(originalCount);
});
test("V38-UI07 小屏展开和收起、页面路由切换无横向溢出与脚本异常",async({page})=>{
 const errors:string[]=[];
 page.on("pageerror",err=>errors.push(err.message));
 await page.setViewportSize({width:390,height:844});
 await page.goto("/operations/events?focus=tasks");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.getByRole("button",{name:"收起岗位待办"}).click();
 await expect(page.locator(".role-content")).toHaveCount(0);
 await page.getByRole("button",{name:"查看本岗位待办"}).click();
 await page.locator(".task-row").first().click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test("V38-UI08 已归档工单不自动关告警；值班确认后管理者必须补充核查依据才能独立关闭",async({page})=>{
 await page.goto("/operations/events?focus=tasks");
 await role(page,"engineer");
 await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  useDemoStore().workOrderAction("wo-2026-014","complete",{
   by:"运维人员（模拟）",result:{cause:"模拟对中偏差",measures:"模拟检修及振动复测"},
  });
 });
 await role(page,"manager");
 await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  useDemoStore().workOrderAction("wo-2026-014","accept",{by:"管理者（模拟）"});
 });
 await expect(page.locator(".role-actions")).toContainText("关联待核");
 await expect(page.locator(".task-row")).toHaveCount(0);
 await role(page,"duty");
 await page.locator(".task-row").filter({hasText:"中压供水2号泵振动偏高"}).click();
 await page.getByRole("button",{name:"确认告警"}).first().click();
 await page.goto("/operations/events?focus=tasks");
 await role(page,"manager");
 await expect(page.locator(".task-row")).toHaveCount(1);
 await expect(page.locator(".task-row")).toContainText("人工核查依据后关闭");
 await page.locator(".task-row").first().click();
 await expect(page).toHaveURL(/operations\/events\?tab=alarms&alarmId=ALM-P002-01/);
 const drawer=page.locator(".n-drawer:visible");
 await expect(drawer).toContainText("独立于工单验收");
 await expect(drawer.getByRole("button",{name:"确认人工核查并关闭模拟告警"})).toBeDisabled();
 await drawer.getByPlaceholder("复核指标（如出口压力 / 振动）").fill("振动速度");
 await drawer.getByPlaceholder("处理前记录值").fill("4.2");
 await drawer.getByPlaceholder("处理后复测值").fill("2.5");
 await drawer.getByPlaceholder("单位（如 MPa）").fill("mm/s");
 await drawer.getByPlaceholder("复测记录编号 / 附件引用（必填）").fill("MOCK-巡检复测-20261117");
 await drawer.getByPlaceholder("复核人员判断和依据说明（必填）").fill("模拟复测已核验且工作票完成，管理者仅确认本地演练闭环");
 await drawer.locator(".manual-closure .n-select").click();
 await page.getByText("现场复核后确认异常解除",{exact:true}).last().click();
 await drawer.getByRole("button",{name:"确认人工核查并关闭模拟告警"}).click();
 await expect(drawer).toContainText("已记录的恢复复核");
 await expect(drawer).toContainText("已关闭");
 await page.goto("/operations/events?focus=tasks");
 await expect(page.locator(".role-headline")).toContainText("0 项");
 const state=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {alarm:s.alarms.find(x=>x.id==="ALM-P002-01")?.status,
   accepted:s.workorders.find(x=>x.id==="wo-2026-014")?.status,
   audit:s.audits.filter(a=>a.action==="alarm:close").map(a=>a.summary)};
 });
 expect(state.alarm).toBe("closed");
 expect(state.accepted).toBe("archived");
 expect(state.audit.some(s=>s.includes("MOCK-巡检复测"))).toBe(true);
});
test("V38-UI09 原告警未验收归档，管理者没有关闭入口",async({page})=>{
 await page.goto("/operations/events?focus=tasks");
 await role(page,"duty");
 await page.locator(".task-row").filter({hasText:"中压供水2号泵振动偏高"}).click();
 await page.getByRole("button",{name:"确认告警"}).first().click();
 await page.goto("/operations/events?focus=tasks");
 await role(page,"manager");
 await expect(page.locator(".task-row")).toHaveCount(0);
 await page.goto("/operations/events?tab=alarms&alarmId=ALM-P002-01");
 await expect(page.locator(".n-drawer:visible")).toContainText("工单未验收归档");
 await expect(page.locator(".n-drawer:visible").getByRole("button",{name:"确认人工核查并关闭模拟告警"})).toHaveCount(0);
});
