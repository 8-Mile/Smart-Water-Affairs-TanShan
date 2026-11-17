import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__v31_engineering")){
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role","admin");
      sessionStorage.setItem("__v31_engineering","1");
    }
  });
});
test("V35兼容：七个业务导航分组可访问港口业务、设备和原档案",async({page})=>{
  await page.goto("/overview");
  await expect(page.locator(".sidebar nav > .nav-item, .sidebar nav > .nav-group")).toHaveCount(7);
  await expect(page.getByRole("link",{name:"运行处置"})).toBeVisible();
  await page.getByRole("link",{name:"运行处置"}).click();
  await expect(page.locator(".event-center")).toBeVisible();
  await page.getByRole("button",{name:"水资源管理"}).click();
  await expect(page.locator("#primary-navigation").getByRole("link",{name:"雨污水处理与回用"})).toBeVisible();
  await page.getByRole("button",{name:"设备运维"}).click();
  await expect(page.locator("#primary-navigation").getByRole("link",{name:"设备与档案"})).toBeVisible();
  await page.locator("#primary-navigation").getByRole("link",{name:"设备与档案"}).click();
  await page.getByRole("link",{name:"档案与案例"}).click();
  await expect(page).toHaveURL(/\/archives$/);
  await expect(page.getByRole("heading",{name:"档案管理",exact:true})).toBeVisible();
});
test("V31-UI02 工程关系展示10条独立联系和14个设施，未确认/禁止路径均有明确提示",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/engineering/registry?focus=topology");
  await expect(page.locator(".topology-metrics")).toContainText("10");
  await expect(page.locator(".topology-metrics")).toContainText("2");
  await expect(page.locator(".relation-item")).toHaveCount(10);
  await expect(page.locator(".relation-detail")).toContainText("REL-02");
  await expect(page.locator(".relation-detail")).toContainText("物理连接待核");
  await page.getByRole("tab",{name:"合规去向"}).click();
  await expect(page.locator(".relation-item")).toHaveCount(1);
  await expect(page.locator(".relation-item")).toContainText("雨前腾库外排");
  await page.locator(".relation-item").click();
  await expect(page.locator(".relation-detail")).toContainText("禁止将模拟超容水量解释为合法外排量");
  await page.getByRole("tab",{name:"全部关系"}).click();
  await expect(page.locator(".relation-item")).toHaveCount(10);
  expect(errors).toEqual([]);
});
test("V31-UI03 中压泵和射雾器不能因同报警就自动确定水路，关联关系下钻到真实前置工程任务",async({page})=>{
  await page.goto("/engineering/registry?focus=topology");
  await page.locator(".relation-item").filter({hasText:"REL-08"}).click();
  await expect(page.locator(".relation-detail")).toContainText("中压供水到射雾末端");
  await expect(page.locator(".relation-detail")).toContainText("未核实");
  await expect(page.locator(".relation-detail")).toContainText("CK-019");
  await expect(page.locator(".relation-detail")).toContainText("CK-021");
  await page.locator(".relation-detail").getByRole("link",{name:/CK-019/}).click();
  await expect(page).toHaveURL(/item=CK-019/);
  await expect(page.locator(".detail-panel")).toContainText("CK-019");
});
test("V31-UI04 资料在DEMO审核后，关系仍显示现场确认0、无控制授权",async({page})=>{
  await page.goto("/engineering/registry?item=CK-019");
  await page.getByPlaceholder("例如：P&ID-待核-001（示例占位符）").fill("DWG-DEMO-TOPO-019");
  await page.getByPlaceholder("至少8字；不得把尚未核实的设施标成已投运").fill("已经收到一份模拟系统图纸但还没有设计院和业主正式盖章");
  await page.getByRole("button",{name:"提交资料待复核"}).click();
  await page.getByPlaceholder("填写至少8字的审核意见（仅DEMO）").fill("只对模拟资料内容进行了审阅，不形成实际物理关系认定");
  await page.getByRole("button",{name:"完成DEMO资料审阅"}).click();
  await page.reload();
  await page.getByRole("button",{name:/02 \/ 水路与控制关系/}).click();
  await page.locator(".relation-item").filter({hasText:"REL-08"}).click();
  await expect(page.locator(".relation-detail")).toContainText("DEMO资料已审阅");
  await expect(page.locator(".topology-metrics")).toContainText("现场签认");
  await expect(page.locator(".topology-head")).toContainText("现场已确认 0/10");
  await expect(page.locator(".gate-note")).toContainText("controlAuthorized=false");
});
test("V31-UI05 六工艺MOCK数据质量和真正现场点验收分开，不谎报已实现24小时值守",async({page})=>{
  await page.goto("/engineering/registry?focus=coverage");
  await expect(page.locator(".coverage-overview")).toContainText("24小时现场自动监护");
  await expect(page.locator(".coverage-overview")).toContainText("未具备证明");
  await expect(page.locator(".coverage header")).toContainText("现场在线接入已验收：0 点");
  await expect(page.locator(".coverage tbody tr")).toHaveCount(6);
  await expect(page.locator(".coverage tbody")).toContainText("含矿污水处理");
  await expect(page.locator(".coverage tbody")).toContainText("射雾器除尘");
  await page.getByRole("button",{name:"查看数据质量与自动化验收判据"}).click();
  await expect(page.locator(".quality-gates")).toContainText("FAT/SAT");
  await expect(page.locator(".quality-gates")).toContainText("盐雾");
});
test("V31-UI06 污染水业务链直接展示相同工程拓扑，禁止外排和除尘/人工湖扩展回用",async({page})=>{
  await page.goto("/water/port-chain?scenario=storm");
  await expect(page.locator(".topology")).toBeVisible();
  await expect(page.locator(".topology .relation-item")).toHaveCount(7);
  await page.locator(".topology .relation-item").filter({hasText:"REL-06"}).click();
  await expect(page.locator(".topology .relation-detail")).toContainText("扩展回用终端");
  await expect(page.locator(".topology .relation-detail")).toContainText("禁止纳入可执行调配");
  await page.locator(".topology .relation-item").filter({hasText:"REL-07"}).click();
  await expect(page.locator(".topology .relation-detail")).toContainText("禁止将模拟超容水量解释为合法外排量");
  await expect(page.locator(".kpis")).toContainText("0");
});
test("V31-UI07 首页保持原港口背景与工艺热点，明确0/10物理确认并下钻至统一工程中心",async({page})=>{
  await page.goto("/overview");
  await expect(page.locator(".hotspot")).toHaveCount(6);
  await expect(page.locator(".core-card")).toHaveCount(3);
  await expect(page.locator(".map-evidence-link")).toContainText("0/10");
  await expect(page.locator(".map-evidence-flag")).toContainText("连通关系待图纸核查");
  await page.locator(".map-evidence-link").click();
  await expect(page).toHaveURL(/\/engineering\/registry/);
  await expect(page.locator(".relation-item")).toHaveCount(10);
});
test("V31-UI08 工程关系UI在桌面、笔记本及手机宽度没有整页横向溢出",async({page})=>{
  await page.goto("/engineering/registry?focus=topology");
  for(const width of [1920,1366,1024,768,390]){
    await page.setViewportSize({width,height:900});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
    await expect(page.locator(".topology .relation-detail")).toBeVisible();
  }
});
