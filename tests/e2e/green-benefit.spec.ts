import {test,expect,type Page} from "@playwright/test";

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__green_benefit")){
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role","manager");
      sessionStorage.setItem("__green_benefit","1");
    }
  });
  await page.goto("/water/green-benefit");
});
async function setRole(page:Page,role:string){
  await page.evaluate(value=>localStorage.setItem("tanggang-demo-role",value),role);
  await page.reload();
}
test("G1 核算页默认三水源1700m³，原费用、追加成本及净差额可追溯",async({page})=>{
  await expect(page.getByRole("heading",{name:/节水节能与运营净效益/})).toBeVisible();
  await expect(page.locator(".metric")).toHaveCount(4);
  await expect(page.locator(".metrics")).toContainText("1,700");
  await expect(page.locator(".metrics")).toContainText("1,250");
  await expect(page.locator(".metrics")).toContainText("¥6,120");
  await expect(page.locator(".metrics")).toContainText("¥2,861.75");
  await expect(page.locator(".money-line.final-cost")).toContainText("¥3,258.25");
  await expect(page.locator(".money-line").filter({hasText:"追加用电成本"})).toContainText("215 kWh");
  await expect(page.locator(".source-row")).toHaveCount(3);
  await expect(page.locator(".source-row").filter({hasText:"中水"})).toContainText("600 m³");
  await expect(page.locator(".subtle")).toContainText("不自动计算碳减排");
});
test("G2 中水水质受限时禁用中水，其他合法水源可替代但不编造供水量",async({page})=>{
  await page.getByRole("button",{name:"中水水质受限"}).click();
  await expect(page.locator(".source-row").filter({hasText:"中水"})).toContainText("0 m³");
  await expect(page.locator(".metrics")).toContainText("1,700");
  await expect(page.locator(".source-balance").filter({hasText:"未满足供水"})).toContainText("0 m³");
});
test("G3 供水能力不足或全自来水基准不可行时停止披露条件净收益且禁用保存",async({page})=>{
  await page.getByRole("button",{name:"供水能力不足"}).click();
  await expect(page.locator(".stop-notice")).toContainText("无法满足全部需求");
  await expect(page.locator(".metric.net")).toContainText("净差额暂不可比");
  await expect(page.getByRole("button",{name:"保存本期条件净效益待复核草稿"})).toBeDisabled();
  await page.getByRole("button",{name:"正常成本"}).click();
  await page.getByRole("button",{name:"调整成本与供水条件"}).click();
  const tap=page.locator(".source-edit").filter({hasText:"自来水"});
  await tap.getByText("本期库存(m³)").locator("..").locator("input").fill("1000");
  await tap.getByText("供水能力(m³)").locator("..").locator("input").fill("1000");
  await page.getByRole("button",{name:"按当前参数重新计算"}).click();
  await expect(page.locator(".stop-notice")).toContainText("全自来水基准");
  await expect(page.getByRole("button",{name:"保存本期条件净效益待复核草稿"})).toBeDisabled();
});
test("G4 增量固定成本过高时明确展示负收益，不做绿色宣传式虚假报喜",async({page})=>{
  await page.getByRole("button",{name:"成本导致净增支"}).click();
  await expect(page.locator(".metric.net")).toContainText("条件模拟净增支");
  await expect(page.locator(".metric.net")).toContainText("¥698.25");
  await expect(page.locator(".money-line.result-line")).toContainText("−¥698.25");
});
test("G5 用户修改数值但未重新计算，保存必须禁用；重新计算后结果随费用变化",async({page})=>{
  await page.getByRole("button",{name:"调整成本与供水条件"}).click();
  const fixed=page.locator(".common-inputs label").nth(1).locator("input");
  await fixed.fill("800");await fixed.press("Tab");
  await expect(page.locator(".config-actions")).toContainText("结果仍为上次有效测算");
  await expect(page.getByRole("button",{name:"保存本期条件净效益待复核草稿"})).toBeDisabled();
  await page.getByRole("button",{name:"按当前参数重新计算"}).click();
  await expect(page.locator(".metric.net")).not.toContainText("¥2,861.75");
  await expect(page.getByRole("button",{name:"保存本期条件净效益待复核草稿"})).toBeEnabled();
});
test("G6 费用排重范围未确认，不允许显示或保存净收益，即使基础费用差为正",async({page})=>{
  await page.getByRole("button",{name:"调整成本与供水条件"}).click();
  await page.getByText("DEMO排重假设：以下新增费用均未包含在原来源单方综合费用中（不是现场已审核）").click();
  await page.getByRole("button",{name:"按当前参数重新计算"}).click();
  await expect(page.locator(".stop-notice")).toContainText("成本边界未确认");
  await expect(page.locator(".metric.net")).toContainText("暂不可比");
  await expect(page.getByRole("button",{name:"保存本期条件净效益待复核草稿"})).toBeDisabled();
});
test("G7 管理者保存待核算草稿，刷新可查；只读访客不能保存",async({page})=>{
  await page.getByRole("button",{name:"保存本期条件净效益待复核草稿"}).click();
  await expect(page.locator(".draft-list>div")).toHaveCount(1);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-green-benefit-drafts-v1")??"[]"));
  expect(stored).toHaveLength(1);
  expect(stored[0].result.netDeltaYuan).toBe(2861.75);
  expect(stored[0].source).toBe("MOCK");
  await page.reload();
  await page.getByRole("button",{name:/查看草稿/}).click();
  await expect(page.locator(".draft-list")).toContainText("GNB-");
  await setRole(page,"viewer");
  await expect(page.getByRole("button",{name:"保存本期条件净效益待复核草稿"})).toBeDisabled();
  await expect(page.locator(".metrics")).toContainText("1,700");
});
test("G8 保存过的三水源供水建议可显式载入并重新计算，不复制旧节约数字",async({page})=>{
  await page.goto("/water/multi-source");
  await page.getByRole("button",{name:"保存待审核的供水建议"}).click();
  const drafts=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-multisource-drafts-v1")??"[]"));
  expect(drafts).toHaveLength(1);
  await page.goto("/water/green-benefit");
  await page.getByRole("button",{name:"载入最近供水草稿"}).click();
  await expect(page.locator(".draft-source")).toContainText(drafts[0].id);
  await expect(page.locator(".metrics")).toContainText("1,700");
  await page.getByRole("button",{name:"保存本期条件净效益待复核草稿"}).click();
  const result=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-green-benefit-drafts-v1")??"[]"));
  expect(result[0].result.sourceDraftId).toBe(drafts[0].id);
});
test("G9 水量账本与泵组电耗独立作为核对入口，不把不同周期数据乘进财务实绩",async({page})=>{
  await expect(page.locator(".evidence-strip")).toContainText("历史水量账本");
  await expect(page.locator(".evidence-strip")).toContainText("未并入本期成本");
  await expect(page.locator(".evidence-strip")).toContainText("独立MOCK能效评估");
  await expect(page.locator(".evidence-strip a[href='/water/ledger']")).toHaveCount(1);
  await expect(page.locator(".evidence-strip a[href='/decision/health?tab=energy']")).toHaveCount(1);
  await page.getByRole("button",{name:"查看所有限制条件"}).click();
  await expect(page.locator(".boundary-list")).toContainText("不能形成真实项目ROI");
});
test("G10 水源库存没有独立核实时回用禁用，全自来水可比也不能算出无中生有的节约",async({page})=>{
  await page.getByRole("button",{name:"调整成本与供水条件"}).click();
  await page.getByText("雨水与中水库存为分别确认的不同水源（仅演示假设）").click();
  await page.getByRole("button",{name:"按当前参数重新计算"}).click();
  await expect(page.locator(".source-row").filter({hasText:"雨水"})).toContainText("0 m³");
  await expect(page.locator(".source-row").filter({hasText:"中水"})).toContainText("0 m³");
  await expect(page.locator(".metric.net")).toContainText("¥0");
  await expect(page.locator(".metrics")).toContainText("0 m³");
});
test("G11 全局导航可从综合总览异步进入绿色效益页，再返回原多水源页面",async({page})=>{
  await page.goto("/overview");
  await page.getByRole("button",{name:"水资源管理"}).click();
  await page.locator("#primary-navigation").getByRole("link",{name:"水源优化与效益"}).click();
  await page.locator(".workspace-nav").getByRole("link",{name:"成本效益"}).click();
  await expect(page).toHaveURL(/\/water\/green-benefit/);
  await expect(page.locator(".metrics")).toContainText("1,700");
  await page.getByRole("link",{name:"查看三水源分配约束"}).click();
  await expect(page).toHaveURL(/\/water\/multi-source/);
  await expect(page.getByRole("heading",{name:/多水源供需与经济优化/})).toBeVisible();
});
