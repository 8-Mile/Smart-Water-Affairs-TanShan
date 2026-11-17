import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__dispatch_test_started")) {
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role", "manager");
      sessionStorage.setItem("__dispatch_test_started", "1");
    }
  });
  await page.goto("/water/dispatch");
});

test("R1 三方案可视化、风险解释与降雨预设联动", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "雨前智能调蓄" })).toBeVisible();
  await expect(page.locator(".plan-table tbody tr")).toHaveCount(3);
  await expect(page.locator(".recommended h2")).toHaveText("方案C · 优先处理回用");
  await expect(page.locator("svg[aria-label='不同方案的储量预测变化曲线']")).toBeVisible();
  await page.getByRole("button", { name: "小雨情景 · 30mm" }).click();
  await expect(page.locator(".metrics")).toContainText("3,510");
  await page.getByRole("button", { name: "强降雨 · 80mm" }).click();
  await expect(page.locator(".metrics")).toContainText("9,360");
  await page.getByRole("button", { name: "极端演示 · 120mm" }).click();
  await expect(page.getByText("当前方案仍预测溢流", { exact: false })).toBeVisible();
});

test("R2 未确认排放和回用许可：两方案不可执行并禁止推荐", async ({ page }) => {
  await page.getByRole("button", { name: "修改计算条件" }).click();
  await page.getByRole("checkbox", { name: /演示假设：已确认合法排放去向/ }).uncheck();
  await page.getByRole("checkbox", { name: /演示假设：已确认水质、管网与回用用途/ }).uncheck();
  await page.getByRole("button", { name: "重新计算三方案" }).click();
  await expect(page.locator(".recommended h2")).toHaveText("方案A · 保持现状");
  await expect(page.locator(".plan-table tbody tr").nth(1)).toContainText("条件不足");
  await expect(page.locator(".plan-table tbody tr").nth(2)).toContainText("条件不足");
  await expect(page.locator(".chart-legend .unavailable")).toHaveCount(2);
  await page.getByRole("button", { name: "展开计算明细" }).click();
  await expect(page.locator(".details")).toContainText("阻断条件");
});

test("R3 回用需求为0则不推荐方案C", async ({ page }) => {
  await page.getByRole("button", { name: "修改计算条件" }).click();
  await page.locator(".field-grid label").filter({ hasText: "同期实际回用需求" }).locator("input").fill("0");
  await page.getByRole("button", { name: "重新计算三方案" }).click();
  await expect(page.locator(".recommended h2")).toHaveText("方案B · 雨前腾库");
  await expect(page.locator(".plan-table tbody tr").nth(2)).toContainText("条件不足");
});

test("R4 保存待复核草稿并刷新后保留，不产生设备控制动作", async ({ page }) => {
  await page.getByRole("button", { name: "保存待复核建议草稿" }).click();
  await expect(page.locator(".draft")).toHaveCount(1);
  await expect(page.locator(".draft")).toContainText(["方案C"]);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tanggang-water-dispatch-drafts-v1") ?? "[]"));
  expect(stored).toHaveLength(1);
  expect(stored[0].dataSource).toBe("MOCK");
  expect(stored[0].state).toBe("draft");
  await page.reload();
  await page.getByRole("button", { name: /查看草稿/ }).click();
  await expect(page.locator(".draft")).toHaveCount(1);
  await expect(page.locator(".draft")).toContainText(["待复核"]);
});

test("R5 参数非法时拒绝重新计算，并保留上一次有效结果", async ({ page }) => {
  await page.getByRole("button", { name: "修改计算条件" }).click();
  await page.locator(".field-grid label").filter({ hasText: "最低运行保底储量" }).locator("input").fill("7000");
  await page.getByRole("button", { name: "重新计算三方案" }).click();
  await expect(page.locator(".error-msg").first()).toContainText("最低运行储量不能超过有效库容");
  await expect(page.locator(".metrics")).toContainText("7,020");
  await expect(page.locator(".recommended h2")).toContainText("方案C");
});

test("R6 只读访客不能保存待复核建议", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("tanggang-demo-role", "viewer"));
  await page.reload();
  await expect(page.getByRole("button", { name: "保存待复核建议草稿" })).toBeDisabled();
  await expect(page.locator(".plan-table tbody tr")).toHaveCount(3);
});
