import {expect,test} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v37")){
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v37","1");
  }
 });
});

test("V37-UI01 台账原入口进入同设备工作台，监测、告警、巡检和档案原业务均在",async({page})=>{
 await page.goto("/operations/assets?assetId=asset-p002",{waitUntil:"networkidle"});
 await page.locator(".asset-journey").getByRole("link",{name:"设备工作台"}).click();
 await expect(page).toHaveURL(/\/operations\/asset-workspace\?assetId=asset-p002/);
 await expect(page.getByRole("heading",{name:"设备统一工作台",level:1})).toBeVisible();
 await expect(page.locator(".asset-banner")).toContainText("P-002");
 await expect(page.locator(".kpi-row .kpi")).toHaveCount(4);
 await expect(page.locator(".workspace-panels")).toContainText("测点与工况");
 await page.getByRole("button",{name:/异常与工单/}).click();
 await expect(page.locator(".workspace-panels")).toContainText("WO-2026-014");
 await page.getByRole("button",{name:/巡检与履历/}).click();
 await expect(page.locator(".workspace-panels")).toContainText("设备巡检");
 await expect(page.locator(".workspace-panels")).toContainText("运维履历");
 await page.getByRole("button",{name:/设备档案/}).click();
 await expect(page.locator(".workspace-panels")).toContainText("设备技术资料");
 await expect(page.locator(".workspace-panels")).toContainText("资料中心");
});

test("V37-UI02 同页打开原工单办理抽屉；告警和巡检不重复生成同一张工单",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-p002&tab=events");
 const before=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  return useDemoStore().workorders.length;
 });
 await page.getByRole("button",{name:"原关联工单"}).first().click();
 const drawer=page.locator(".n-drawer:visible");
 await expect(drawer).toContainText("WO-2026-014");
 await expect(drawer).toContainText("维修中");
 await expect(drawer).toContainText("提交处理结果");
 await drawer.getByRole("button",{name:"关闭"}).first().click().catch(async()=>{await page.keyboard.press("Escape");});
 await page.getByRole("button",{name:/巡检与履历/}).click();
 await page.getByRole("button",{name:"查看原关联工单"}).first().click();
 await expect(page.locator(".n-drawer:visible")).toContainText("WO-2026-014");
 expect(await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  return useDemoStore().workorders.length;
 })).toBe(before);
});

test("V37-UI03 在单设备页人工登记异常巡检，并明确转成唯一草稿，不自动派单",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-p002&tab=inspection");
 const before=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {inspections:s.inspections.length,orders:s.workorders.length};
 });
 await page.getByRole("button",{name:"新增巡检记录"}).click();
 await expect(page.locator(".inspection-form")).toContainText("P-002");
 await page.getByRole("button",{name:"保存当前设备巡检记录"}).click();
 await expect(page.locator(".inspection-form [role=alert]")).toContainText("检查项和检查结果不能为空");
 const checks=page.locator(".inspection-item");
 expect(await checks.count()).toBeGreaterThanOrEqual(2);
 for(let i=0;i<await checks.count();i++)
  await checks.nth(i).getByPlaceholder("检查结果（必填）").fill(i===0?"检查发现渗漏":"正常");
 await checks.first().getByRole("checkbox",{name:"异常"}).check();
 await page.getByRole("button",{name:"保存当前设备巡检记录"}).click();
 await expect(page.locator(".inspection-form")).toHaveCount(0);
 await expect(page.locator(".workspace-panels")).toContainText("检查发现渗漏");
 const after=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {inspections:s.inspections.length,orders:s.workorders.length,
    record:s.inspections.find(x=>x.id.startsWith("INS-USER-"))};
 });
 expect(after.inspections).toBe(before.inspections+1);
 expect(after.orders).toBe(before.orders);
 expect(after.record?.assetId).toBe("asset-p002");
 expect(after.record?.result).toBe("abnormal");
 await page.locator(".record").filter({hasText:"检查发现渗漏"}).getByRole("button",{name:"异常转工单草稿"}).click();
 await expect(page.locator(".n-drawer:visible")).toContainText("巡检异常");
 const created=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return s.workorders.filter(x=>x.evidenceIds.includes(s.inspections.find(i=>i.id.startsWith("INS-USER-"))?.id??""))
    .map(x=>({id:x.id,status:x.status}));
 });
 expect(created).toHaveLength(1);
 expect(created[0].status).toBe("draft");
 // New action still uses original workflow; no implicit dispatch.
 await page.reload();
 await page.getByRole("button",{name:/巡检与履历/}).click();
 await expect(page.locator(".workspace-panels")).toContainText("检查发现渗漏");
 const saved=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return s.workorders.filter(x=>x.evidenceIds.includes(s.inspections.find(i=>i.id.startsWith("INS-USER-"))?.id??"")).length;
 });
 expect(saved).toBe(1);
});

