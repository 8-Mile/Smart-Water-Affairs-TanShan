import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v35")) {
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v35","1");
  }
 });
});

test("V44-UI01 运行处置为一个直接入口，原业务及水务专业路由仍能访问",async({page})=>{
 await page.goto("/overview",{waitUntil:"networkidle"});
 await expect(page.getByRole("link",{name:"综合总览"})).toBeVisible();
 await expect(page.locator("#primary-navigation .nav-group")).toHaveCount(5);
 await expect(page.getByRole("link",{name:"运行处置"})).toBeVisible();
 await expect(page.locator("#primary-navigation")).not.toContainText("岗位工作台");
 await expect(page.locator("#primary-navigation")).not.toContainText("应急协同");
 await page.locator("#primary-navigation .nav-group").filter({hasText:"水资源管理"}).click();
 await expect(page.locator(".nav-children .nav-item")).toHaveCount(4);
 await expect(page.getByRole("link",{name:"供需动态平衡"})).toBeVisible();
 await page.getByRole("link",{name:"运行处置"}).click();
 await expect(page).toHaveURL(/operations\/events/);
 await page.goto("/decision/four-pre");
 await expect(page.locator(".nav-group.open")).toContainText("水资源管理");
 await expect(page.locator(".nav-children .nav-item.active")).toContainText("供需动态平衡");
 await page.goto("/operations/alarms?status=active");
 await expect(page).toHaveURL(/operations\/alarms/);
 await expect(page.locator(".sidebar")).toContainText("运行处置");
});
test("V35-UI02 统一队列查看来源与原事件，进入告警处理仍在同工作台",async({page})=>{
 await page.goto("/operations/events");
 await expect(page.locator(".hub-intro h2")).toHaveText("事件汇总与业务处置");
 await expect(page.locator(".hub-stats>div")).toHaveCount(4);
 await expect(page.locator(".hub-event-row").first()).toBeVisible();
 await page.locator(".hub-event-row").first().click();
 await expect(page.locator(".hub-detail")).toContainText("原始事件描述");
 await page.getByRole("button",{name:"在本工作台处理原事件"}).click();
 await expect(page).toHaveURL(/\/operations\/events\?tab=alarms/);
 await expect(page.locator(".hub-tabs .selected")).toContainText("生产告警");
 await expect(page.locator(".event-center")).toContainText("告警事件");
 await expect(page.locator(".hub-tabs")).toBeVisible();
});
test("V35-UI03 值守模拟事件出现在统一队列，但不自动创建第二张工单",async({page})=>{
 await page.goto("/operations/events?tab=duty");
 await page.locator(".duty-simple .demo-tools").first().locator("summary").click();
 await expect(page.getByRole("button",{name:"模拟压力异常"})).toBeVisible();
 await page.getByRole("button",{name:"模拟压力异常"}).click();
 await expect(page.locator(".duty-simple")).toContainText("需要处理的事件");
 await page.locator(".hub-tabs").getByRole("button",{name:/全部事件/}).click();
 await expect(page.locator(".hub-list")).toContainText("智能巡查");
 await expect(page.locator(".hub-list")).toContainText("UT-");
 const state=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  return useDemoStore().workorders.length;
 });
 await page.locator(".hub-event-row").filter({hasText:"智能巡查"}).first().click();
 await expect(page.locator(".hub-related").last()).toContainText("不会自动合并");
 expect(await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  return useDemoStore().workorders.length;
 })).toBe(state);
});
test("V35-UI04 协同与原路由可访问；小屏宽度不产生整页溢出",async({page})=>{
 await page.setViewportSize({width:1366,height:768});
 await page.goto("/operations/events?tab=correlation");
 await expect(page.locator(".event-center")).toContainText("跨系统异常关联诊断");
 await expect(page.locator(".business-journey")).toHaveCount(0);
 await page.locator(".hub-tabs").getByRole("button",{name:/值守巡查/}).click();
 await expect(page.locator(".duty-simple")).toBeVisible();
 await expect(page.locator(".business-journey")).toHaveCount(0);
 await page.goto("/intelligent/unattended");
 await expect(page.locator(".duty-simple")).toBeVisible();
 await page.goto("/intelligent/correlation");
 await expect(page.locator(".corr-root")).toBeVisible();
 await page.goto("/operations/events");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test("V35-UI05 合并后水资源三工作台的内部功能仍能访问",async({page})=>{
 await page.goto("/water/overview");
 const tabs=page.locator(".workspace-nav");
 await expect(tabs.getByRole("link")).toHaveCount(3);
 await tabs.getByRole("link",{name:"雨次分析"}).click();
 await expect(page).toHaveURL(/\/water\/rainfall$/);
 await tabs.getByRole("link",{name:"水量账本"}).click();
 await expect(page).toHaveURL(/\/water\/ledger$/);
 await page.goto("/water/dispatch");
 await page.locator(".workspace-nav").getByRole("link",{name:"风险预演"}).click();
 await expect(page).toHaveURL(/\/decision\/four-pre$/);
 await page.goto("/water/multi-source");
 await page.locator(".workspace-nav").getByRole("link",{name:"成本效益"}).click();
 await expect(page).toHaveURL(/\/water\/green-benefit$/);
});
test("V35-UI06 合并后设备、档案、AI看板及系统设置均有可发现的内部入口",async({page})=>{
 await page.goto("/operations/assets");
 await page.locator(".workspace-nav").getByRole("link",{name:"档案与案例"}).click();
 await expect(page).toHaveURL(/\/archives$/);
 await page.locator(".workspace-nav").getByRole("link",{name:"设备台账与履历"}).click();
 await expect(page).toHaveURL(/\/operations\/assets$/);
 await page.goto("/data/ai-workspace");
 await page.locator(".workspace-nav").getByRole("link",{name:"我的看板"}).click();
 await expect(page).toHaveURL(/\/data\/my-dashboards$/);
 await page.goto("/admin/roles");
 await expect(page.locator(".workspace-nav").getByRole("link")).toHaveCount(4);
 await page.locator(".workspace-nav").getByRole("link",{name:"设备配置"}).click();
 await expect(page).toHaveURL(/\/admin\/asset-config$/);
 await page.locator(".workspace-nav").getByRole("link",{name:"环境与操作日志"}).click();
 await expect(page).toHaveURL(/\/admin\/demo$/);
});
