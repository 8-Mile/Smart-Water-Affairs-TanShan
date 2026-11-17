import {expect,test} from "@playwright/test";

test("V4.1 首页与水资源总览显示循环利用入口和明确的缺数口径",async({page})=>{
 await page.goto("/overview");
 await expect(page.getByRole("link",{name:/自来水 · 中水 · 循环水/})).toBeVisible();
 await expect(page.getByText("设备健康需关注")).toBeVisible();
 await page.goto("/water/overview");
 await expect(page.getByText("循环水循环量")).toBeVisible();
 await expect(page.getByText("缺少洗车台及其他循环回路计量")).toBeVisible();
 await page.goto("/water/ledger");
 await expect(page.getByText("跨环节出项（不可直接累计）")).toBeVisible();
 await expect(page.getByText("循环利用归属")).toBeVisible();
});

test("V4.1 多机并行需水与动态平衡联动，缺口不冒充可执行调度",async({page})=>{
 await page.goto("/water/machine-supply");
 await expect(page.getByText("各大机供水保障").first()).toBeVisible();
 await page.getByRole("button",{name:"多机同时作业"}).click();
 await expect(page.locator(".machine-kpis .danger")).toContainText("14");
 await expect(page.getByText("管网末端压力")).toBeVisible();
 await page.getByRole("link",{name:/带入动态平衡分析/}).click();
 await expect(page.getByText("水资源动态平衡分析")).toBeVisible();
 await page.getByRole("button",{name:/强降雨/}).click();
 await expect(page.getByText(/暂存超出假设池容/)).toBeVisible();
 await page.getByRole("link",{name:/把同周期大机需水带入多水源匹配/}).click();
 await expect(page.getByText(/已从动态平衡页带入同周期大机需水/)).toBeVisible();
});

test("V4.1 修正工艺口径并保留事件与工单独立时间线",async({page})=>{
 await page.goto("/process/mining");
 await expect(page.getByText(/需进站总管流量 PT-009/)).toBeVisible();
 await page.goto("/process/domestic");
 await expect(page.getByText("生活污水收集与外送").first()).toBeVisible();
 await expect(page.getByText("曝气风机")).toHaveCount(0);
 await page.goto("/operations/events");
 await page.getByRole("button",{name:/中压供水2号泵振动偏高/}).first().click();
 await expect(page.getByText(/事件与工单时间线/)).toBeVisible();
 await expect(page.getByText(/工单已归档不代表现场测点恢复/)).toBeVisible();
});

test("V4.1 主页面没有横向溢出",async({page})=>{
 for(const path of ["/overview","/water/overview","/water/machine-supply","/water/balance","/operations/events"]){
  await page.goto(path);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(3);
 }
});


test("V4.1 AI自然语言导航能找到大机供水、动态平衡与循环利用",async({page})=>{
 await page.goto("/overview");
 const requests=[
  ["查看大机供水保障","/water/machine-supply"],
  ["打开动态平衡","/water/balance"],
  ["进入循环水管理","/water/overview"],
 ];
 for(const [request,path] of requests){
  await page.getByRole("button",{name:"问 AI"}).click();
  await page.locator("textarea").last().fill(request);
  await page.getByRole("button",{name:"解析指令"}).click();
  await expect(page).toHaveURL(new RegExp(path+"$"));
 }
});
