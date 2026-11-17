import {test,expect,type Page} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v33_basin")){
   localStorage.clear();localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v33_basin","1");
  }
 });
});
async function demoDiscrepancy(page:Page){
 await page.goto("/engineering/registry?focus=balance");
 await page.getByRole("button",{name:"填入一组异常演示样例"}).click();
 await page.getByRole("button",{name:"计算单池水量残差"}).click();
 await expect(page.locator(".result-kpis")).toContainText("-153.33");
}
async function saveDiscrepancy(page:Page){
 await demoDiscrepancy(page);
 await page.getByRole("button",{name:"保存待核快照"}).click();
 await expect(page.locator(".task-row")).toHaveCount(1);
}
test("V33-UI01 直接访问第五个工程工作区，保持逐池/业务入口和非现场标识",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("/engineering/registry?focus=balance");
 await expect(page.locator(".workspace-tabs button")).toHaveCount(5);
 await expect(page.locator(".balance-panel")).toContainText("单池水量平衡与异常核查");
 await expect(page.locator(".balance-panel")).toContainText("实时生产数据：未接入");
 await expect(page.locator(".balance-panel")).toContainText("自动控制：禁止");
 await expect(page.locator(".result-kpis")).toHaveCount(0);
 expect(errors).toEqual([]);
});
test("V33-UI02 显式MOCK样本计算负残差，修改任意输入后结果失效不能保留旧结论",async({page})=>{
 await demoDiscrepancy(page);
 await expect(page.locator(".diagnosis")).toContainText("疑似偏差");
 await expect(page.locator(".result-kpis")).toContainText("±35");
 const n=page.locator(".balance-panel .editor .n-input-number input");
 await n.nth(2).fill("250");
 await expect(page.locator(".result-kpis")).toHaveCount(0);
 await expect(page.getByRole("button",{name:"保存待核快照"})).toBeDisabled();
});
test("V33-UI03 快照保存刷新仍在；需要人工确认，且不会自动生成工单与报警",async({page})=>{
 await saveDiscrepancy(page);
 await expect(page.locator(".task-detail")).toContainText("疑似偏差");
 await page.reload();
 await expect(page.locator(".task-row")).toHaveCount(1);
 await page.locator(".task-row").first().click();
 await expect(page.locator(".task-detail")).toContainText("待人工受理");
 await page.getByPlaceholder("至少8字：说明准备核实什么问题").fill("先复核同周期计量口径和液位高程基准");
 await page.getByRole("button",{name:"人工受理疑似偏差"}).click();
 await expect(page.locator(".task-detail")).toContainText("已受理");
 await expect(page.locator(".task-detail")).toContainText("MOCK示意池");
 await expect(page.getByRole("button",{name:"创建并关联设备工单草稿"})).toHaveCount(0);
 const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-v33-basin-balance-v1")??"[]"));
 expect(rows[0].history).toHaveLength(2);
 expect(rows[0].linkedWorkOrderId).toBeUndefined();
});
test("V33-UI04 无效时间/越界液位阻止计算; 普通平衡数据不产生疑似偏差",async({page})=>{
 await page.goto("/engineering/registry?focus=balance");
 await page.getByRole("button",{name:"填入一组异常演示样例"}).click();
 const fields=page.locator(".balance-panel input[type=datetime-local]");
 const originalStart=await fields.nth(0).inputValue();
 const originalEnd=await fields.nth(1).inputValue();
 await fields.nth(0).fill(originalEnd); // zero-length window is invalid
 await page.getByRole("button",{name:"计算单池水量残差"}).click();
 await expect(page.locator(".balance-panel .error")).toContainText("起止时间必须为递增");
 await fields.nth(0).fill(originalStart);
 const nums=page.locator(".balance-panel .editor .n-input-number input");
 await nums.nth(0).fill("99");
 await page.getByRole("button",{name:"计算单池水量残差"}).click();
 await expect(page.locator(".balance-panel .error")).toContainText("起始液位");
 await nums.nth(0).fill("2");
 await nums.nth(1).fill("2");
 await nums.nth(2).fill("200");
 await nums.nth(3).fill("200");
 await page.getByRole("button",{name:"计算单池水量残差"}).click();
 await expect(page.locator(".diagnosis")).toContainText("未触发演示阈值");
 await page.getByRole("button",{name:"保存待核快照"}).click();
 await expect(page.locator(".task-row")).toContainText("容差内");
});
test("V33-UI05 viewer只读可核算预览，但不得保存快照或人工受理",async({page})=>{
 await page.addInitScript(()=>localStorage.setItem("tanggang-demo-role","viewer"));
 await demoDiscrepancy(page);
 await expect(page.getByRole("button",{name:"保存待核快照"})).toBeDisabled();
 await expect(page.locator(".task-row")).toHaveCount(0);
});
test("V33-UI06 原污染水业务页可下钻，原SCADA与逐池功能均在",async({page})=>{
 await page.goto("/water/port-chain?scenario=storm");
 await expect(page.locator(".v33-balance-link")).toContainText("单池累计进出水");
 await page.locator(".v33-balance-link a").click();
 await expect(page).toHaveURL(/focus=balance/);
 await expect(page.locator(".balance-panel")).toBeVisible();
 await page.goto("/engineering/registry?focus=basins");
 await page.locator(".detail-buttons a").filter({hasText:"进入单池水量平衡与核查"}).click();
 await expect(page).toHaveURL(/focus=balance/);
});
test("V33-UI07 工作区在常用视口无整页横向溢出",async({page})=>{
 for(const size of [{width:1600,height:900},{width:1366,height:768},{width:1024,height:768},{width:768,height:900},{width:390,height:844}]){
  await page.setViewportSize(size);
  await page.goto("/engineering/registry?focus=balance");
  await expect(page.locator(".balance-panel")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),
   "viewport "+size.width).toBeLessThanOrEqual(1);
 }
});
test("V33-UI08 人工登记池体无专属测点时可核算并受理，但不能随意挂设备工单",async({page})=>{
 await page.goto("/engineering/registry?focus=basins");
 await page.getByRole("button",{name:"+ 登记池体"}).click();
 await page.getByPlaceholder("如：BASIN-A01（请按批准图纸填写）").fill("BASIN-PORT-01");
 await page.getByPlaceholder("逐池设施名称").fill("待核工程污染水池");
 await page.getByPlaceholder("需提供站点分区实际依据").fill("待核实港区现场分区");
 await page.getByPlaceholder("批准图号或待核资料编号").fill("DWG-PORT-2026-01");
 await page.getByPlaceholder("如：A01").fill("A01");
 await page.getByPlaceholder("如：采用设计高程基准，参考零点及水准点待核").fill("设计相对基准，仪表标定未核实");
 const nums=page.locator(".basin-editor .n-input-number input");
 await nums.nth(0).fill("0");await nums.nth(1).fill("5");await nums.nth(2).fill("2");
 await page.locator(".basin-editor textarea").fill("0,0\n2,1800\n5,6200");
 await page.getByRole("button",{name:"保存待核查池体草稿"}).click();
 await expect(page.locator(".basin-detail")).toContainText("BASIN-PORT-01");
 await page.locator(".detail-buttons a").filter({hasText:"进入单池水量平衡与核查"}).click();
 await expect(page).toHaveURL(/focus=balance/);
 await expect(page.locator(".source")).toContainText("BASIN-PORT-01");
 await page.getByRole("button",{name:"填入一组异常演示样例"}).click();
 await page.getByRole("button",{name:"计算单池水量残差"}).click();
 await page.getByRole("button",{name:"保存待核快照"}).click();
 await page.getByPlaceholder("至少8字：说明准备核实什么问题").fill("复核图纸与仪表关联，不能直接归责设备");
 await page.getByRole("button",{name:"人工受理疑似偏差"}).click();
 await expect(page.locator(".task-detail")).toContainText("该池无可用的独立候选仪表资产绑定");
 await expect(page.getByRole("button",{name:"创建并关联设备工单草稿"})).toHaveCount(0);
});
