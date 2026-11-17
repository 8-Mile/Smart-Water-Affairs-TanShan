import { test, expect, type Page } from "@playwright/test";

async function openAI(page:Page, prompt:string):Promise<void> {
  await page.getByRole("banner").getByRole("button",{name:"问 AI", exact:true}).click();
  await page.locator(".n-drawer textarea").first().fill(prompt);
  await page.getByRole("button",{name:"解析指令", exact:true}).click();
}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__water_ai_test")){
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role","manager");
      sessionStorage.setItem("__water_ai_test","1");
    }
  });
  await page.goto("/overview");
});

test("AI1 一句话计算80毫米降雨：调用真实水量模型、解释并携参数跳转",async({page})=>{
  await openAI(page,"分析未来80毫米降雨并比较雨前调蓄方案");
  await expect(page.locator(".water-ai-result")).toBeVisible();
  await expect(page.locator(".water-ai-result")).toContainText("雨前调蓄 · 80毫米");
  await expect(page.locator(".water-ai-metrics")).toContainText("9,360 m³");
  await expect(page.locator(".water-ai-report")).toContainText("方案A");
  await expect(page.locator(".water-ai-result")).toContainText("MOCK");
  await page.getByRole("button",{name:"打开完整业务计算页面"}).click();
  await expect(page).toHaveURL(/\/water\/dispatch\?rainMm=80&source=ai/);
  await expect(page.locator(".metrics")).toContainText("9,360");
});

test("AI2 比较三水源并确认保存，复用业务页面原草稿与权限",async({page})=>{
  await openAI(page,"比较雨水、中水、自来水的供水经济方案");
  await expect(page.locator(".water-ai-result")).toContainText("三水源优化");
  await expect(page.locator(".water-ai-metrics")).toContainText("¥3,640");
  await expect(page.locator(".water-ai-report")).toContainText("关键生产补水");
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-multisource-drafts-v1"))).toBeNull();
  await page.getByRole("button",{name:"确认保存待审核草稿"}).click();
  await expect(page.locator(".water-ai-saved")).toContainText("WS-");
  await expect(page.getByRole("button",{name:"已保存草稿"})).toBeDisabled();
  const drafts=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-multisource-drafts-v1")??"[]"));
  expect(drafts).toHaveLength(1);
  expect(drafts[0].state).toBe("draft");
  expect(drafts[0].source).toBe("MOCK");
  expect(drafts[0].result.savingVsTapYuan).toBe(3640);
  await page.getByRole("button",{name:"打开完整业务计算页面"}).click();
  await expect(page).toHaveURL(/\/water\/multi-source\?scenario=normal&source=ai/);
  await expect(page.locator("main")).toContainText("待审核供水建议草稿");
  await expect(page.locator(".draft")).toHaveCount(1);
});

test("AI3 雨前80mm计算确认保存，原调蓄页面刷新后读取同一份草稿",async({page})=>{
  await openAI(page,"分析80毫米降雨并比较雨前调蓄方案");
  await page.getByRole("button",{name:"确认保存待审核草稿"}).click();
  const drafts=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-water-dispatch-drafts-v1")??"[]"));
  expect(drafts).toHaveLength(1);
  expect(drafts[0].parameters.rainMm).toBe(80);
  await page.getByRole("button",{name:"打开完整业务计算页面"}).click();
  await expect(page.locator(".draft")).toHaveCount(1);
});

test("AI4 中水水质不达标：模拟限制并正确传入业务页面",async({page})=>{
  await openAI(page,"比较多水源方案，中水水质不达标怎么办");
  await expect(page.locator(".water-ai-result")).toContainText("中水水质异常模拟");
  await expect(page.locator(".water-ai-report")).toContainText("中水0 m³");
  await page.getByRole("button",{name:"打开完整业务计算页面"}).click();
  await expect(page).toHaveURL(/scenario=quality/);
  await expect(page.locator(".source-card").nth(1)).toContainText("0 m³ 已使用");
});

test("AI5 供水不足不允许保存为完整建议",async({page})=>{
  await openAI(page,"分析多水源供水能力不足方案");
  await expect(page.locator(".water-ai-result")).toContainText("供水不足模拟");
  await expect(page.locator(".water-ai-result")).toContainText("存在供水缺口");
  await expect(page.getByRole("button",{name:"确认保存待审核草稿"})).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-multisource-drafts-v1"))).toBeNull();
});

test("AI6 查询值守事件：与原值守中心共享实时事件ID",async({page})=>{
  await page.goto("/intelligent/unattended");
  await page.locator(".demo-tools").first().locator("summary").click();
  await page.getByRole("button",{name:"模拟压力异常"}).click();
  await expect(page.locator(".event-item")).toHaveCount(1);
  await openAI(page,"查询当前无人值守待处理事件");
  await expect(page.locator(".water-ai-result")).toContainText("UT-00001");
  await expect(page.locator(".water-ai-result")).toContainText("中压供水");
  await expect(page.locator(".water-ai-result")).toContainText("1/6");
  await expect(page.getByRole("button",{name:"确认保存待审核草稿"})).toHaveCount(0);
});

test("AI7 运维人员允许查看方案但不得写水务草稿",async({page})=>{
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","engineer"));
  await page.reload();
  await openAI(page,"分析80毫米降雨并比较雨前调蓄方案");
  await expect(page.locator(".water-ai-result")).toContainText("80毫米");
  await expect(page.getByRole("button",{name:"确认保存待审核草稿"})).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-water-dispatch-drafts-v1"))).toBeNull();
});

test("AI8 生产控制请求不得绕过解析器落到水务工具",async({page})=>{
  await openAI(page,"启动P-002水泵并分析80毫米降雨调蓄方案");
  await expect(page.locator(".intent-card")).toContainText("不受支持");
  await expect(page.locator(".intent-card")).toContainText("生产控制");
  await expect(page.locator(".water-ai-result")).toHaveCount(0);
});

test("AI9 多雨量指令必须明确拒绝歧义，不能偷偷选第一个",async({page})=>{
  await openAI(page,"比较30毫米和80毫米降雨的调蓄方案");
  await expect(page.locator(".intent-card")).toContainText("一次只支持一个降雨量");
  await expect(page.locator(".water-ai-result")).toHaveCount(0);
});

test("AI10 在雨前调蓄当前页问AI并保存，路由复用时草稿立即可见",async({page})=>{
  await page.goto("/water/dispatch");
  await openAI(page,"分析未来80毫米降雨并比较雨前调蓄方案");
  await page.getByRole("button",{name:"确认保存待审核草稿"}).click();
  await page.getByRole("button",{name:"打开完整业务计算页面"}).click();
  await expect(page).toHaveURL(/rainMm=80/);
  await expect(page.locator(".draft")).toHaveCount(1);
  await expect(page.locator(".draft")).toContainText(["80"]);
  await expect(page.locator(".metrics")).toContainText("9,360");
});

test("AI11 在多水源当前页问AI并保存，水质情景和草稿同时同步",async({page})=>{
  await page.goto("/water/multi-source");
  await openAI(page,"比较多水源方案，中水水质不达标怎么办");
  await page.getByRole("button",{name:"确认保存待审核草稿"}).click();
  await page.getByRole("button",{name:"打开完整业务计算页面"}).click();
  await expect(page).toHaveURL(/scenario=quality/);
  await expect(page.locator(".draft")).toHaveCount(1);
  await expect(page.locator(".source-card").nth(1)).toContainText("0 m³ 已使用");
});