test("V37-UI04 只读角色只能核查，确认告警、新增巡检和建单均不可操作",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-p002");
 await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  useDemoStore().setRole("viewer");
 });
 await page.getByRole("button",{name:/异常与工单/}).click();
 await expect(page.getByRole("button",{name:"确认告警"})).toBeDisabled();
 await page.getByRole("button",{name:/巡检与履历/}).click();
 await expect(page.getByRole("button",{name:"新增巡检记录"})).toBeDisabled();
 await expect(page.locator(".workspace-panels")).toContainText("仅能查看记录");
 await page.getByRole("button",{name:"查看原关联工单"}).first().click();
 await expect(page.locator(".n-drawer:visible")).toContainText("WO-2026-014");
});

test("V37-UI05 不存在的assetId不回退到另一台设备；切换设备重设当前工作区",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-not-found");
 await expect(page.getByRole("alert")).toContainText("设备编号不可用");
 await expect(page.locator(".workspace-main .kpi-row")).toHaveCount(0);
 await page.locator(".asset-choice").filter({hasText:"SP-001"}).click();
 await expect(page).toHaveURL(/assetId=asset-sp001/);
 await expect(page.locator(".asset-banner")).toContainText("SP-001");
 await expect(page.locator(".kpi").first()).toContainText("非泵类设备不评分");
 await expect(page.locator(".workspace-panels")).toContainText("非泵类设备不套用");
});

test("V37-UI06 原设备详情抽屉有工作台入口；跳转后清除旧弹层",async({page})=>{
 await page.goto("/operations/assets");
 await page.getByRole("cell",{name:"P-002",exact:true}).click();
 await expect(page.locator(".n-drawer:visible")).toBeVisible();
 await page.locator(".n-drawer:visible").getByRole("link",{name:/进入设备统一工作台/}).click();
 await expect(page).toHaveURL(/\/operations\/asset-workspace\?assetId=asset-p002/);
 await expect(page.locator(".n-drawer:visible")).toHaveCount(0);
});

test("V37-UI07 在小屏下设备选择、四工作区均无横向溢出或脚本错误",async({page})=>{
 const errors:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});
 await page.goto("/operations/asset-workspace?assetId=asset-p002");
 for(const tab of ["状态与监测","异常与工单","巡检与履历","设备档案"]){
  await page.getByRole("button",{name:new RegExp(tab)}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 }
 await expect(page.locator(".asset-choices")).toBeVisible();
 expect(errors).toEqual([]);
});

test("V37-UI08 从设备工作台办理原工单到验收归档；履历可追溯且不改设备物理状态",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-p002&tab=events");
 const before=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {status:s.getAsset("asset-p002")?.status,count:s.workorders.length};
 });
 await page.locator(".order-row").filter({hasText:"WO-2026-014"}).click();
 const drawer=page.locator(".n-drawer:visible");
 await expect(drawer).toContainText("维修中");
 await drawer.getByRole("button",{name:"提交处理结果",exact:true}).click();
 await drawer.getByPlaceholder("故障 / 异常原因（必填）").fill("模拟原因：联轴器对中偏差，待现场复核");
 await drawer.getByPlaceholder("处理措施（必填）").fill("模拟处置：复测振动、检查联轴器并记录处理结果");
 await drawer.getByRole("button",{name:"确认提交处理结果"}).click();
 await expect(drawer).toContainText("待验收");
 await drawer.getByRole("button",{name:"验收通过并归档",exact:true}).click();
 await drawer.getByRole("button",{name:"确认验收通过",exact:true}).click();
 await expect(drawer).toContainText("已归档并写入设备履历");
 const after=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore(),o=s.workorders.find(x=>x.code==="WO-2026-014");
  return {status:s.getAsset("asset-p002")?.status,count:s.workorders.length,
   orderStatus:o?.status,accept:o?.acceptance?.accepted,
   timeline:s.timeline("asset-p002").some(x=>x.summary.includes("WO-2026-014")&&x.summary.includes("accept"))};
 });
 expect(after.count).toBe(before.count);
 expect(after.status).toBe(before.status);
 expect(after.orderStatus).toBe("archived");
 expect(after.accept).toBe(true);
 expect(after.timeline).toBe(true);
 await page.reload();
 await page.getByRole("button",{name:/异常与工单/}).click();
 await expect(page.locator(".order-row").filter({hasText:"WO-2026-014"})).toContainText("已归档");
});

