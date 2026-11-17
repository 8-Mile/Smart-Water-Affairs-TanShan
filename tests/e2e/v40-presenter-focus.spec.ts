import {test,expect,type Page} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v40")){
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v40","1");
  }
 });
});

async function selectRoute(page:Page,label:string){
 await page.goto("/overview");
 await expect(page.locator(".panorama")).toBeVisible();
 await page.getByRole("button",{name:"演示路线",exact:true}).first().click();
 await page.locator(".tour-option").filter({hasText:label}).click();
 await expect(page.locator(".tour-dock")).toBeVisible();
}
async function expandDock(page:Page){
 if(await page.locator(".tour-dock.minimized").isVisible())
  await page.getByRole("button",{name:"展开演示导览"}).click();
}
async function setFault(page:Page){
 await page.goto("/overview");
 await expect(page.locator(".panorama")).toBeVisible();
 await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  s.setRole("admin");
  s.setScenario("SCN-PUMP-FAULT");
 });
 await expect(page.locator(".fault-focus")).toBeVisible();
}
test("V40-UI01 首页故障聚焦仅在指定模拟场景出现，且不覆盖六工艺任何热点",async({page})=>{
 await page.goto("/overview");
 await expect(page.locator(".panorama")).toBeVisible();
 await expect(page.locator(".fault-focus")).toHaveCount(0);
 await setFault(page);
 await expect(page.locator(".fault-focus")).toContainText("P-002");
 await expect(page.locator(".fault-focus")).toContainText("待人工确认");
 await expect(page.locator(".fault-focus")).toContainText("待验收");
 await expect(page.locator('[data-system="medium-pressure"].hotspot-risk')).toBeVisible();
 for(const [width,height] of [[1600,900],[1366,768],[390,844]]){
  await page.setViewportSize({width,height});
  const geometry=await page.evaluate(()=>{
   const box=document.querySelector(".fault-focus")!.getBoundingClientRect();
   const covered=[...document.querySelectorAll<HTMLElement>(".hotspot")]
    .map(el=>{
     const rect=el.getBoundingClientRect();
     const w=Math.max(0,Math.min(box.right,rect.right)-Math.max(box.left,rect.left));
     const h=Math.max(0,Math.min(box.bottom,rect.bottom)-Math.max(box.top,rect.top));
     return {id:el.dataset.system,overlap:w*h};
    }).filter(x=>x.overlap>1);
   return {covered,overflow:document.documentElement.scrollWidth-innerWidth};
  });
  expect(geometry.covered).toEqual([]);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
 }
 await page.locator(".fault-focus").getByRole("link",{name:"设备核查"}).click();
 await expect(page).toHaveURL(/asset-workspace\?assetId=asset-p002&tab=events/);
 await expect(page.locator(".asset-banner")).toContainText("P-002");
});

test("V40-UI02 工艺页面突出P-002模拟异常，并直达相同告警、工单",async({page})=>{
 await setFault(page);
 await page.locator(".fault-focus").getByRole("link",{name:"工艺",exact:true}).click();
 await expect(page).toHaveURL(/process\/medium-pressure/);
 await expect(page.locator(".pump-fault-spotlight")).toContainText("P-002");
 await expect(page.locator(".pump-fault-spotlight")).toContainText("待验收");
 await expect(page.locator(".pump-fault-spotlight")).toContainText("模拟");
 await expect(page.locator(".asset-status-item.fault-row")).toContainText("P-002");
 await page.locator(".pump-fault-spotlight").getByRole("link",{name:"查看原维修工单"}).click();
 await expect(page).toHaveURL(/workorders\?workOrderId=wo-2026-014/);
 await expect(page.locator(".n-drawer .drawer-body")).toBeVisible();
 await expect(page.locator(".n-drawer")).toContainText("WO-2026-014");
});

