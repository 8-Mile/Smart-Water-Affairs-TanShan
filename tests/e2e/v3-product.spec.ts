import {test,expect,type Page} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v3_trial")){
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v3_trial","1");
  }
 });
});
async function role(page:Page,id:string){
 await page.evaluate(r=>localStorage.setItem("tanggang-demo-role",r),id);
 await page.reload();
}
test("V3-UI01 首页四个关键业务信号和三条港口业务入口，六工艺、AI快捷入口不丢",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("/overview");
 await expect(page.locator(".metric")).toHaveCount(4);
 await expect(page.locator(".core-card")).toHaveCount(3);
 await expect(page.locator(".core-business")).toContainText("暴雨污染水");
 await expect(page.locator(".core-business")).toContainText("含矿污水");
 await expect(page.locator(".core-business")).toContainText("环保供水");
 await expect(page.locator(".flow-layer")).toHaveCount(0);
 await expect(page.locator(".hotspot")).toHaveCount(6);
 await expect(page.locator(".metric-supply")).toContainText("水质待核");
 await expect(page.locator(".metric-environment")).toContainText("终端待核");
 await expect(page.locator(".green-source")).toContainText("非实时分表数据");
 await expect(page.locator(".green-metric")).toHaveCount(3);
 await expect(page.locator(".green-port-metrics")).toContainText("雨水");
 await expect(page.getByRole("banner").getByRole("button",{name:"问 AI"})).toBeVisible();
 await page.locator(".core-card").first().click();
 await expect(page).toHaveURL(/\/water\/port-chain\?scenario=storm/);
 await expect(page.getByRole("heading",{name:/污染雨水收集/})).toBeVisible();
 expect(errors).toEqual([]);
});
test("V3-UI02 首页响应式与原港口场景示意都可访问，不暗示系统间已经连通",async({page})=>{
 await page.goto("/overview");
 for(const width of [1920,1366,1024,768,390]){
  await page.setViewportSize({width,height:width<=768?850:950});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await expect(page.locator(".core-card")).toHaveCount(3);
  await expect(page.locator(".map-evidence-flag")).toContainText("待图纸核查");
 }
});
test("V3-UI03 工程核查中心保留49/41/31/12编号且检索、溯源和业务跳转都有效",async({page})=>{
 await page.goto("/engineering/registry");
 await expect(page.getByRole("heading",{name:"工程事实 · 仪表能力 · 建设缺口"})).toBeVisible();
 await expect(page.locator(".engineering .metrics")).toContainText("49");
 await expect(page.locator(".engineering .metrics")).toContainText("41");
 await expect(page.locator(".engineering .metrics")).toContainText("31");
 await expect(page.locator(".engineering .metrics")).toContainText("12");
 await expect(page.locator(".entry")).toHaveCount(31);
 await expect(page.locator(".source-box")).toContainText("P0现场核查清单!A6");
 await page.getByRole("tab",{name:"测点与硬件"}).click();
 await expect(page.locator(".entry")).toHaveCount(41);
 await page.getByPlaceholder("按编号、工艺、问题、缺口搜索").fill("PT-017");
 await expect(page.locator(".entry")).toHaveCount(1);
 await expect(page.locator(".entry")).toContainText("射雾供水末端");
 await page.locator(".entry").click();
 await expect(page).toHaveURL(/item=PT-017/);
 await expect(page.locator(".source-box")).toContainText("测点及硬件台账");
 await page.getByRole("tab",{name:"工程口径冲突"}).click();
 await expect(page.locator(".entry")).toHaveCount(12);
 await expect(page.locator(".entry").filter({hasText:"ISS-03"})).toContainText("70,638.9");
});
test("V3-UI04 工程证据可登记、只保留DEMO资料审阅，不能伪造正式现场放行",async({page})=>{
 await page.goto("/engineering/registry?item=CK-015");
 await expect(page.locator(".detail-top")).toContainText("CK-015");
 await page.getByPlaceholder("例如：P&ID-待核-001（示例占位符）").fill("PIPING-DEMO-TEST-15");
 await page.getByPlaceholder("至少8字；不得把尚未核实的设施标成已投运").fill("码头面冲洗水路需要设计院与业主确认，尚未验收投运");
 await page.getByRole("button",{name:"提交资料待复核"}).click();
 await expect(page.locator(".submitted")).toContainText("PIPING-DEMO-TEST-15");
 await expect(page.locator(".submitted")).toContainText("资料待复核");
 await page.getByPlaceholder("填写至少8字的审核意见（仅DEMO）").fill("仅在DEMO里审阅了图号，现场仍需正式签认与检查");
 await page.getByRole("button",{name:"完成DEMO资料审阅"}).click();
 await expect(page.locator(".submitted")).toContainText("DEMO资料已审阅");
 await expect(page.locator(".engineering .gate-banner")).toContainText("G0 工程事实未签认");
 await expect(page.locator(".engineering .metrics")).toContainText("正式工程已放行 0 项");
 await page.reload();
 await expect(page.locator(".submitted")).toContainText("PIPING-DEMO-TEST-15");
});
test("V3-UI05 只读人员看得到工程缺口但不能提交，工程人员不能直接审核",async({page})=>{
 await page.goto("/engineering/registry?item=CK-013");
 await role(page,"viewer");
 await expect(page.getByRole("button",{name:"提交资料待复核"})).toBeDisabled();
 await expect(page.locator(".detail-panel")).toContainText("CK-013");
 await role(page,"engineer");
 await page.getByPlaceholder("例如：P&ID-待核-001（示例占位符）").fill("WATER-QUALITY-PID-1");
 await page.getByPlaceholder("至少8字；不得把尚未核实的设施标成已投运").fill("工程审核前需要确认水质指标采样方法和合同边界");
 await page.getByRole("button",{name:"提交资料待复核"}).click();
 await expect(page.getByRole("button",{name:"完成DEMO资料审阅"})).toHaveCount(0);
 await role(page,"manager");
 await expect(page.getByRole("button",{name:"完成DEMO资料审阅"})).toBeVisible();
});
test("V3-UI06 暴雨污染水默认阻断不合格出水和虚构回用，超容不当合法外排",async({page})=>{
 await page.goto("/water/port-chain?scenario=storm");
 await expect(page.locator(".chain-root .kpis")).toContainText("9,979.2");
 await expect(page.locator(".chain-root .kpis")).toContainText("5,579.2");
 await expect(page.locator(".chain-root .kpis")).toContainText("0");
 await expect(page.locator(".bottlenecks")).toContainText("水质");
 await expect(page.locator(".bottlenecks")).toContainText("入站");
 await expect(page.locator(".bottlenecks")).toContainText("管线");
 await expect(page.locator(".not-allowed")).toContainText("未经批准");
 await expect(page.locator(".gate-banner")).toHaveCount(0);
 await expect(page.locator(".evidence-warning")).toContainText("未通过 G0 / G1 / G2");
 await page.getByRole("button",{name:"极端演练 100mm"}).click();
 await expect(page.locator(".chain-root .kpis")).toContainText("16,632");
});
test("V3-UI07 演示两端管路和水质通过后才可产生模拟处理与冲洗回用，保持工程未放行",async({page})=>{
 await page.goto("/water/port-chain?scenario=normal");
 const selects=page.locator(".controls .n-select");
 await expect(selects).toHaveCount(3);
 await selects.nth(0).click();
 await page.locator(".n-base-select-menu .n-base-select-option").filter({hasText:"仅演示假设污染池与处理站可达"}).click();
 await selects.nth(1).click();
 await page.locator(".n-base-select-menu .n-base-select-option").filter({hasText:"仅演示假设检测合格"}).click();
 await selects.nth(2).click();
 await page.locator(".n-base-select-menu .n-base-select-option").filter({hasText:"仅演示假设管路可达"}).click();
 await expect(page.locator(".control-actions")).toContainText("条件已修改");
 await page.getByRole("button",{name:"重算情景和风险"}).click();
 const vals=await page.locator(".kpis strong").allTextContents();
 expect(Number(vals[1].replace(/[^\d.]/g,""))).toBeGreaterThan(0);
 expect(Number(vals[2].replace(/[^\d.]/g,""))).toBeGreaterThan(0);
 await expect(page.locator(".evidence-warning")).toContainText("未通过 G0 / G1 / G2");
 await page.getByRole("button",{name:"保存模拟分析快照"}).click();
 await expect(page.locator(".saved")).toContainText("PCHAIN-");
 const data=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-port-chain-demo-run-v3")??"null"));
 expect(data.status).toBe("MOCK");
 expect(data.computed.gap).toBe(0);
 expect(data.sourceIds).toContain("CK-013");
});
test("V3-UI08 工艺页有P0证据和业务链入口，生活污水页不再宣称本项目建有二沉池",async({page})=>{
 await page.goto("/process/domestic");
 await expect(page.getByRole("heading",{name:"生活污水收集与外送"})).toBeVisible();
 await expect(page.locator(".process-engineering-link")).toContainText("外部既有处理站");
 await expect(page.locator(".process-engineering-link")).toContainText("CK-018");
 await expect(page.getByText("缺氧池",{exact:true})).toHaveCount(0);
 await expect(page.getByText("二沉池",{exact:true})).toHaveCount(0);
 await page.goto("/process/mining");
 await expect(page.locator(".process-engineering-link")).toContainText("CK-013");
 await page.locator(".process-engineering-link").getByRole("link",{name:/港口业务链/}).click();
 await expect(page).toHaveURL(/\/water\/port-chain/);
 await page.goto("/process/rainwater");
 await expect(page.locator(".process-engineering-link")).toContainText("CK-007");
});
test("V3-UI09 射雾器不重做SCADA，追加工程核查/供水影响业务下钻",async({page})=>{
 await page.goto("/process/spray");
 await expect(page.locator(".spray-v3-evidence")).toContainText("不认定中压泵与射雾器已连通");
 await expect(page.locator(".spray-v3-evidence")).toContainText("CK-021");
 await expect(page.locator(".spray-v3-evidence")).toContainText("CK-022");
 await page.locator(".spray-v3-evidence").getByRole("link",{name:/CK-021/}).click();
 await expect(page).toHaveURL(/engineering\/registry\?item=CK-021/);
});
test("V3-UI10 V3菜单扩展保持原工艺/智能/运维/AI与档案模块，不强制变成新系统",async({page})=>{
 await page.goto("/overview");
 await expect(page.locator(".sidebar nav > .nav-item, .sidebar nav > .nav-group")).toHaveCount(9);
 await page.getByRole("button",{name:"工程基础"}).click();
 await expect(page.getByRole("link",{name:"工程核查与证据"})).toBeVisible();
 await page.getByRole("link",{name:"工程核查与证据"}).click();
 await expect(page.locator(".entry")).toHaveCount(31);
 await page.getByRole("button",{name:"港口核心业务"}).click();
 await expect(page.getByRole("link",{name:"污染水处理与回用业务链"})).toBeVisible();
 await expect(page.locator(".sidebar")).toContainText("分析与看板");
});
