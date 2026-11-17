import {test,expect,type Page} from "@playwright/test";

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__correlation_test")){
      localStorage.setItem("tanggang-demo-role","duty");
      localStorage.removeItem("tanggang-correlation-v1");
      sessionStorage.setItem("__correlation_test","1");
    }
  });
  await page.goto("/intelligent/correlation");
});
const preview=async(page:Page)=>page.getByRole("button",{name:"预览P-002与射雾器异常（MOCK）"}).click();
const fillNote=async(page:Page,phrase:string)=>page.locator(".co-workflow textarea").fill(phrase);
async function submitLink(page:Page){
  await preview(page);
  await page.getByPlaceholder("例如：PIPING-DEMO-01（非真实图号）").fill("DRAWING-DEMO-TEST-01");
  await page.getByPlaceholder("只记录拟核查的连接假设，不能直接断定上游影响下游").fill("仅为演示假设，尚未核实两工艺的供水管线连接关系");
  await page.getByRole("button",{name:"提交关系待审核"}).click();
}
test("C1 当前平台正常场景只归集同设备告警，不凭空产生跨工艺异常",async({page})=>{
  await expect(page.getByRole("heading",{name:/跨系统异常关联诊断/})).toBeVisible();
  await expect(page.locator(".corr-item")).toHaveCount(1);
  await expect(page.locator(".corr-metrics")).toContainText("活动关联组");
  await expect(page.locator(".candidates")).toContainText("当前场景没有满足24小时线索窗口");
  await expect(page.locator(".corr-detail")).toContainText("ALM-P002-01");
  await expect(page.locator(".corr-detail")).toContainText("WO-2026-014");
  await expect(page.locator(".limits")).toContainText("不能");
});
test("C2 独立故障预览引用已有种子：P002与SP004是两个组，只给未证实线索",async({page})=>{
  const before=await page.evaluate(()=>localStorage.getItem("tanggang-demo-state-v1"));
  await preview(page);
  await expect(page.locator(".corr-item")).toHaveCount(2);
  await expect(page.locator(".candidates .candidate-row")).toHaveCount(1);
  await expect(page.locator(".candidate-row")).toContainText("ALM-P002-02");
  await expect(page.locator(".candidate-row")).toContainText("ALM-SP004-01");
  await expect(page.locator(".candidate-row")).toContainText("仅时间线索");
  await expect(page.locator(".candidate-row")).toContainText("禁止自动认定共因");
  await expect(page.locator(".corr-metrics")).toContainText("跨工艺待证实线索");
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-demo-state-v1"))).toBe(before);
});
test("C3 人工登记关系证据不等于确认，管理者演示审核后才标识相关联",async({page})=>{
  await submitLink(page);
  await expect(page.locator(".relation-record")).toContainText("DRAWING-DEMO-TEST-01");
  await expect(page.locator(".candidate-row")).toContainText("等待演示审核");
  await expect(page.locator(".candidate-row")).not.toContainText("DEMO人工关联已复核");
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","manager"));
  await page.reload();
  await preview(page);
  await page.getByRole("button",{name:"填写DEMO关系复核意见"}).click();
  await page.getByPlaceholder("至少8字，说明复核内容与现场未确认的限制").fill("经本次模拟复核，仍缺少现场管网图和实际工艺关系");
  await page.getByRole("button",{name:"确认DEMO关联复核"}).click();
  await expect(page.locator(".candidate-row")).toContainText("DEMO人工关联已复核");
  await expect(page.locator(".associated")).toContainText("DRAWING-DEMO-TEST-01");
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-correlation-v1")??"null"));
  expect(data.links[0].status).toBe("reviewed_demo");
  expect(data.links[0].source).toBe("USER_ENTRY");
});
test("C4 有关系依据时受理跨工艺协同事件，另一端不能重复受理、不能二次派工",async({page})=>{
  await submitLink(page);
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","manager"));
  await page.reload();await preview(page);
  await page.getByRole("button",{name:"填写DEMO关系复核意见"}).click();
  await page.getByPlaceholder("至少8字，说明复核内容与现场未确认的限制").fill("本次只同意记录演示关系，现场连接仍不确定");
  await page.getByRole("button",{name:"确认DEMO关联复核"}).click();
  await fillNote(page,"人工受理已有报警和待核实供水关系，优先查验现场管段");
  await page.getByRole("button",{name:"人工受理关联事件"}).click();
  await expect(page.locator(".co-workflow")).toContainText("开始协同处理");
  const records=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-correlation-v1")??"null"));
  expect(records.cases).toHaveLength(1);
  expect(records.cases[0].linkedPairIds).toHaveLength(1);
  expect(records.cases[0].signalRefs).toHaveLength(3);
  expect(records.cases[0].workOrderId).toBe("wo-2026-014");
  await page.locator(".corr-item").filter({hasText:"SP-004"}).click();
  await expect(page.locator(".corr-detail")).toContainText("已人工受理");
  await expect(page.locator(".corr-detail")).toContainText("主案沿用");
  await expect(page.getByRole("button",{name:"人工受理关联事件"})).toHaveCount(0);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-correlation-v1")??"null"));
  expect(after.cases).toHaveLength(1);
});
test("C5 源告警仍活动时禁止强行关闭；步骤会保留审计与原始证据",async({page})=>{
  await preview(page);
  await fillNote(page,"值班员需核查2号泵原有报警及在办工单状态");
  await page.getByRole("button",{name:"人工受理关联事件"}).click();
  await fillNote(page,"已安排现场相关人员联合核查运行参数");
  await page.getByRole("button",{name:"开始协同处理"}).click();
  await fillNote(page,"准备逐项检查压力和电流异常是否恢复");
  await page.getByRole("button",{name:"申请恢复核验"}).click();
  await fillNote(page,"原异常仍存在，因此不应由页面直接强制关闭");
  await page.getByRole("button",{name:"核验并人工关闭"}).click();
  await expect(page.locator(".n-message--error-type")).toContainText("仍有源告警");
  await expect(page.locator(".co-workflow")).toContainText("核验并人工关闭");
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-correlation-v1")??"null").cases[0]);
  expect(record.status).toBe("pending_recovery");
  expect(record.audit).toHaveLength(3);
  await page.locator(".audit summary").click();
  await expect(page.locator(".audit")).toContainText("人工受理");
  await expect(page.locator(".audit")).toContainText("申请恢复核验");
});
test("C6 当前工况受理时优先引用已有工单，跨模块打开后不重复创建",async({page})=>{
  await fillNote(page,"针对目前2号泵的生产告警继续引用既有工单核验");
  await page.getByRole("button",{name:"人工受理关联事件"}).click();
  await expect(page.getByRole("button",{name:"打开已有检查工单"})).toBeVisible();
  const before=await page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem("tanggang-demo-state-v1")??"{}");
    return JSON.stringify(state.scenarios?.["SCN-NORMAL"]?.workorders??[]);
  });
  await page.getByRole("button",{name:"打开已有检查工单"}).click();
  await expect(page).toHaveURL(/\/operations\/workorders\?workOrderId=wo-2026-014/);
  const after=await page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem("tanggang-demo-state-v1")??"{}");
    return JSON.stringify(state.scenarios?.["SCN-NORMAL"]?.workorders??[]);
  });
  expect(after).toEqual(before);
});
test("C7 只读访客不能创建关系或受理事件，但可以审阅原始证据",async({page})=>{
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","viewer"));
  await page.reload();await preview(page);
  await expect(page.getByRole("button",{name:"提交关系待审核"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"人工受理关联事件"})).toBeDisabled();
  await expect(page.locator(".candidate-row")).toContainText("仅时间线索");
  await expect(page.locator(".corr-detail")).toContainText("ALM-P002-02");
});
test("C8 已复核的DEMO关系与处置记录可刷新恢复，切回平台场景时相互隔离",async({page})=>{
  await submitLink(page);
  await fillNote(page,"演示受理2号泵原始告警，暂不认可跨系统根因");
  await page.getByRole("button",{name:"人工受理关联事件"}).click();
  await page.reload();await preview(page);
  await expect(page.locator(".relation-record")).toContainText("DRAWING-DEMO-TEST-01");
  await expect(page.locator(".co-workflow")).toContainText("开始协同处理");
  await page.getByRole("button",{name:"使用当前场景"}).click();
  await expect(page.locator(".corr-item")).toHaveCount(1);
  await expect(page.locator(".co-workflow")).toContainText("人工受理关联事件");
});

