import {test,expect} from "@playwright/test";
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem("tanggang-demo-role","admin");
 });
});
test("V43 P0 rain: solution snapshot > submit > adopt > track > close with trace",async({page})=>{
 await page.goto("/water/balance");
 await page.getByRole("button",{name:/强降雨/}).click();
 await page.getByRole("button",{name:"保存当前试算为独立草稿"}).click();
 await expect(page.locator(".balance-workflow")).toContainText("模拟草稿");
 await page.locator(".workflow-form").last().locator('textarea').fill("请求管理者核对降雨时段的调蓄方案");
 await page.getByRole("button",{name:"提交人工研判"}).click();
 await expect(page.locator(".balance-workflow")).toContainText("待管理复核");
 await page.getByPlaceholder("编号必填，不代表正式调度许可").fill("MOCK-APPROVAL-01");
 await page.getByPlaceholder("填写实际负责角色/人员").fill("值班负责人");
 await page.locator(".workflow-form").last().locator('textarea').fill("这是演示条件下的拟采纳方案，不下发工控指令");
 await page.getByRole("button",{name:"拟采纳并指定跟踪"}).click();
 await expect(page.locator(".balance-workflow")).toContainText("内部拟采纳");
 await page.getByPlaceholder("现场记录引用，人工录入").fill("FOLLOW-UP-01");
 await page.locator(".workflow-form").last().locator('textarea').fill("复核当前模型参数，结果仍为演示计算");
 await page.getByRole("button",{name:"按当前参数补录复核结果"}).click();
 await expect(page.locator(".balance-workflow")).toContainText("已补录跟踪");
 await page.getByPlaceholder("现场记录引用，人工录入").fill("REVIEW-01");
 await page.locator(".workflow-form").last().locator('textarea').fill("复盘结果风险仍需实地数据和真实水质核查");
 await page.getByRole("button",{name:"提交人工复盘归档"}).click();
 await expect(page.locator(".balance-workflow")).toContainText("复盘归档");
 await expect(page.locator(".workflow-history li")).toHaveCount(5);
 await page.reload();
 await expect(page.locator(".balance-workflow")).toContainText("复盘归档");
});
test("V43 P0 emergency: draft > plan verification > per-role evidence > human replay",async({page})=>{
 await page.goto("/operations/emergency");
 await page.getByRole("button",{name:"创建应急协同草稿"}).click();
 await expect(page.locator(".emergency-panel").last()).toContainText("待核预案");
 await page.getByPlaceholder("预案编号 / 审批引用，必填").fill("PLAN-DEMO-01");
 await page.getByPlaceholder("角色/责任人").fill("指挥岗位负责人");
 await page.getByPlaceholder("设备/人员/物资的可用情况及尚待核条件").fill("备用泵、物资及联络方式均待现场核实");
 const contact=page.getByPlaceholder("指定联络人 / 责任人");
 await expect(contact).toHaveCount(3);
 for(let i=0;i<3;i++)await contact.nth(i).fill("岗位联络人"+i);
 await page.getByRole("button",{name:"核对并启动本地协同演练"}).click();
 await expect(page.locator(".emergency-panel").last()).toContainText("岗位协同中");
 const openFeedback=page.getByRole("button",{name:"填写本岗位反馈"});
 for(let i=0;i<3;i++){
  await openFeedback.first().click();
  await page.getByPlaceholder("现场核查与采取措施；不可仅填已处理").fill("已核对模拟场景和责任组织，记录后续措施");
  await page.getByPlaceholder("现场记录或图片引用编号（必填）").fill("EVIDENCE-"+i);
  await page.getByRole("button",{name:"记录人工反馈"}).click();
 }
 await expect(page.getByText("已反馈",{exact:true})).toHaveCount(3);
 await page.getByPlaceholder("影响范围、协同处置过程").fill("三个岗位已提供模拟核查证据，无自动调度");
 await page.getByRole("button",{name:"全部任务反馈后提交复盘"}).click();
 await page.getByPlaceholder("恢复与未解决事项、后续动作").fill("演示任务已完成，真实生产恢复须继续现场核查");
 await page.getByPlaceholder("复盘依据编号（必填）").fill("REVIEW-EVIDENCE-01");
 await page.getByRole("button",{name:"人工复核并归档"}).click();
 await expect(page.locator(".emergency-history")).toContainText("完成模拟复盘归档");
 await page.reload();
 await expect(page.locator(".emergency-panel").last()).toContainText("已复盘归档");
});
test("V43 P1 water data: KPI source deep drill > detail > manual mapping > internal review",async({page})=>{
 await page.goto("/water/overview");
 await page.getByRole("link",{name:/自来水补水量/}).click();
 await expect(page).toHaveURL(/\/water\/ledger\?source=/);
 await expect(page.locator(".n-data-table-tbody .n-data-table-tr").first()).toBeVisible();
 await page.locator(".n-data-table-tbody .n-data-table-tr").first().click();
 await expect(page.locator(".ledger-trace")).toContainText("计量点");
 await page.getByPlaceholder("计量点编号/名称（需真实依据）").fill("W-METER-001");
 await page.getByPlaceholder("终端/处理环节名称（未核实不得写已接通）").fill("人工待核的供水终端");
 await page.getByPlaceholder("图纸或测点资料编号").fill("DWG-EXAMPLE-001");
 await page.getByPlaceholder("人工记录说明及待核条件").fill("仍需要核查实际管线连通关系");
 await page.getByRole("button",{name:"提交计量映射待审"}).click();
 await expect(page.locator(".ledger-trace")).toContainText("待内部资料审核");
 await page.getByPlaceholder("内部资料复核说明（不等于现场验证）").fill("仅在内部图纸中核对，现场尚未验收");
 await page.getByRole("button",{name:"审核资料引用"}).click();
 await expect(page.locator(".ledger-trace")).toContainText("内部资料已审核");
 await page.reload();
 await expect(page.locator(".ledger-trace")).toContainText("W-METER-001");
});
test("V43 P1 AI water report: query > A2UI chart > save dashboard > draft report > review",async({page})=>{
 await page.goto("/data/ai-workspace?mode=water&prompt="+encodeURIComponent("生成近30天三类水资源使用趋势，并加入含矿污水处理量对比"));
 await expect(page.locator(".a2ui-surface")).toContainText("水量来源与外供");
 await expect(page.locator(".a2ui-surface")).toContainText("日粒度数据不可用");
 await expect(page.locator(".a2ui-surface")).toContainText("循环水回路计量缺失");
 await expect(page.locator(".a2ui-surface")).toContainText("含矿污水处理出站");
 await page.getByRole("button",{name:"保存看板",exact:true}).last().click();
 await expect(page.locator(".canvas-meta")).toContainText("已保存");
 await page.getByRole("button",{name:"生成待审水资源报告草稿"}).click();
 await expect(page).toHaveURL(/\/data\/reports\?analysisId=WAR-/);
 await expect(page.locator("#water-analysis-report")).toContainText("待审核");
 await expect(page.locator(".analysis-body")).toContainText("按月");
 await page.getByPlaceholder("审核依据和缺数限制（至少6字）").fill("已核对月度账本来源及循环水缺数限制");
 await page.getByRole("button",{name:"人工审核并归档DEMO草稿"}).click();
 await expect(page.locator("#water-analysis-report")).toContainText("已审核");
});
test("V43 P1 role workspace and emergency/ledger small screens remain usable",async({page})=>{
 for(const width of [1366,768,390]){
  await page.setViewportSize({width,height:840});
  for(const p of ["/operations/role-workspace","/operations/emergency","/water/balance","/water/ledger?source=中水","/data/ai-workspace?mode=water"]){
   await page.goto(p);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(3);
  }
 }
});
