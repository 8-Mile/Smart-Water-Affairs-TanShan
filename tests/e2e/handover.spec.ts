import {test,expect,type Page} from "@playwright/test";

const instruction="帮我完成今天的运行检查，整理异常情况，生成交班报告";
async function askHandover(page:Page):Promise<void>{
  await page.getByRole("banner").getByRole("button",{name:"问 AI",exact:true}).click();
  await page.locator(".n-drawer textarea").first().fill(instruction);
  await page.getByRole("button",{name:"解析指令",exact:true}).click();
}

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__handover_test_started")){
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role","duty");
      sessionStorage.setItem("__handover_test_started","1");
    }
  });
  await page.goto("/overview");
});

test("H1 一句话执行实际模拟巡查、事件与工单查询，生成有限覆盖的交班预览",async({page})=>{
  await askHandover(page);
  await expect(page.locator(".handover-ai-result")).toBeVisible();
  await expect(page.locator(".handover-ai-result")).toContainText("1/6");
  await expect(page.locator(".handover-ai-result")).toContainText("PAT-00001");
  await expect(page.locator(".handover-steps>div")).toHaveCount(6);
  await expect(page.locator(".handover-ai-result")).toContainText("不代表全天");
  await expect(page.locator(".handover-issues")).toContainText("监护覆盖不完整");
  const raw=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-unattended-demo-v1")??"null"));
  expect(raw.records).toHaveLength(1);
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-handover-reports-v1"))).toBeNull();
});

test("H2 存在值守异常：复用事件ID，不能只报正常",async({page})=>{
  await page.goto("/intelligent/unattended");
  await page.locator(".demo-tools").first().locator("summary").click();
  await page.getByRole("button",{name:"模拟压力异常"}).click();
  await expect(page.locator(".event-item")).toHaveCount(1);
  await askHandover(page);
  await expect(page.locator(".handover-ai-result")).toContainText("UT-00001");
  await expect(page.locator(".handover-ai-result")).toContainText("供水压力异常");
  await page.locator(".handover-preview summary").click();
  const report=(await page.locator(".handover-preview pre").textContent())??"";
  expect(report).toContain("UT-00001");
  expect(report).toContain("当前快照");
});

test("H3 确认保存后原报表中心可见，值班员不能审核；管理者有意见才能审核",async({page})=>{
  await askHandover(page);
  await page.getByRole("button",{name:"确认保存交班报告草稿"}).click();
  await expect(page.locator(".water-ai-saved")).toContainText("HND-");
  await expect(page.getByRole("button",{name:"已保存待审核报告"})).toBeDisabled();
  const docs=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-handover-reports-v1")??"[]"));
  expect(docs).toHaveLength(1);
  expect(docs[0].status).toBe("pending_review");
  expect(docs[0].source).toBe("MOCK");
  const id=docs[0].id;
  await page.getByRole("button",{name:"在常用报表查看草稿"}).click();
  await expect(page).toHaveURL(/\/data\/reports\?handoverId=/);
  await expect(page.locator(".n-drawer")).not.toBeVisible();
  await expect(page.locator(".handover-detail")).toContainText(id);
  await expect(page.getByRole("button",{name:"确认演示审核归档"})).toBeDisabled();
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","manager"));
  await page.reload();
  await expect(page.locator(".handover-detail")).toContainText(id);
  await expect(page.getByRole("button",{name:"确认演示审核归档"})).toBeDisabled();
  await page.locator(".handover-review textarea").fill("演示审核：其余五套工艺未接入，不可作为正式交班");
  await page.getByRole("button",{name:"确认演示审核归档"}).click();
  await expect(page.locator(".handover-reviewed")).toContainText("其余五套工艺未接入");
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-handover-reports-v1")??"[]"));
  expect(saved[0].status).toBe("reviewed");
  expect(saved[0].reviewedBy).toBe("manager");
  await page.reload();
  await expect(page.locator(".handover-reviewed")).toBeVisible();
});

test("H4 运维角色允许只读预览，但不能代替值班员执行巡查或保存报告",async({page})=>{
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","engineer"));
  await page.reload();
  await askHandover(page);
  await expect(page.locator(".handover-ai-result")).toContainText("未巡查");
  await expect(page.locator(".handover-steps")).toContainText("受阻");
  await expect(page.getByRole("button",{name:"确认保存交班报告草稿"})).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-handover-reports-v1"))).toBeNull();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-unattended-demo-v1")??"null"));
  expect(state?.records?.length??0).toBe(0);
});

test("H5 生成报告不自动建单、改设备或下发控制；取消后不可保存",async({page})=>{
  await askHandover(page);
  await expect(page.locator(".handover-ai-result")).toBeVisible();
  const before=await page.evaluate(()=>localStorage.getItem("tanggang-demo-state-v1"));
  await page.getByRole("button",{name:"取消任务"}).click();
  await expect(page.locator(".handover-ai-result")).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-handover-reports-v1"))).toBeNull();
  const after=await page.evaluate(()=>localStorage.getItem("tanggang-demo-state-v1"));
  // AI任务审计会更新；原有设备/工单数组不得改变。
  const beforeState=JSON.parse(before??"null");
  const afterState=JSON.parse(after??"null");
  expect(afterState.scenarios["SCN-NORMAL"].assets).toEqual(beforeState.scenarios["SCN-NORMAL"].assets);
  expect(afterState.scenarios["SCN-NORMAL"].workorders).toEqual(beforeState.scenarios["SCN-NORMAL"].workorders);
});

test("H6 旧报表功能保留、新报告可查看并导出",async({page})=>{
  await page.goto("/data/reports");
  await expect(page.getByRole("heading",{name:"交接班报告 · AI多步骤办事"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"六工艺运行摘要"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"告警工单统计"})).toBeVisible();
  await askHandover(page);
  await page.getByRole("button",{name:"确认保存交班报告草稿"}).click();
  await page.getByRole("button",{name:"在常用报表查看草稿"}).click();
  await expect(page.locator(".handover-detail")).toBeVisible();
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"导出 Markdown"}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^HND-.*交接班报告-MOCK\.md$/);
});
