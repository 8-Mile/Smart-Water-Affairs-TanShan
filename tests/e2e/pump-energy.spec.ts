import { test, expect } from "@playwright/test";

test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__energy_test_started")){
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role","manager");
      sessionStorage.setItem("__energy_test_started","1");
    }
  });
  await page.goto("/decision/health?tab=energy");
});

test("E1 进入原健康与能效，比较3台中压泵7种组合，能耗金额来自实时计算的MOCK运行点",async({page})=>{
  await expect(page.getByRole("heading",{name:/泵组运行组合与能耗比选/})).toBeVisible();
  await expect(page.locator(".combo-row")).toHaveCount(7);
  await expect(page.locator(".point-card")).toHaveCount(3);
  await expect(page.locator(".metric-grid")).toContainText("5,500");
  await expect(page.locator(".metric-grid")).toContainText("1,269.23");
  await expect(page.locator(".metric-grid")).toContainText("0.2273");
  await expect(page.locator(".metric-grid")).toContainText("¥16.35");
  await expect(page.locator(".combo-row.highlight")).toContainText("P-002");
  await expect(page.locator(".energy-root")).toContainText("MOCK");
  await expect(page.locator(".bottom-note")).toContainText("厂家Q-H");
});

test("E2 日需水高峰：不满足峰值的单泵退出比选，双泵组合纳入",async({page})=>{
  await page.getByRole("button",{name:"高峰双泵需求"}).click();
  await expect(page.locator(".metric-grid")).toContainText("9,300");
  await expect(page.locator(".combo-row.highlight")).toContainText("P-001 + P-002");
  await expect(page.locator(".combo-row").filter({hasText:"P-002"}).first()).toContainText("模拟优选");
  const single=page.locator(".combo-row").filter({has:page.locator(".combo-name>strong:text-is('P-002')")});
  await expect(single).toContainText("条件不足");
  await single.click();
  await expect(page.locator(".blockers")).toContainText("峰时需求");
});

test("E3 模拟P002故障：不允许故障泵参与推荐，即使铭牌Q和H满足",async({page})=>{
  await page.getByRole("button",{name:"模拟P-002故障"}).click();
  await expect(page.locator(".combo-row.highlight")).toContainText("P-001");
  const bad=page.locator(".combo-row").filter({has:page.locator(".combo-name>strong:text-is('P-002')")});
  await expect(bad).toContainText("条件不足");
  await bad.click();
  await expect(page.locator(".blockers")).toContainText("当前故障");
});

test("E4 备用泵未核验不允许投运，点击已核验情景后才纳入优选",async({page})=>{
  const option=page.locator(".combo-row").filter({has:page.locator(".combo-name>strong:text-is('P-004')")});
  await expect(option).toContainText("条件不足");
  await option.click();
  await expect(page.locator(".blockers")).toContainText("未确认启泵条件");
  await page.getByRole("button",{name:"假设备用泵已核验"}).click();
  await expect(page.locator(".combo-row.highlight")).toContainText("P-004");
  await expect(page.locator(".option-detail")).toContainText("仅满足演示容量与时长约束");
});

test("E5 工程人员修改输入功率后会重新计算；非法物理输入拒绝，旧结论不被覆盖",async({page})=>{
  await page.getByRole("button",{name:"调整计算条件"}).click();
  await page.getByRole("button",{name:"修改单泵运行点及备用确认"}).click();
  const first=page.locator(".pump-input").first();
  await first.locator("label").filter({hasText:"假设输入有功功率"}).locator("input").fill("60");
  await expect(page.locator(".dirty-warning")).toBeVisible();
  await expect(page.getByRole("button",{name:"保存待工程复核建议草稿"})).toBeDisabled();
  await page.getByRole("button",{name:"重新计算所有机组组合"}).click();
  await expect(page.locator(".error")).toContainText("效率>100%");
  await expect(page.locator(".metric-grid")).toContainText("¥16.35");
  await first.locator("label").filter({hasText:"假设输入有功功率"}).locator("input").fill("72");
  await page.getByRole("button",{name:"重新计算所有机组组合"}).click();
  await expect(page.locator(".error")).toHaveCount(0);
  await expect(page.locator(".metric-grid")).not.toContainText("¥16.35");
  await expect(page.locator(".point-card").first()).toContainText("0.225");
});

test("E6 用户确认保存待工程复核草稿，刷新保留；只读角色无权写入",async({page})=>{
  await page.getByRole("button",{name:"保存待工程复核建议草稿"}).click();
  await expect(page.locator(".draft")).toHaveCount(1);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-pump-energy-drafts-v1")??"[]"));
  expect(saved).toHaveLength(1);
  expect(saved[0].source).toBe("MOCK");
  expect(saved[0].state).toBe("draft");
  expect(saved[0].scenarioId).toBe("SCN-NORMAL");
  expect(saved[0].recommendedKey).toBe("P-002");
  await page.reload();
  await page.getByRole("button",{name:/查看草稿/}).click();
  await expect(page.locator(".draft")).toHaveCount(1);
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","viewer"));
  await page.reload();
  await expect(page.getByRole("button",{name:"保存待工程复核建议草稿"})).toBeDisabled();
  await expect(page.locator(".combo-row")).toHaveCount(7);
});

test("E7 原健康诊断页面完整保留，页签切回后不丢失评分及趋势",async({page})=>{
  await page.getByRole("button",{name:"设备健康诊断"}).click();
  await expect(page.getByRole("heading",{name:"泵类设备"})).toBeVisible();
  await expect(page.locator(".score-card")).toBeVisible();
  await expect(page.getByRole("heading",{name:"因子明细"})).toBeVisible();
  await expect(page.locator(".chart-card")).toBeVisible();
  await page.getByRole("button",{name:"泵组能效匹配与运行优化"}).click();
  await expect(page.locator(".combo-row")).toHaveCount(7);
});

test("E8 无可行方案必须展示缺口，不虚构费用和节约；备用约束阻止不安全组合",async({page})=>{
  await page.getByRole("button",{name:"调整计算条件"}).click();
  await page.locator(".settings-grid label").filter({hasText:"峰时流量需求"}).first().locator("input").fill("800");
  await page.getByRole("button",{name:"重新计算所有机组组合"}).click();
  await expect(page.locator(".option-detail")).toContainText("不存在任何可供比较的组合");
  await expect(page.locator(".metric-grid")).toContainText("暂不可比");
  await expect(page.getByRole("button",{name:"保存待工程复核建议草稿"})).toBeDisabled();
  await page.getByRole("button",{name:"正常供水"}).click();
  // 场景重置不应自动关闭专业设置面板；此时设置仍展开。
  await page.getByRole("checkbox",{name:/任一运行方案必须保留至少1台/}).check();
  await page.getByRole("button",{name:"重新计算所有机组组合"}).click();
  await expect(page.locator(".metric-grid")).toContainText("暂不可比");
});