test("V37-UI09 巡检填写未保存时切换设备和离开工作台均需明确确认",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-p002&tab=inspection");
 await page.getByRole("button",{name:"新增巡检记录"}).click();
 await page.locator(".inspection-item").first().getByPlaceholder("检查结果（必填）").fill("尚未保存的检查内容");
 await page.locator(".asset-choice").filter({hasText:"SP-001"}).click();
 await expect(page.locator(".n-dialog")).toContainText("巡检记录尚未保存");
 await page.getByRole("button",{name:"继续编辑"}).click();
 await expect(page).toHaveURL(/assetId=asset-p002/);
 await expect(page.locator(".inspection-form")).toContainText("登记设备：P-002");
 await page.getByRole("link",{name:"完整设备台账与配置"}).click();
 await expect(page.locator(".n-dialog")).toContainText("离开设备工作台会丢失");
 await page.getByRole("button",{name:"继续编辑"}).click();
 await expect(page).toHaveURL(/asset-workspace/);
 await page.locator(".asset-choice").filter({hasText:"SP-001"}).click();
 await page.getByRole("button",{name:"丢弃并继续"}).click();
 await expect(page).toHaveURL(/assetId=asset-sp001/);
 await expect(page.locator(".inspection-form")).toHaveCount(0);
});

test("V37-UI10 工单抽屉已归档后直接回当前设备履历，处理中可返回本页监测",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-p002&tab=events");
 await page.locator(".order-row").filter({hasText:"WO-2026-011"}).click();
 const drawer=page.locator(".n-drawer:visible");
 await expect(drawer).toContainText("已归档");
 await drawer.getByRole("button",{name:"查看设备履历"}).click();
 await expect(page).toHaveURL(/assetId=asset-p002&tab=inspection/);
 await expect(page.locator(".n-drawer:visible")).toHaveCount(0);
 await expect(page.locator(".workspace-panels")).toContainText("运维履历");
 await page.getByRole("button",{name:/异常与工单/}).click();
 await page.locator(".order-row").filter({hasText:"WO-2026-014"}).click();
 await page.locator(".n-drawer:visible").getByRole("button",{name:"打开设备详情"}).click();
 await expect(page).toHaveURL(/assetId=asset-p002&tab=monitor/);
 await expect(page.locator(".n-drawer:visible")).toHaveCount(0);
 await expect(page.locator(".workspace-panels")).toContainText("测点与工况");
});

test("V37-UI11 告警确认只更新原告警并记录审计，不关闭事件也不增加工单",async({page})=>{
 await page.goto("/operations/asset-workspace?assetId=asset-p002&tab=events");
 const before=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {alarm:s.alarms.find(x=>x.id==="ALM-P002-01")?.status,
   workorders:s.workorders.length,audit:s.audits.length,status:s.getAsset("asset-p002")?.status};
 });
 expect(before.alarm).toBe("active");
 await page.getByRole("button",{name:"确认告警"}).click();
 await expect(page.locator(".record").filter({hasText:"ALM-P002-01"})).toContainText("已确认");
 const after=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return {alarm:s.alarms.find(x=>x.id==="ALM-P002-01")?.status,
   workorders:s.workorders.length,audit:s.audits.length,status:s.getAsset("asset-p002")?.status};
 });
 expect(after.alarm).toBe("acknowledged");
 expect(after.workorders).toBe(before.workorders);
 expect(after.audit).toBe(before.audit+1);
 expect(after.status).toBe(before.status);
 await page.reload();
 await page.getByRole("button",{name:/异常与工单/}).click();
 await expect(page.locator(".record").filter({hasText:"ALM-P002-01"})).toContainText("已确认");
});
