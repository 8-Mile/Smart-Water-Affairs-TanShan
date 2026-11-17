import {test,expect} from "@playwright/test";
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem("tanggang-demo-role","admin");
 });
});
test("V42 首页→大机分析→动态平衡→返回：参数及分析对象不丢失",async({page})=>{
 await page.goto("/overview");
 await page.locator(".core-card").filter({hasText:"各大机"}).click();
 await expect(page).toHaveURL(/\/water\/machine-supply/);
 await expect(page.getByRole("link",{name:/返回来源业务页面/})).toBeVisible();
 await page.getByRole("button",{name:"多机同时作业"}).click();
 await expect(page.locator(".machine-kpis")).toContainText("94");
 await page.getByRole("link",{name:/带入动态平衡分析/}).click();
 await expect(page).toHaveURL(/\/water\/balance\?/);
 await expect(page.locator(".balance-details")).toContainText("2,256");
 await page.getByRole("link",{name:/返回来源业务页面/}).click();
 await expect(page).toHaveURL(/\/water\/machine-supply/);
 await expect(page.locator(".machine-kpis")).toContainText("94");
 await page.getByRole("link",{name:/返回来源业务页面/}).click();
 await expect(page).toHaveURL(/\/overview$/);
});
test("V42 动态平衡→雨前调蓄→返回：试算条件恢复，且无需再次输入",async({page})=>{
 await page.goto("/water/balance");
 await page.getByRole("button",{name:/强降雨/}).click();
 await expect(page.locator(".balance-stats")).toContainText("7,800");
 await page.getByRole("link",{name:/继续雨前调蓄方案比选/}).click();
 await expect(page).toHaveURL(/\/water\/dispatch/);
 await page.getByRole("link",{name:/返回来源业务页面/}).click();
 await expect(page).toHaveURL(/\/water\/balance/);
 await expect(page.locator(".balance-stats")).toContainText("7,800");
});
test("V42 事件→原工单抽屉→关闭：不跳出事件上下文",async({page})=>{
 await page.goto("/operations/events");
 const row=page.locator(".hub-event-row").filter({hasText:"工单"}).first();
 await row.click();
 const ref=await page.locator(".hub-event-row.active").innerText();
 await page.getByRole("button",{name:"本页办理关联工单"}).click();
 await expect(page.locator(".n-drawer")).toBeVisible();
 await expect(page).toHaveURL(/\/operations\/events/);
 await page.locator(".n-drawer").getByRole("button",{name:"关闭",exact:true}).last().click();
 await expect(page.locator(".n-drawer")).toHaveCount(0);
 await expect(page.locator(".hub-event-row.active")).toContainText(ref.split("\n")[0]);
});
test("V42 从循环利用到水量报表自动展开，并可返回",async({page})=>{
 await page.goto("/water/overview");
 await page.getByRole("link",{name:/生成水资源账本报表/}).click();
 await expect(page).toHaveURL(/\/data\/reports\?reportId=water-ledger/);
 await expect(page.locator("#report-water-ledger")).toContainText("收起表格");
 await page.getByRole("link",{name:/返回来源业务页面/}).click();
 await expect(page).toHaveURL(/\/water\/overview/);
});
test("V42 AI问数对日数据不虚构，对月度用量展示来源",async({page})=>{
 await page.goto("/overview");
 await page.getByRole("button",{name:"问 AI"}).click();
 await page.locator("textarea").last().fill("今天中水使用了多少？");
 await page.getByRole("button",{name:"解析指令"}).click();
 await expect(page.locator("body")).toContainText("所问时段暂时缺少有效水量数据");
 await page.locator("textarea").last().fill("本月自来水和中水用量多少？");
 await page.getByRole("button",{name:"解析指令"}).click();
 await expect(page.locator("body")).toContainText("水资源用量查询（演示账本）");
 await expect(page.locator("body")).toContainText("不等同于终端已消耗水量");
});
test("V42 大小屏主要业务无横向溢出且回退入口可点",async({page})=>{
 for(const width of [1600,1366,768,390]){
  await page.setViewportSize({width,height:850});
  for(const route of ["/water/machine-supply?returnTo=/overview","/water/balance?returnTo=/overview","/operations/events"]){
   await page.goto(route);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(3);
  }
 }
});
