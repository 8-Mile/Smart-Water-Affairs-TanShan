import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v44_initialized")){
   localStorage.clear();
   sessionStorage.setItem("__v44_initialized","1");
  }
  localStorage.setItem("tanggang-demo-role","admin");
 });
});

test("V44-01 fewer menus: run center is direct and role workbench is not duplicated",async({page})=>{
 await page.goto("/overview");
 await expect(page.getByRole("link",{name:"运行处置"})).toBeVisible();
 await expect(page.locator("#primary-navigation")).not.toContainText("岗位工作台");
 await expect(page.locator("#primary-navigation")).not.toContainText("应急协同");
 await expect(page.locator(".work-panel")).toContainText("可办理");
 await expect(page.locator(".work-panel header").getByRole("link",{name:/岗位待办/})).toBeVisible();
 await page.goto("/operations/role-workspace");
 await expect(page).toHaveURL(/operations\/events\?.*focus=tasks/);
 await expect(page.locator(".role-queue")).toHaveCount(1);
 await expect(page.locator(".role-queue.expanded")).toBeVisible();
 await expect(page.locator(".hub-tabs button")).toHaveCount(4);
});

test("V44-02 no navigation: incident > emergency draft > back to original incident",async({page})=>{
 await page.goto("/operations/events");
 await page.locator(".hub-event-row").filter({hasText:"中压供水2号泵振动偏高"}).first().click();
 const original=await page.locator(".hub-detail h3").innerText();
 await page.getByRole("button",{name:"升级应急处置"}).click();
 await expect(page).toHaveURL(/operations\/events\?.*mode=emergency/);
 await expect(page.locator(".hub-collaboration")).toBeVisible();
 await expect(page.locator(".emergency-page")).toContainText("建立应急协同草稿");
 await expect(page.locator(".emergency-linkage")).toContainText("当前来源告警");
 await page.getByRole("button",{name:"创建应急协同草稿"}).click();
 await expect(page.locator(".case-list button")).toHaveCount(1);
 await page.getByRole("button",{name:"返回原事件"}).click();
 await expect(page).toHaveURL(/operations\/events\?tab=queue/);
 await expect(page.locator(".hub-detail h3")).toHaveText(original);
 await page.getByRole("button",{name:"升级应急处置"}).click();
 await expect(page.getByRole("button",{name:/打开来源事件已有应急任务/})).toBeVisible();
 await page.getByRole("button",{name:/打开来源事件已有应急任务/}).click();
 await expect(page.locator(".case-list button")).toHaveCount(1);
 await expect(page.locator(".hub-collaboration-switch button")).toHaveCount(2);
 await page.getByRole("button",{name:"跨系统关联核查"}).click();
 await expect(page.locator(".corr-root")).toBeVisible();
 await page.getByRole("button",{name:/应急任务/}).last().click();
 await expect(page.locator(".case-list button")).toHaveCount(1);
});

test("V44-03 legacy emergency link opens integrated workflow and preserves the same case",async({page})=>{
 await page.goto("/operations/emergency?alarmId=ALM-P002-01");
 await expect(page).toHaveURL(/operations\/events\?.*mode=emergency/);
 await expect(page.locator(".hub-tabs button")).toHaveCount(4);
 await expect(page.locator(".emergency-linkage")).toContainText("ALM-P002-01");
 await page.getByRole("button",{name:"创建应急协同草稿"}).click();
 await expect(page.locator(".case-list button")).toHaveCount(1);
 await page.reload();
 await expect(page.locator(".case-list button")).toHaveCount(1);
 await expect(page.locator(".emergency-page")).toBeVisible();
});

test("V44-04 no overflow in single operations workspace or legacy entry",async({page})=>{
 for(const width of [1600,1366,768,390]){
  await page.setViewportSize({width,height:840});
  for(const url of ["/operations/events","/operations/events?tab=correlation&mode=emergency",
   "/operations/role-workspace","/operations/emergency"]){
   await page.goto(url);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(3);
  }
 }
});

test("V44-05 patrol event escalation retains original event context without inventing an alarm",async({page})=>{
 await page.goto("/operations/events?tab=duty");
 await page.locator(".duty-simple .demo-tools").first().locator("summary").click();
 await page.getByRole("button",{name:"模拟压力异常"}).click();
 await page.locator(".hub-tabs").getByRole("button",{name:/全部事件/}).click();
 await page.locator(".hub-event-row").filter({hasText:"智能巡查"}).first().click();
 const original=await page.locator(".hub-detail h3").innerText();
 await page.getByRole("button",{name:"升级应急处置"}).click();
 await expect(page.locator(".emergency-linkage")).toContainText("当前来源巡查事件");
 await expect(page.locator(".emergency-linkage")).toContainText("duty:");
 await page.getByRole("button",{name:"创建应急协同草稿"}).click();
 await expect(page.locator(".emergency-panel").last()).toContainText("duty:");
 await page.getByRole("link",{name:"返回原始事件"}).click();
 await expect(page).toHaveURL(/operations\/events\?tab=queue/);
 await expect(page.locator(".hub-detail h3")).toHaveText(original);
});
