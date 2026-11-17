import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem("__v36")){
   localStorage.clear();
   localStorage.setItem("tanggang-demo-role","admin");
   sessionStorage.setItem("__v36","1");
  }
 });
});
test("V36-UI01 从设备台账跨到巡检、工单、健康与档案，设备上下文不丢失",async({page})=>{
 await page.goto("/operations/assets?assetId=asset-p002");
 await expect(page.locator(".asset-journey")).toContainText("P-002");
 await page.locator(".asset-journey").getByRole("link",{name:"巡检"}).click();
 await expect(page).toHaveURL(/assetId=asset-p002/);
 await expect(page).toHaveURL(/tab=inspections/);
 await expect(page.locator(".asset-journey")).toContainText("P-002");
 await expect(page.getByRole("heading",{name:"巡检记录",exact:true})).toBeVisible();
 await expect(page.locator(".tab-head")).toContainText("当前仅展示");
 await page.getByRole("button",{name:"新增巡检记录"}).click();
 await expect(page.locator(".inspection-form")).toContainText("P-002");
 await page.locator(".asset-journey").getByRole("link",{name:"工单",exact:true}).click();
 await expect(page).toHaveURL(/assetId=asset-p002/);
 await expect(page.locator(".asset-journey")).toContainText("P-002");
 await page.locator(".asset-journey").getByRole("link",{name:"健康分析"}).click();
 await expect(page).toHaveURL(/decision\/health\?assetId=asset-p002/);
 await expect(page.locator(".asset-journey")).toContainText("P-002");
 await page.locator(".asset-journey").getByRole("link",{name:"设备档案"}).click();
 await expect(page).toHaveURL(/archives\?assetId=asset-p002/);
 await expect(page.locator(".asset-journey")).toContainText("P-002");
});
test("V36-UI02 事件中心按设备ID筛选，解除作用域不会写入原事件",async({page})=>{
 await page.goto("/operations/events?assetId=asset-p002");
 const scope=page.locator(".hub-scope");
 await expect(scope).toContainText("P-002");
 const count=await page.locator(".hub-event-row").count();
 const original=await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  const s=useDemoStore();
  return s.alarms.map(x=>({id:x.id,status:x.status}));
 });
 await expect(page.locator(".hub-event-row")).toHaveCount(count);
 await scope.getByRole("button",{name:"查看全部事件"}).click();
 await expect(page).not.toHaveURL(/assetId=/);
 await expect(page.locator(".hub-scope")).toHaveCount(0);
 expect(await page.evaluate(async()=>{
  const {useDemoStore}=await import("/src/demo/store.ts");
  return useDemoStore().alarms.map(x=>({id:x.id,status:x.status}));
 })).toEqual(original);
});
test("V36-UI03 从保存的供水方案编号进入成本核算，确认前不替换参数",async({page})=>{
 await page.goto("/water/multi-source");
 await page.getByRole("button",{name:"保存待审核的供水建议"}).click();
 const handoff=page.locator(".draft-handoff").first();
 await expect(handoff).toBeVisible();
 const href=await handoff.getAttribute("href");
 expect(href).toContain("supplyDraftId=WS-");
 await handoff.click();
 await expect(page).toHaveURL(/water\/green-benefit\?supplyDraftId=WS-/);
 const incoming=page.locator(".incoming-draft");
 await expect(incoming).toContainText("草稿已找到");
 await expect(page.locator(".draft-source")).toHaveCount(0);
 await incoming.getByRole("button",{name:"确认导入此编号并重新核算"}).click();
 await expect(page.locator(".draft-source")).toContainText("已载入多水源建议原始编号");
 await expect(page.locator(".draft-source")).toContainText("WS-");
});
test("V36-UI04 指定草稿丢失时禁止退回最新草稿",async({page})=>{
 await page.goto("/water/green-benefit?supplyDraftId=WS-FAKE");
 const incoming=page.locator(".incoming-draft");
 await expect(incoming).toContainText("不可用或已被清理");
 await expect(incoming.getByRole("button",{name:"确认导入此编号并重新核算"})).toBeDisabled();
 await expect(page.locator(".draft-source")).toHaveCount(0);
});
test("V36-UI05 调蓄到四预只传雨量，人工确认后重新计算",async({page})=>{
 await page.goto("/water/dispatch?rainMm=120");
 await page.getByRole("link",{name:"将降雨量带入四预预演"}).click();
 await expect(page).toHaveURL(/decision\/four-pre\?source=dispatch&rainMm=120/);
 const note=page.locator(".rain-handoff");
 await expect(note).toContainText("仅共享降雨输入");
 const rain=page.locator(".four-pre .field").filter({hasText:"降雨量（mm）"}).locator("input");
 await expect(rain).not.toHaveValue("120");
 await note.getByRole("button",{name:"确认采用此雨量并重算"}).click();
 await expect(rain).toHaveValue("120");
 await expect(page.locator(".four-pre")).toContainText("参数为演示假设");
});
test("V36-UI06 小屏设备目录不再把操作区挤出整屏，仍可内部滚动",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto("/operations/assets?assetId=asset-p002");
 const measures=await page.evaluate(()=>{
  const tree=document.querySelector(".assets-page .tree-panel")?.getBoundingClientRect();
  const main=document.querySelector(".assets-page .main-panel")?.getBoundingClientRect();
  return {treeHeight:tree?.height??9999,mainTop:main?.top??9999,
   overflow:document.documentElement.scrollWidth-innerWidth,
   treeScroll:document.querySelector(".assets-page .tree-panel")?.scrollHeight??0};
 });
 expect(measures.treeHeight).toBeLessThanOrEqual(271);
 expect(measures.mainTop).toBeLessThan(850);
 expect(measures.overflow).toBeLessThanOrEqual(1);
 expect(measures.treeScroll).toBeGreaterThan(measures.treeHeight);
});