test("V40-UI03 三水源保存后导览条立即显示完成，并一键进入同编号成本核算",async({page})=>{
 await selectRoute(page,"三水源与成本");
 await page.getByRole("button",{name:"进入本步页面"}).click();
 await expect(page).toHaveURL(/water\/multi-source/);
 await expect(page.locator(".demo-stage-ribbon")).toContainText("选择水源并保存方案");
 await expect(page.locator(".tour-mini-next")).toHaveCount(0);
 await page.getByRole("button",{name:"保存待审核的供水建议"}).click();
 await expect(page.locator(".tour-mini-detail small.done")).toContainText("业务结果已核验");
 await page.getByRole("button",{name:"当前步骤已完成，进入下一步"}).click();
 await expect(page).toHaveURL(/green-benefit\?supplyDraftId=WS-/);
 await expect(page.locator(".demo-stage-ribbon")).toContainText("按原草稿编号核算成本");
 const wsId=await page.locator(".tour-exact-id strong").count();
 expect(wsId).toBe(0); // Presenter remains collapsed, no accidental overlay.
 const sourceId=await page.evaluate(()=>new URLSearchParams(location.search).get("supplyDraftId"));
 await expect(page.locator(".incoming-draft")).toContainText(sourceId??"__missing__");
 await page.locator(".incoming-draft").getByRole("button",{name:"确认导入此编号并重新核算"}).click();
 await page.getByRole("button",{name:"保存本期条件净效益待复核草稿"}).click();
 await expect(page.locator(".tour-mini-detail small.done")).toContainText("业务结果已核验");
 const linked=await page.evaluate(async()=>{
  const {readGreenDrafts}=await import("/src/demo/greenBenefit.ts");
  return readGreenDrafts(localStorage)[0]?.result.sourceDraftId;
 });
 expect(linked).toBe(sourceId);
});

test("V40-UI04 暴雨分析保存后即时核验快照，不需要收起展开两次",async({page})=>{
 await selectRoute(page,"暴雨污染水");
 await page.getByRole("button",{name:"进入本步页面"}).click();
 await expect(page).toHaveURL(/port-chain\?scenario=storm/);
 await expandDock(page);
 await page.locator(".tour-dock").getByRole("button",{name:"下一步"}).click();
 await expect(page).toHaveURL(/engineering\/registry\?focus=basins/);
 await expandDock(page);
 await page.locator(".tour-dock").getByRole("button",{name:"下一步"}).click();
 await expect(page).toHaveURL(/port-chain\?scenario=storm/);
 await expect(page.locator(".demo-stage-ribbon")).toContainText("返回模型并留存结果");
 await expect(page.locator(".tour-mini-detail small.done")).toHaveCount(0);
 await page.getByRole("button",{name:"保存模拟分析快照"}).click();
 await expect(page.locator(".tour-mini-detail small.done")).toContainText("业务结果已核验");
 await expect(page.locator(".tour-mini-next")).toHaveCount(0);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-port-chain-demo-run-v3")??"null"));
 expect(saved?.status).toBe("MOCK");
 expect(saved?.conclusion).toContain("禁止实际泵阀");
});

test("V40-UI05 演示流程页面提示可展开，非演示状态不占用业务页空间",async({page})=>{
 await page.goto("/water/port-chain?scenario=storm");
 await expect(page.locator(".demo-stage-ribbon")).toHaveCount(0);
 await selectRoute(page,"暴雨污染水");
 await page.getByRole("button",{name:"进入本步页面"}).click();
 await expect(page.locator(".demo-stage-ribbon")).toContainText("暴雨污染水");
 await page.locator(".demo-stage-ribbon").getByRole("button",{name:"展开演示步骤"}).click();
 await expect(page.locator(".tour-dock")).not.toHaveClass(/minimized/);
 await page.getByRole("button",{name:"结束演示导览"}).click();
 await page.getByRole("button",{name:"结束导览",exact:true}).click();
 await expect(page.locator(".demo-stage-ribbon")).toHaveCount(0);
});
