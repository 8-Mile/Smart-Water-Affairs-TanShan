import { test, expect, type Page } from "@playwright/test";

async function prepare(page: Page, role: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((initialRole) => {
    // 每个测试首次加载时清理本地状态并设置起始角色；同一测试内切换角色与 reload 均保留。
    if (!sessionStorage.getItem("__demo_test_started")) {
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role", initialRole);
      sessionStorage.setItem("__demo_test_started", "1");
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

async function setRole(page: Page, roleLabel: string): Promise<void> {
  await page.getByRole("button", { name: "切换演示角色" }).click();
  await page.locator(".n-dropdown-option").filter({ hasText: roleLabel }).click();
}

async function submitAiPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "问 AI", exact: true }).click();
  await page.locator(".n-drawer textarea").first().fill(prompt);
  await page.getByRole("button", { name: "解析指令", exact: true }).click();
}

test("D1 建档：五步向导创建 P-003、刷新保留、重复编号阻止、取消无残留", async ({
  page,
}) => {
  const errors = await prepare(page, "admin");
  await page.goto("/operations/assets");
  await expect(page.getByRole("heading", { name: "设备台账" })).toBeVisible();

  const prompt =
    "在射雾器除尘系统增加一台3号供水泵，编号P-003，功率45kW，流量120m³/h，扬程60m，增加压力、电流、流量三个监测点，并在工艺图上布置。";
  await submitAiPrompt(page, prompt);

  await expect(
    page.getByRole("heading", {
      name: "AI 新增设备 · 五步向导",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.locator(".canvas.interactive").click({ position: { x: 120, y: 80 } });
  await expect(page.getByText(/已选坐标/)).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "确认创建", exact: true }).click();

  await expect(page.getByRole("heading", { name: "创建成功" })).toBeVisible();
  await expect(
    page.locator(".success-panel").getByText(/assetId：asset-p003/),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看设备台账", exact: true }).click();
  await expect(page).toHaveURL(/\/operations\/assets/);

  await page.keyboard.press("Escape");
  await page
    .getByRole("main")
    .getByPlaceholder("搜索设备编号或名称")
    .fill("P-003");
  const createdRows = page
    .locator("tbody tr")
    .filter({ has: page.locator("td.mono", { hasText: /^P-003$/ }) });
  await expect(createdRows).toHaveCount(1);
  await expect(createdRows.first()).toContainText("3号供水泵");

  await page.reload();
  await page.getByRole("main").getByPlaceholder("搜索设备编号或名称").fill("P-003");
  await expect(
    page
      .locator("tbody tr")
      .filter({ has: page.locator("td.mono", { hasText: /^P-003$/ }) }),
  ).toHaveCount(1);

  await page.goto("/process/spray");
  await expect(page.getByRole("button", { name: "P-003 模拟", exact: true })).toBeVisible();
  await page.goto("/operations/assets");
  await submitAiPrompt(page, prompt);
  await expect(
    page.getByText(/编号 P-003 在「射雾器除尘」中已存在/).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("main").getByPlaceholder("搜索设备编号或名称").fill("P-003");
  await expect(
    page
      .locator("tbody tr")
      .filter({ has: page.locator("td.mono", { hasText: /^P-003$/ }) }),
  ).toHaveCount(1);

  await submitAiPrompt(
    page,
    "在射雾器除尘系统新增一台6号供水泵，编号P-906，额定功率30kW、流量80m³/h、扬程45m。增加出口压力测点。",
  );
  await expect(
    page.getByRole("heading", {
      name: "AI 新增设备 · 五步向导",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("main").getByPlaceholder("搜索设备编号或名称").fill("P-906");
  await expect(page.getByText("没有匹配的设备", { exact: false })).toBeVisible();

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("D2 档案诊断：健康分、趋势与证据区可见且点击证据有反馈", async ({
  page,
}) => {
  const errors = await prepare(page, "manager");
  await page.goto("/decision/health?assetId=asset-p002");

  await expect(
    page.getByRole("heading", { name: /中压供水2号泵/ }),
  ).toBeVisible();
  const score = page.locator(".score-number strong");
  await expect(score).toBeVisible();
  await expect(score).toHaveText(/^\d+(\.\d+)?$/);
  await expect(page.getByRole("heading", { name: "因子明细" })).toBeVisible();
  await expect(
    page.locator(".factor-table tbody tr"),
  ).toHaveCount(4);
  await expect(
    page.getByLabel(/观测与外推趋势图/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /证据库/ })).toBeVisible();

  const openEvidence = page.getByRole("button", { name: "查看证据与建议" });
  if (await openEvidence.isVisible()) {
    await openEvidence.click();
  }
  const firstEvidence = page.locator(".evidence-item").first();
  await expect(firstEvidence).toBeVisible();
  await firstEvidence.click();
  await expect(page.locator(".evidence-detail")).toBeVisible();
  await expect(
    page.locator(".evidence-detail .evidence-detail-head strong"),
  ).not.toBeEmpty();

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("D3 A2UI：生成折线、改柱状、改范围、加平均值、保存与刷新恢复，并验证缺电耗提示", async ({
  page,
}) => {
  const errors = await prepare(page, "manager");
  await page.goto("/data/ai-workspace");
  await expect(
    page.getByRole("heading", { name: "降雨储量分析看板" }),
  ).toBeVisible();

  await page
    .locator(".inspector-block")
    .first()
    .locator("textarea")
    .fill("对比最近三次降雨南北储量并做成折线图");
  await page.getByRole("button", { name: "生成图表", exact: true }).click();
  await expect(
    page.getByText("当前：折线 · 最近 3 次 · 不含平均值"),
  ).toBeVisible();

  const propertyBlock = page.locator(".inspector-block").nth(1);
  await propertyBlock.locator(".n-select").first().click();
  await page
    .locator(".n-base-select-option")
    .filter({ hasText: "柱状图" })
    .click();
  await expect(
    page.getByText("当前：柱状 · 最近 3 次 · 不含平均值"),
  ).toBeVisible();

  await propertyBlock.locator(".n-select").nth(1).click();
  await page
    .locator(".n-base-select-option")
    .filter({ hasText: "最近 2 次" })
    .click();
  await page.getByRole("button", { name: "增加平均值", exact: true }).click();
  await expect(
    page.getByText("当前：柱状 · 最近 2 次 · 含平均值"),
  ).toBeVisible();

  await page.locator(".inspector-block").first().locator("textarea")
    .fill("改成折线图，增加平均值，保存为我的雨次分析看板。");
  await page.getByRole("button", { name: "生成图表", exact: true }).click();
  await expect(page.getByText("当前：折线 · 最近 2 次 · 含平均值")).toBeVisible();
  await expect(page.getByText("保存看板「我的雨次分析看板」v1")).toBeVisible();
  const savedUrl = new URL(page.url());
  const dashboardId = savedUrl.searchParams.get("dashboard");
  expect(dashboardId).toBeTruthy();

  await page.reload();
  await expect(page.getByText("已保存 v1")).toBeVisible();

  await page.goto("/data/my-dashboards");
  const card = page
    .locator(".dashboard-card")
    .filter({ hasText: "我的雨次分析看板" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`dashboard=${dashboardId}`));
  await expect(page.getByText("已保存 v1")).toBeVisible();

  await page
    .locator(".inspector-block")
    .first()
    .locator("textarea")
    .fill("生成最近七天的用电量曲线");
  await page.getByRole("button", { name: "生成图表", exact: true }).click();
  await expect(page.locator(".error-bar")).toBeVisible();
  await expect(page.locator(".error-bar")).toContainText("MISSING_DATA");
  await expect(page.locator(".error-bar")).toContainText("缺数提示");

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("D4 告警转工单：duty 建单、engineer 办理、manager 验收归档", async ({
  page,
}) => {
  const errors = await prepare(page, "duty");
  await page.goto("/operations/alarms");
  const alarmRow = page
    .getByRole("row")
    .filter({ hasText: "含矿污水加药量接近月度预算" })
    .first();
  await expect(alarmRow).toBeVisible();
  await alarmRow.click();

  await page
    .getByRole("button", { name: "生成工单草稿", exact: true })
    .click();
  await expect(page.getByText(/已生成工单草稿 WO-2026-/)).toBeVisible();
  const workOrderCode = (
    await page.locator(".linked-order .linked-head strong").innerText()
  ).trim();
  expect(workOrderCode).toMatch(/^WO-2026-\d{3}$/);

  await page.getByRole("button", { name: "查看关联工单 →" }).click();
  await expect(page).toHaveURL(/workOrderId=/);
  await expect(page.getByText(workOrderCode).first()).toBeVisible();

  await page
    .getByRole("button", { name: "提交待派单", exact: true })
    .click();
  await expect(
    page.locator(".drawer-body").getByText("待派单", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await setRole(page, "运维人员");
  await page.goto(
    `/operations/workorders?workOrderId=${workOrderCode.toLowerCase()}`,
  );
  await page
    .getByRole("button", { name: "接单开始维修", exact: true })
    .click();
  await page
    .getByPlaceholder("请输入负责人（如：运维人员·王工）")
    .fill("王工（模拟）");
  await page
    .getByRole("button", { name: "确认接单开始维修", exact: true })
    .click();
  await expect(
    page.locator(".drawer-body").getByText("维修中", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "提交处理结果", exact: true })
    .click();
  await page
    .getByPlaceholder("故障 / 异常原因（必填）")
    .fill("加药泵单向阀磨损（模拟原因）");
  await page
    .getByPlaceholder("处理措施（必填）")
    .fill("更换单向阀并复测加药量（模拟措施）");
  await page
    .getByRole("button", { name: "确认提交处理结果", exact: true })
    .click();
  await expect(
    page.locator(".drawer-body").getByText("待验收", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await setRole(page, "管理者");
  await page.goto(
    `/operations/workorders?workOrderId=${workOrderCode.toLowerCase()}`,
  );
  await page
    .getByRole("button", { name: "验收通过并归档", exact: true })
    .click();
  await page
    .getByPlaceholder("验收备注（可选）")
    .fill("模拟验收通过，流程留痕");
  await page
    .getByRole("button", { name: "确认验收通过", exact: true })
    .click();
  await expect(page.locator(".accept-notice")).toContainText(
    "已归档并写入设备履历",
  );
  await expect(
    page.locator(".drawer-body").getByText("已归档", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "处理历史（最新在前）" }),
  ).toBeVisible();
  await expect(page.locator(".timeline-item")).toHaveCount(5);

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("D5 角色与管理：viewer 被拒绝，admin 查看权限矩阵、切换场景并复位", async ({
  page,
}) => {
  const errors = await prepare(page, "viewer");
  await page.goto("/admin/roles");
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(
    page.locator("h1.page-title", { hasText: "当前角色无权限" }),
  ).toBeVisible();

  await setRole(page, "系统管理员");
  await page.goto("/admin/roles");
  await expect(
    page.getByRole("heading", { name: "角色权限矩阵" }),
  ).toBeVisible();
  await expect(page.getByText("asset:create", { exact: true })).toBeVisible();

  await page.goto("/admin/demo");
  const rainCard = page
    .locator("article")
    .filter({ hasText: "降雨过程" })
    .filter({ hasText: "SCN-RAIN" })
    .first();
  await rainCard.getByRole("button", { name: "切换到此场景" }).click();
  await page
    .locator(".n-dialog")
    .getByRole("button", { name: "确认切换", exact: true })
    .click();
  await expect(page.getByText("已切换到「降雨过程」")).toBeVisible();
  await expect(page.getByText(/当前场景：降雨过程（SCN-RAIN）/)).toBeVisible();

  await page
    .getByRole("button", { name: "恢复场景", exact: true })
    .click();
  await page
    .locator(".n-dialog")
    .getByRole("button", { name: "恢复场景", exact: true })
    .click();
  await expect(
    page.getByText("当前场景已恢复初始状态"),
  ).toBeVisible();

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("水量口径贯通首页、水资源、雨次、四预与 AI 工作台", async ({ page }) => {
  const errors = await prepare(page, "manager");
  for (const [path, label] of [
    ["/overview", "最近雨次末段储量"],
    ["/water/overview", "最近雨次末段储量"],
    ["/water/rainfall", "末段总储量"],
  ]) {
    await page.goto(path);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText(/2,556/).first()).toBeVisible();
  }
  await page.getByRole("button", { name: /进入四预/ }).click();
  await expect(page.getByText(/分区演示基线/)).toBeVisible();
  await expect(page.getByText(/末段储量/).first()).toBeVisible();
  await page.goto("/data/ai-workspace");
  await expect(page.getByText("最近雨次末段总储量", { exact: true })).toBeVisible();
  for (const id of ["spray", "medium-pressure", "mining", "rainwater", "pool", "domestic"]) {
    await page.goto("/process/" + id);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByText(id === "spray" ? "工艺示意图，非真实管线拓扑" : "工艺示意与设备布点", {
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.goto("/archives?docId=DOC-P002-DRAWING");
  await expect(page.getByRole("heading", { name: /基础布置示意图/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("全局 AI 打开工艺并连续定位设备七天振动", async ({ page }) => {
  await prepare(page, "manager");
  await page.goto("/overview");
  await submitAiPrompt(page, "打开雨水收集系统");
  await expect(page).toHaveURL(/\/process\/rainwater/);
  await submitAiPrompt(page, "查看P-002");
  await expect(page).toHaveURL(/\/operations\/assets\?assetId=asset-p002/);
  await submitAiPrompt(page, "分析它最近7天的振动");
  await expect(page).toHaveURL(/tab=trend/);
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByText(/中压供水2号泵 · .*振动/)).toBeVisible();
});

test("工作台添加健康排行、删除和撤销只作用于当前组件", async ({ page }) => {
  await prepare(page, "manager");
  await page.goto("/data/ai-workspace");
  const prompt = page.locator(".inspector-block").first().locator("textarea");
  const run = page.getByRole("button", { name: "生成图表", exact: true });
  await prompt.fill("增加一个中压供水设备健康排行榜");
  await run.click();
  const ranking = page.getByRole("heading", { name: /设备健康排行榜/ });
  await expect(ranking).toBeVisible();
  await prompt.fill("删除刚才添加的组件");
  await run.click();
  await expect(ranking).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(ranking).toBeVisible();
});
