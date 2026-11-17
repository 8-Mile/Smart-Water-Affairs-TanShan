import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__multi_water_test")){
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role","manager");
      sessionStorage.setItem("__multi_water_test","1");
    }
  });
  await page.goto("/water/multi-source");
});
test("M1 正常场景：三水源配给、关键保障与费用比选清晰",async({page})=>{
  await expect(page.getByRole("heading",{name:/多水源供需与经济优化/})).toBeVisible();
  await expect(page.locator(".allotment")).toHaveCount(3);
  await expect(page.locator(".source-card")).toHaveCount(3);
  await expect(page.locator(".metrics")).toContainText("1,700");
  await expect(page.locator(".metrics")).toContainText("¥3,640");
  await expect(page.locator(".advice-status")).toContainText("可满足当前用水");
  await page.getByRole("button",{name:"查看用水明细"}).click();
  await expect(page.locator(".table-wrap tbody tr")).toHaveCount(3);
  const first=page.locator(".table-wrap tbody tr").first();
  await expect(first).toContainText("关键生产补水");
  await expect(first).toContainText("450");
  await expect(first).toContainText("0");
});
test("M2 限制中水水质：不走不合格路径、仍满足供应但节约减少",async({page})=>{
  await page.getByRole("button",{name:"模拟中水水质不达标"}).click();
  await expect(page.locator(".advice-status")).toContainText("可满足当前用水");
  await page.getByRole("button",{name:"查看用水明细"}).click();
  await expect(page.locator(".table-wrap tbody tr").nth(1)).toContainText("射雾除尘");
  const cells=page.locator(".table-wrap tbody tr").nth(1).locator("td");
  await expect(cells.nth(3)).toHaveText("0");
  await expect(page.locator(".source-card").nth(1)).toContainText("0 m³ 已使用");
});
test("M3 供水严重不足：关键用水优先，自动禁用经济节约声明与保存",async({page})=>{
  await page.getByRole("button",{name:"模拟供水能力不足"}).click();
  await expect(page.locator(".advice-status")).toContainText("存在缺口");
  await expect(page.locator(".metrics")).toContainText("暂不可比");
  await expect(page.getByRole("button",{name:"保存待审核的供水建议"})).toBeDisabled();
  await page.getByRole("button",{name:"查看用水明细"}).click();
  await expect(page.locator(".table-wrap tbody tr").first()).toContainText("450");
  await expect(page.locator(".boundary")).toContainText("未满足供水需求");
});
test("M4 关掉独立库存核实：雨水与中水均停用，不再凭账本做双重供给",async({page})=>{
  await page.getByRole("button",{name:"调整供水条件"}).click();
  await page.getByRole("checkbox",{name:/演示假设：雨水与中水为独立/}).uncheck();
  await page.getByRole("button",{name:"重新计算"}).click();
  await expect(page.locator(".source-card").nth(0)).toContainText("0 m³ 已使用");
  await expect(page.locator(".source-card").nth(1)).toContainText("0 m³ 已使用");
  await expect(page.locator(".boundary")).toContainText("独立库存未核实");
});
test("M5 关闭实际路径或质量适用：必须重新计算才生效",async({page})=>{
  await page.getByRole("button",{name:"调整供水条件"}).click();
  await page.getByRole("button",{name:/查看\/编辑9条供水路径/}).click();
  const route=page.locator(".route-item").filter({hasText:"雨水 → 射雾除尘"});
  await route.getByRole("checkbox",{name:/管网连通/}).uncheck();
  await expect(page.locator(".config-actions")).toContainText("参数有修改");
  await page.getByRole("button",{name:"重新计算"}).click();
  await page.getByRole("button",{name:"查看用水明细"}).click();
  const cells=page.locator(".table-wrap tbody tr").nth(1).locator("td");
  await expect(cells.nth(2)).toHaveText("0");
});
test("M6 草稿持久化、只读角色不得保存、综合水资源总览可进入",async({page})=>{
  await page.getByRole("button",{name:"保存待审核的供水建议"}).click();
  await expect(page.locator(".draft")).toHaveCount(1);
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-multisource-drafts-v1")??"[]"));
  expect(state).toHaveLength(1);
  expect(state[0].state).toBe("draft");
  expect(state[0].source).toBe("MOCK");
  await page.reload();
  await page.getByRole("button",{name:/查看草稿/}).click();
  await expect(page.locator(".draft")).toHaveCount(1);
  await page.evaluate(()=>localStorage.setItem("tanggang-demo-role","viewer"));
  await page.reload();
  await expect(page.getByRole("button",{name:"保存待审核的供水建议"})).toBeDisabled();
  await page.goto("/water/overview");
  await expect(page.locator(".quick-link[href=\"/water/multi-source\"]")).toBeVisible();
});