test("C9 源事件解除后处置记录不消失：仅MOCK回放核验后允许人工关闭且保留审计",async({page})=>{
  await preview(page);
  const before=await page.evaluate(()=>localStorage.getItem("tanggang-demo-state-v1"));
  await fillNote(page,"先根据既有事件建立一份待核查协同记录");
  await page.getByRole("button",{name:"人工受理关联事件"}).click();
  await fillNote(page,"本轮模拟已核查原始告警以及已有工单归属");
  await page.getByRole("button",{name:"开始协同处理"}).click();
  await fillNote(page,"等待模拟告警解除并完成工单验收以验证闭环门槛");
  await page.getByRole("button",{name:"申请恢复核验"}).click();
  await page.getByRole("button",{name:"模拟告警解除与工单验收（仅DEMO）"}).click();
  await expect(page.locator(".source-switch")).toContainText("模拟恢复回放");
  await expect(page.locator(".corr-item")).toHaveCount(1);
  await expect(page.locator(".corr-detail")).toContainText("ALM-P002-01");
  await expect(page.locator(".corr-detail")).toContainText("closed");
  await fillNote(page,"已在纯MOCK回放中完成源告警解除和工单验收校核");
  await page.getByRole("button",{name:"核验并人工关闭"}).click();
  await expect(page.locator(".corr-detail")).toContainText("已闭环");
  await expect(page.locator(".co-workflow")).toContainText("已闭环 · 保留处置审计");
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-correlation-v1")??"null").cases[0]);
  expect(saved.status).toBe("closed");
  expect(saved.audit).toHaveLength(4);
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-demo-state-v1"))).toEqual(before);
});
