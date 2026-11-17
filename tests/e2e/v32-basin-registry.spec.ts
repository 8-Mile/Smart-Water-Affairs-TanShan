import{test,expect,type Page}from"@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v32_basin")){
   localStorage.clear();localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v32_basin","1");
  }
 });
});
async function createPool(page:Page,code="BASIN-A01"){
 await page.goto("/engineering/registry?focus=basins");
 await page.getByRole("button",{name:"+ 登记池体"}).click();
 await page.getByPlaceholder("如：BASIN-A01（请按批准图纸填写）").fill(code);
 await page.getByPlaceholder("逐池设施名称").fill("污水池现场图纸核对项");
 await page.getByPlaceholder("需提供站点分区实际依据").fill("一号现场分区待现场核实");
 await page.getByPlaceholder("批准图号或待核资料编号").fill("DWG-TP-01-2026");
 await page.getByPlaceholder("如：A01").fill("A01");
 await page.getByPlaceholder("如：采用设计高程基准，参考零点及水准点待核").fill("设计液位高程基准，现场待确认");
 const numberInputs=page.locator(".basin-editor .n-input-number input");
 await numberInputs.nth(0).fill("0");
 await numberInputs.nth(1).fill("5");
 await numberInputs.nth(2).fill("2");
 await page.locator(".basin-editor textarea").fill("0,0\n2,1800\n5,6200");
 await page.getByRole("button",{name:"保存待核查池体草稿"}).click();
 await expect(page.locator(".basin-detail")).toContainText(code);
}
test("V32-UI01 第四个工程工作区可直达，示例曲线和真实工程确认严格分离",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("/engineering/registry?focus=basins");
 await expect(page.locator(".workspace-tabs button")).toHaveCount(5);
 await expect(page.locator(".pool-item")).toHaveCount(2);
 await expect(page.locator(".basin-registry")).toContainText("现场容量已签认：0座");
 await expect(page.locator(".basin-detail")).toContainText("假设污染水池（非实物）");
 await expect(page.locator(".mini-kpis")).toContainText("6,200");
 await expect(page.locator(".mini-kpis")).toContainText("1,800");
 await expect(page.locator(".information")).toContainText("未绑定");
 await expect(page.locator(".vh-plot tbody tr")).toHaveCount(3);
 await page.locator(".pool-item").filter({hasText:"MOCK-POOL-C"}).click();
 await expect(page.locator(".mini-kpis")).toContainText("2,200");
 await expect(page.locator(".mini-kpis")).toContainText("450");
 expect(errors).toEqual([]);
});
test("V32-UI02 用户登记需填写池号、图纸版本、高程基准及递增V-H曲线，支持保存刷新",async({page})=>{
 await createPool(page);
 await expect(page.locator(".pool-item")).toHaveCount(3);
 await expect(page.locator(".basin-detail")).toContainText("资料待审阅");
 await expect(page.locator(".basin-detail")).toContainText("DWG-TP-01-2026");
 await expect(page.locator(".basin-registry .summary")).toContainText("用户登记草稿");
 await page.reload();
 await expect(page.locator(".basin-detail")).toContainText("BASIN-A01");
 const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-v32-basin-registry-v1")??"[]")[0]);
 expect(record.fieldVerified).toBe(false);
 expect(record.controlReleased).toBe(false);
 expect(record.history).toHaveLength(1);
});
test("V32-UI03 错误曲线与遗漏的图纸字段阻止保存，不能生成虚假的有效容量",async({page})=>{
 await page.goto("/engineering/registry?focus=basins");
 await page.getByRole("button",{name:"+ 登记池体"}).click();
 await page.getByPlaceholder("如：BASIN-A01（请按批准图纸填写）").fill("BASIN-TEST-B");
 await page.locator(".basin-editor textarea").fill("0,0\n1,150\n1,600");
 await page.getByRole("button",{name:"保存待核查池体草稿"}).click();
 await expect(page.getByRole("alert")).toContainText("严格递增");
 await expect(page.locator(".pool-item")).toHaveCount(2);
});
test("V32-UI04 修订自动增加版本与留痕，DEMO审阅不能变成现场放行",async({page})=>{
 await createPool(page);
 await page.getByRole("button",{name:"修订资料"}).click();
 await page.getByPlaceholder("逐池设施名称").fill("已申请第二版图纸的污染水池");
 await page.getByRole("button",{name:"保存待核查池体草稿"}).click();
 await expect(page.locator(".detail-title")).toContainText("修订V2");
 await expect(page.locator(".history")).toContainText("修订及审核记录（2）");
 await page.getByPlaceholder("填写复核/退回/归档原因，至少8字").fill("只是核查了人工提交资料，现场设计和设备都未签认");
 await page.getByRole("button",{name:"完成DEMO资料审阅"}).click();
 await expect(page.locator(".basin-detail")).toContainText("仅DEMO已审阅");
 await expect(page.locator(".basin-registry")).toContainText("现场容量已签认：0座");
 await page.reload();
 await expect(page.locator(".basin-detail")).toContainText("仅DEMO已审阅");
});
test("V32-UI05 viewer只读，不得创建或修订池体，不能执行模拟资料审阅",async({page})=>{
 await page.goto("/engineering/registry?focus=basins");
 await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","viewer"));
 await page.reload();
 await expect(page.getByRole("button",{name:"+ 登记池体"})).toBeDisabled();
 await expect(page.getByRole("button",{name:"复制示例为待核草稿"})).toHaveCount(0);
 await expect(page.locator(".pool-item")).toHaveCount(2);
});
test("V32-UI06 雨水与含矿污水工艺页可进入同一个逐池台账，保留SCADA",async({page})=>{
 for(const subsystem of ["rainwater","mining","pool"]){
  await page.goto("/process/"+subsystem);
  await expect(page.locator(".process-engineering-link")).toContainText("逐池V-H台账");
  await page.getByRole("link",{name:/逐池V-H台账/}).click();
  await expect(page).toHaveURL(/\/engineering\/registry\?focus=basins/);
  await expect(page.locator(".basin-detail")).toBeVisible();
 }
});
test("V32-UI07 污染水模型仅导入单座污染池MOCK曲线，要求重算后才可保存",async({page})=>{
 await page.goto("/water/port-chain?scenario=storm");
 await expect(page.locator(".scenario-basins")).toBeVisible();
 await expect(page.locator(".scenario-provenance")).toContainText("MOCK-POOL-D");
 await page.getByRole("button",{name:"加载为MOCK情景"}).click();
 await expect(page.locator(".imported-basin-note")).toContainText("参数未重算");
 await page.getByRole("button",{name:"重算情景和风险"}).click();
 await expect(page.locator(".imported-basin-note")).toContainText("已重算");
 await page.getByRole("button",{name:"保存模拟分析快照"}).click();
 const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-port-chain-demo-run-v3")??"null"));
 expect(record.basinSources).toHaveLength(1);
 expect(record.basinSources[0].id).toBe("MOCK-POLLUTED-POOL");
 expect(record.basinSources[0].fieldVerified).toBe(false);
 expect(record.computed.gap).toBe(0);
});
test("V32-UI08 清水池与污染池是不同角色、分别加载；不能把两座池自动合并",async({page})=>{
 await page.goto("/water/port-chain?scenario=storm");
 await page.getByRole("button",{name:"加载为MOCK情景"}).click();
 await page.locator(".scenario-basins .selectors .n-select").first().click();
 await page.locator(".n-base-select-menu .n-base-select-option").filter({hasText:"清水池（单池）"}).click();
 await expect(page.locator(".scenario-provenance")).toContainText("MOCK-POOL-C");
 await page.getByRole("button",{name:"加载为MOCK情景"}).click();
 await expect(page.locator(".imported-basin-note")).toContainText("MOCK-POLLUTED-POOL");
 await expect(page.locator(".imported-basin-note")).toContainText("MOCK-CLEAR-POOL");
 await page.getByRole("button",{name:"重算情景和风险"}).click();
 await page.getByRole("button",{name:"保存模拟分析快照"}).click();
 const rec=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-port-chain-demo-run-v3")??"null"));
 expect(rec.basinSources).toHaveLength(2);
 expect(rec.inputs.pollutedPoolCapacityM3).toBe(6200);
 expect(rec.inputs.clearPoolCapacityM3).toBe(2200);
 expect(rec.computed.gap).toBe(0);
});
test("V32-UI09 V3.2工程台账在常见视口无整页水平溢出，表单可在笔记本下编辑",async({page})=>{
 await page.goto("/engineering/registry?focus=basins");
 for(const width of [1920,1366,1024,768,390]){
  await page.setViewportSize({width,height:900});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)).toBe(true);
  await expect(page.locator(".basin-detail")).toBeVisible();
 }
 await page.getByRole("button",{name:"+ 登记池体"}).click();
 await expect(page.locator(".basin-editor")).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)).toBe(true);
});

test("V32-UI10 工程台账CSV可下载且不包含模拟池的伪现场记录",async({page})=>{
 await page.goto("/engineering/registry?focus=basins");
 const promise=page.waitForEvent("download");
 await page.getByRole("button",{name:"导出逐池核查台账CSV"}).click();
 const download=await promise;
 expect(download.suggestedFilename()).toMatch(/逐池工程核查台账-V3\.2\.csv/);
 const path=await download.path();
 expect(path).toBeTruthy();
 const {readFile}=await import("node:fs/promises");
 const contents=await readFile(path!,"utf8");
 expect(contents).toContain("池体独立编号");
 expect(contents).not.toContain("MOCK-POOL-D");
 expect(contents).not.toContain("MOCK-POOL-C");
});
