import {test,expect,type Page} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v34_product")){
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v34_product","1");
  }
 });
});
async function saveMock(page:Page){
 await page.goto("/engineering/registry?focus=balance");
 await page.getByRole("button",{name:"填入一组异常演示样例"}).click();
 await page.getByRole("button",{name:"计算单池水量残差"}).click();
 await page.getByRole("button",{name:"保存待核快照"}).click();
 const items=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-v33-basin-balance-v1")??"[]"));
 expect(items).toHaveLength(1);
 return items[0].id as string;
}
test("V34-UI01 三条港口业务线在原业务页面可顺序导航且不宣称已连通",async({page})=>{
 await page.goto("/water/port-chain?scenario=storm");
 const nav=page.locator(".business-journey");
 await expect(nav).toContainText("港口业务流程导航");
 await expect(nav).toContainText("未经证实的管网关系不自动串接");
 await expect(nav.locator(".journey-link")).toHaveCount(3);
 await nav.getByRole("link",{name:/港口生产用水保障/}).click();
 await expect(page).toHaveURL(/\/intelligent\/correlation/);
 await expect(page.locator(".business-journey .journey-link.active")).toContainText("港口生产用水保障");
 await page.locator(".business-journey").getByRole("link",{name:/集中值守与处置/}).click();
 await expect(page).toHaveURL(/\/intelligent\/unattended/);
 await page.locator(".business-journey").getByRole("link",{name:/污染水收集/}).click();
 await expect(page).toHaveURL(/\/water\/port-chain/);
});
test("V34-UI02 单池核查导出JSON、人工受理和MOCK演练结束不伪造设备工单",async({page})=>{
 const id=await saveMock(page);
 await expect(page).toHaveURL(new RegExp("caseId="+id));
 const downloadPromise=page.waitForEvent("download");
 await page.getByRole("button",{name:"导出本机核查备份"}).click();
 const download=await downloadPromise;
 expect(download.suggestedFilename()).toContain("tanggang-basin-balance-backup");
 const content=await download.path();
 expect(content).toBeTruthy();
 await page.getByPlaceholder("至少8字：说明准备核实什么问题").fill("已经核对计量口径仍属模拟异常");
 await page.getByRole("button",{name:"人工受理疑似偏差"}).click();
 await page.getByPlaceholder("至少8字：说明MOCK演练结果与现场资料缺口").fill("模拟演练结束，真正的现场异常仍需独立核查");
 await page.getByRole("button",{name:/结束本次MOCK演练/}).click();
 await expect(page.locator(".task-detail")).toContainText("MOCK演练结束");
 await expect(page.locator(".history")).toContainText("3");
 const items=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-v33-basin-balance-v1")??"[]"));
 expect(items[0].status).toBe("demo_finished");
 expect(items[0].linkedWorkOrderId).toBeUndefined();
});
test("V34-UI03 已知BB核查证据可在原工单详情展开并回跳到单池记录",async({page})=>{
 const id=await saveMock(page);
 const orderId=await page.evaluate(async balanceCaseId=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const store=useDemoStore();
  const order=store.createWorkOrder({
   title:"[回归证据] "+balanceCaseId,
   assetId:"asset-p002",source:"manual",
   symptom:"仅用于验证工单证据回跳",suggestion:"请核验BB原记录",
   evidenceIds:[balanceCaseId],
  });
  return order.id;
 },id);
 await page.goto("/operations/workorders?workOrderId="+orderId+
  "&returnTo="+encodeURIComponent("/engineering/registry?focus=balance&pool=MOCK-POLLUTED-POOL&caseId="+id));
 await expect(page.locator(".order-return")).toBeVisible();
 const button=page.locator(".evidence-item").filter({hasText:"单池水量核查"});
 await expect(button).toContainText("BB-");
 await expect(button).not.toContainText("原文不可用");
 await button.click();
 await expect(button).toContainText("累计进水");
 const link=page.getByRole("link",{name:/查看原始单池核算与人工处置记录/});
 await expect(link).toBeVisible();
 await link.click();
 await expect(page).toHaveURL(/\/engineering\/registry\?focus=balance/);
 await expect(page).toHaveURL(new RegExp("caseId="+id));
 await expect(page.locator(".task-detail")).toContainText(id);
});
test("V34-UI04 1366宽度单池核算不再被工程顶部大量卡片挤出首屏",async({page})=>{
 await page.setViewportSize({width:1366,height:768});
 await page.goto("/engineering/registry?focus=balance");
 const top=await page.locator(".main-grid").evaluate(el=>el.getBoundingClientRect().top);
 expect(top).toBeLessThan(590);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
 await page.getByRole("button",{name:"最近1小时"}).click();
 await expect(page.locator(".balance-panel .native-datetime").first()).not.toHaveValue("");
});
