import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v39")){
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v39","1");
  }
 });
});
async function start(page:import("@playwright/test").Page,title:string){
 await page.goto("/overview",{waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"演示路线",exact:true}).first().click();
 await expect(page.locator(".tour-option")).toHaveCount(3);
 await page.locator(".tour-option").filter({hasText:title}).click();
 await expect(page.locator(".tour-dock")).toBeVisible();
}
async function showDock(page:import("@playwright/test").Page){
 if(await page.locator(".tour-dock").evaluate(el=>el.classList.contains("minimized")))
  await page.getByRole("button",{name:"展开演示导览"}).click();
}
test("V39-UI01 从原驾驶舱一键选择三条路线，关闭导览不修改业务场景",async({page})=>{
 await page.goto("/overview");
 const prev=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();return {scene:s.scenarioId,role:s.role,orders:s.workorders.length};
 });
 await page.getByRole("button",{name:"演示路线",exact:true}).first().click();
 await expect(page.locator(".tour-option")).toHaveCount(3);
 await expect(page.locator(".tour-picker")).toContainText("暴雨污染水");
 await expect(page.locator(".tour-picker")).toContainText("供水泵组异常");
 await expect(page.locator(".tour-picker")).toContainText("三水源与成本");
 await page.locator(".tour-option").filter({hasText:"暴雨污染水"}).click();
 await expect(page.locator(".tour-dock")).toContainText("暴雨情景测算");
 const after=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();return {scene:s.scenarioId,role:s.role,orders:s.workorders.length};
 });
 expect(after).toEqual(prev);
 await page.getByRole("button",{name:"结束演示导览"}).click();
 await page.getByRole("button",{name:"结束导览",exact:true}).click();
 await expect(page.locator(".tour-dock")).toHaveCount(0);
});
test("V39-UI02 暴雨情景逐池核查和模型快照，导览跨页保留且只认本轮新保存的记录",async({page})=>{
 await start(page,"暴雨污染水");
 await page.locator(".tour-dock").getByRole("button",{name:"进入本步页面"}).click();
 await expect(page).toHaveURL(/water\/port-chain\?scenario=storm/);
 await showDock(page);
 await expect(page.locator(".tour-current")).toContainText("暴雨情景测算");
 await page.locator(".tour-dock").getByRole("button",{name:"下一步"}).click();
 await expect(page).toHaveURL(/engineering\/registry\?focus=basins/);
 await showDock(page);
 await expect(page.locator(".tour-proof")).toContainText("现场核实尚未完成");
 await page.reload();
 await expect(page.locator(".tour-current")).toContainText("追查逐池工程依据");
 await page.locator(".tour-dock").getByRole("button",{name:"下一步"}).click();
 await expect(page).toHaveURL(/water\/port-chain\?scenario=storm/);
 await showDock(page);
 await expect(page.locator(".tour-proof")).toContainText("尚未保存");
 await page.getByRole("button",{name:"保存模拟分析快照"}).click();
 await page.getByRole("button",{name:"收起演示导览"}).click();
 await showDock(page);
 await expect(page.locator(".tour-proof.complete")).toContainText("本轮已保存模拟分析快照");
 const snapshot=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-port-chain-demo-run-v3")??"null"));
 expect(snapshot?.scenario).toBe("storm");
 expect(snapshot?.conclusion).toContain("禁止实际泵阀");
});
test("V39-UI03 泵组异常准备场景必须明确确认，下一步岗位切换也不会自动办理工单",async({page})=>{
 await page.addInitScript(()=>localStorage.setItem("tanggang-demo-role","manager"));
 await start(page,"供水泵组异常");
 await expect(page.locator(".tour-proof")).toContainText("尚未启用泵组故障情景");
 await page.getByRole("button",{name:"下一步"}).click();
 await expect(page.locator(".tour-current")).toContainText("准备故障演示场景");
 await page.getByRole("button",{name:"确认准备泵组故障场景"}).click();
 await expect(page.locator(".n-dialog")).toContainText("不重置或清理");
 await page.getByRole("button",{name:"确认准备",exact:true}).click();
 await expect(page.locator(".tour-proof.complete")).toContainText("已启用");
 await page.getByRole("button",{name:"下一步"}).click();
 await expect(page).toHaveURL(/operations\/events\?focus=tasks/);
 await showDock(page);
 await expect(page.locator(".tour-current")).toContainText("值班员查看待办");
 await page.getByRole("button",{name:"手动切换演示岗位"}).click();
 await page.getByRole("button",{name:"切换到 值班运行员"}).click();
 const state=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();return {
   role:s.role,scenario:s.scenarioId,order:s.workorders.find(o=>o.id==="wo-2026-014")?.status,
   alarm:s.alarms.find(a=>a.id==="ALM-P002-01")?.status,
  };
 });
 expect(state.role).toBe("duty");
 expect(state.scenario).toBe("SCN-PUMP-FAULT");
 expect(state.order).toBe("pending_acceptance");
 expect(state.alarm).toBe("active");
 await page.getByRole("button",{name:"下一步"}).click();
 await expect(page).toHaveURL(/asset-workspace\?assetId=asset-p002&tab=events/);
 await showDock(page);
 await expect(page.locator(".tour-proof")).toContainText("尚未记录值班确认");
 await page.locator(".workspace-panels .record").filter({hasText:"ALM-P002-01"})
  .getByRole("button",{name:"确认告警"}).click();
 await page.getByRole("button",{name:"收起演示导览"}).click();
 await showDock(page);
 await expect(page.locator(".tour-proof.complete")).toContainText("值班确认已记录");
});
test("V39-UI04 水源演示必须生成本轮WS草稿才可进入精确编号核算，保存GNB后导览才判定完成",async({page})=>{
 await start(page,"三水源与成本");
 await page.getByRole("button",{name:"进入本步页面"}).click();
 await expect(page).toHaveURL(/\/water\/multi-source/);
 await showDock(page);
 await page.locator(".tour-dock").getByRole("button",{name:"下一步"}).click();
 await expect(page.locator(".tour-current")).toContainText("选择水源并保存方案");
 await page.getByRole("button",{name:"保存待审核的供水建议"}).click();
 await page.getByRole("button",{name:"收起演示导览"}).click();
 await showDock(page);
 await expect(page.locator(".tour-proof.complete")).toContainText("WS-");
 await page.locator(".tour-dock").getByRole("button",{name:"下一步"}).click();
 await expect(page).toHaveURL(/green-benefit\?supplyDraftId=WS-/);
 await showDock(page);
 const current=await page.locator(".tour-exact-id strong").innerText();
 await expect(page.locator(".incoming-draft")).toContainText(current);
 await expect(page.locator(".tour-proof")).toContainText("尚未保存");
 await page.locator(".incoming-draft").getByRole("button",{name:"确认导入此编号并重新核算"}).click();
 await page.getByRole("button",{name:"保存本期条件净效益待复核草稿"}).click();
 await page.getByRole("button",{name:"收起演示导览"}).click();
 await showDock(page);
 await expect(page.locator(".tour-proof.complete")).toContainText("GNB-");
 const results=await page.evaluate(async()=>{
  const {readGreenDrafts}=await import("/src/demo/greenBenefit.ts");
  const {readDrafts,MULTI_SOURCE_DRAFT_KEY}=await import("/src/demo/proposalDrafts.ts");
  const source=readDrafts(MULTI_SOURCE_DRAFT_KEY,localStorage)[0];
  const benefit=readGreenDrafts(localStorage)[0];
  return {sourceId:source.id,linked:benefit.result.sourceDraftId};
 });
 expect(results.linked).toBe(results.sourceId);
});
test("V39-UI05 导览在小屏可开启和收起，业务页仍可操作，整页无横向溢出",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await start(page,"供水泵组异常");
 await expect(page.locator(".tour-dock")).toBeVisible();
 await page.getByRole("button",{name:"收起演示导览"}).click();
 await expect(page.locator(".tour-dock.minimized")).toBeVisible();
 await page.getByRole("button",{name:"展开演示导览"}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 const errors:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.getByRole("button",{name:"仍在本步页面"}).click();
 expect(errors).toEqual([]);
});
