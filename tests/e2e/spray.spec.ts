import { test, expect, type Page } from "@playwright/test";

async function prepare(page: Page, role: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((initialRole) => {
    if (!sessionStorage.getItem("__spray_test_started")) {
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role", initialRole);
      sessionStorage.setItem("__spray_test_started", "1");
    }
  }, role);
  return errors;
}

async function expectNoOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
}

async function openScenario(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: /^场景回放/ }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function openTab(page: Page, label: string): Promise<void> {
  await page.locator(".tab-pill").filter({ hasText: label }).first().click();
}

test("S1 常态无异常，作业结束场景触发建议并可生成待确认任务", async ({ page }) => {
  const errors = await prepare(page, "admin");
  await page.goto("/process/spray");

  await expect(
    page.getByRole("heading", { name: "射雾器除尘", exact: true }).first(),
  ).toBeVisible();
  for (const label of ["运行射雾器", "末端压力均值", "瞬时喷射流量", "待关注事件"]) {
    await expect(page.locator(".kpi-card").getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator("svg[aria-label='射雾器除尘工艺示意图']")).toBeVisible();
  await expect(page.getByText("工艺示意图，非真实管线拓扑", { exact: true })).toBeVisible();
  await expect(page.getByText(/当前未触发运行优化建议/)).toBeVisible();

  await page.locator(".unit").first().click();
  await expect(page.getByText("1号射雾器 · SP-001")).toBeVisible();
  await page.keyboard.press("Escape");

  await openScenario(page, "B 区域作业结束");
  await expect(page.getByText("已切换到「堆场作业结束」")).toBeVisible();
  await expect(page.locator("#spray-suggest-idle-spray-A")).toBeVisible();
  await expect(page.getByText("作业中", { exact: true }).first()).toBeVisible();

  const suggestion = page
    .locator(".suggestion")
    .filter({ hasText: "堆场 A 区作业结束后仍保留喷雾" });
  await suggestion.getByRole("button", { name: "查看依据", exact: true }).click();
  await expect(suggestion).toContainText("停止作业不等于必须关闭射雾器");
  await suggestion
    .getByRole("button", { name: "创建检查任务", exact: true })
    .click();
  await expect(page.getByText(/已生成待确认任务草稿 WO-2026-/)).toBeVisible();

  await openTab(page, "告警与工单");
  await expect(
    page.getByText("堆场 A 区作业结束后仍保留喷雾 · 运行计划核查（待确认）").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: /^场景回放/ }).click();
  await page.getByRole("button", { name: "恢复初始场景", exact: true }).click();
  await expect(page.getByText("当前场景已恢复初始状态")).toBeVisible();
  await expect(
    page.getByText("堆场 A 区作业结束后仍保留喷雾 · 运行计划核查（待确认）"),
  ).toHaveCount(0);

  await openScenario(page, "A 正常生产运行");
  await expect(page.getByText("已切换到「常态运行」")).toBeVisible();
  await expect(page.getByText(/当前未触发运行优化建议/)).toBeVisible();

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("S2 供水压力异常关联设备、告警与工单草稿，模拟数据不伪造", async ({ page }) => {
  const errors = await prepare(page, "admin");
  await page.goto("/process/spray");
  await openScenario(page, "C 供水压力异常");

  await expect(page.getByText("已切换到「泵组故障」")).toBeVisible();
  const pressureCard = page.locator(".kpi-card").filter({ hasText: "末端压力均值" });
  await expect(pressureCard).not.toContainText("缺数");
  await expect(
    page.getByText("4号射雾器末端压力偏低", { exact: true }).first(),
  ).toBeVisible();

  const suggestion = page
    .locator(".suggestion")
    .filter({ hasText: "末端压力低于演示关注阈值" });
  await suggestion.getByRole("button", { name: "查看依据", exact: true }).click();
  await expect(suggestion).toContainText("阈值是演示参数");
  await suggestion
    .getByRole("button", { name: "创建检查任务", exact: true })
    .click();
  await expect(page.getByText(/已生成检查工单草稿 WO-2026-/)).toBeVisible();

  await openTab(page, "告警与工单");
  await expect(
    page.getByText("射雾器末端压力异常检查（待确认）").first(),
  ).toBeVisible();
  await expect(page.getByText(/ALM-SP004-01/).first()).toBeVisible();

  await openTab(page, "设备监测");
  await page
    .locator("tbody tr")
    .filter({ hasText: "SP-004" })
    .first()
    .click();
  await expect(page.getByText("4号射雾器 · SP-004")).toBeVisible();
  await page.locator(".n-drawer .n-tabs-tab").filter({ hasText: "监测" }).first().click();
  await expect(page.locator(".drawer-body")).toContainText("末端压力");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^场景回放/ }).click();
  await page.getByRole("button", { name: "恢复初始场景", exact: true }).click();
  await openTab(page, "告警与工单");
  await expect(
    page.getByText("射雾器末端压力异常检查（待确认）"),
  ).toHaveCount(0);

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("S3 只读访客看到建议但无法切换场景或写入任务", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("tanggang-demo-role", "viewer");
    localStorage.setItem(
      "tanggang-demo-state-v1",
      JSON.stringify({
        version: 1,
        scenarioId: "SCN-YARD-STOP",
        globalDashboards: [],
        scenarios: {},
      }),
    );
  });
  await page.goto("/process/spray");

  await expect(page.locator("#spray-suggest-idle-spray-A")).toBeVisible();
  await page.getByRole("button", { name: /^场景回放/ }).click();
  await expect(
    page.getByRole("button", { name: "A 正常生产运行", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "恢复初始场景", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "AI 助手", exact: true }),
  ).toBeDisabled();

  const suggestion = page
    .locator(".suggestion")
    .filter({ hasText: "堆场 A 区作业结束后仍保留喷雾" });
  await suggestion.getByRole("button", { name: "查看依据", exact: true }).click();
  await expect(
    suggestion.getByRole("button", { name: "创建检查任务", exact: true }),
  ).toBeDisabled();

  await openTab(page, "告警与工单");
  await expect(
    page.getByText("堆场 A 区作业结束后仍保留喷雾 · 运行计划核查（待确认）"),
  ).toHaveCount(0);

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("S4 AI 抽屉回答射雾器本地问题并生成检查草稿与趋势图", async ({ page }) => {
  const errors = await prepare(page, "admin");
  await page.goto("/process/spray");
  await openScenario(page, "C 供水压力异常");

  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  const drawer = page.locator(".n-drawer");
  const input = drawer.locator("textarea").first();

  await input.fill("查询射雾器运行设备与异常");
  await page.getByRole("button", { name: "解析指令", exact: true }).click();
  await expect(page.getByText("射雾器运行设备与异常（本地规则）")).toBeVisible();

  await input.fill("分析最近24小时压力趋势");
  await page.getByRole("button", { name: "解析指令", exact: true }).click();
  await expect(page.getByText("最近 24 小时末端压力趋势", { exact: true })).toBeVisible();

  await input.fill("计算不同运行方案的理论用水量");
  await page.getByRole("button", { name: "解析指令", exact: true }).click();
  await expect(page.getByText("运行方案理论用水对比", { exact: true })).toBeVisible();
  await expect(page.getByText(/理论估算，仅用于运行计划对比/)).toBeVisible();

  await input.fill("根据异常生成检查任务草稿");
  await page.getByRole("button", { name: "解析指令", exact: true }).click();
  await drawer
    .getByRole("button", { name: "生成检查工单草稿", exact: true })
    .click();
  await expect(drawer.getByText(/已生成工单草稿 WO-2026-/)).toBeVisible();

  await input.fill("预测下周射雾器最佳运行策略");
  await page.getByRole("button", { name: "解析指令", exact: true }).click();
  await expect(page.getByText(/未匹配到可执行指令/).first()).toBeVisible();

  await input.fill("生成射雾器末端压力近24小时趋势图");
  await page.getByRole("button", { name: "解析指令", exact: true }).click();
  await expect(page).toHaveURL(/\/data\/ai-workspace/);
  await expect(
    page.getByRole("heading", { name: "射雾器末端压力近 24 小时 · MOCK 模拟数据" }),
  ).toBeVisible();

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});
