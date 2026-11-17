import { test, expect } from "@playwright/test";

test("首页响应式重排且字体不会随大屏整体放大", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("tanggang-demo-role", "admin"));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/overview");
  await expect(page.locator(".hotspot")).toHaveCount(6);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const size of [
    { width: 1920, height: 1080 }, { width: 1366, height: 768 },
    { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => {
      const panels = [...document.querySelectorAll(".metric, .panel-box, .hotspot, .process-strip a")];
      return panels.every(panel => {
        const box = panel.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1 && panel.scrollWidth <= panel.clientWidth + 1;
      });
    })).toBe(true);
    expect(await page.locator(".app-shell").evaluate(el => getComputedStyle(el).zoom)).toBe("1");
    expect(await page.locator(".overview-brand strong").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(23);
    const metrics = page.locator(".metric");
    const first = (await metrics.nth(0).boundingBox())!;
    const third = (await metrics.nth(2).boundingBox())!;
    if (size.width <= 1240) expect(third.y).toBeGreaterThan(first.y + first.height);
    else expect(third.y).toBe(first.y);
    await expect(page.getByText("最近雨次末段储量", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`responsive-${size.width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await expect(page.locator(".sidebar nav > .nav-item, .sidebar nav > .nav-group")).toHaveCount(7);
  await page.getByRole("button", { name: "设备运维" }).click();
  await page.locator("#primary-navigation").getByRole("link", { name: "设备与档案" }).click();
  await expect(page.getByRole("link", { name: "档案与案例" })).toBeVisible();
  await page.getByRole("link", { name: "档案与案例" }).click();
  await expect(page).toHaveURL(/\/archives$/);
  expect(errors).toEqual([]);
});

test.describe("实时时钟", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("独立使用北京时间，逐秒更新并跨日更新日期星期", async ({ page }) => {
    const initial = new Date("2026-11-15T15:59:58Z");
    await page.clock.install({ time: new Date("2026-11-15T15:59:00Z") });
    await page.goto("/overview");
    await expect(page.locator(".overview-clock strong")).toBeVisible();
    await page.clock.pauseAt(initial);
    await expect(page.locator(".overview-clock strong")).toHaveText("23:59:58");
    await expect(page.locator(".overview-clock span")).toContainText("2026年11月15日");
    await expect(page.locator(".overview-clock span")).toContainText("周日");
    await page.clock.fastForward(3000);
    await expect(page.locator(".overview-clock strong")).toHaveText("00:00:01");
    await expect(page.locator(".overview-clock span")).toContainText("2026年11月16日");
    await expect(page.locator(".overview-clock span")).toContainText("周一");
    await page.clock.setSystemTime(new Date("2026-11-16T04:30:00Z"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".overview-clock strong")).toHaveText("12:30:00");
    await expect(page.locator(".overview-data-note")).toContainText("2026-11-14");
    await expect(page.locator(".overview-data-note")).toContainText("2,556");
  });
});

test("首页图表周期、角色权限和工艺档案入口可以实际使用", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("overview-test")) {
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role", "admin");
      sessionStorage.setItem("overview-test", "1");
    }
  });
  await page.goto("/overview");
  for (const period of ["周", "月", "日"]) {
    const button = page.getByRole("button", { name: period, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "切换演示角色" }).click();
  await page.locator(".n-dropdown-menu").getByText("只读访客", { exact: true }).click();
  await expect(page.locator(".sidebar").getByText("系统设置", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "切换演示角色" })).toContainText("只读访客");
  for (const id of ["spray", "medium-pressure", "mining", "rainwater", "pool", "domestic"]) {
    await page.goto("/overview");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(`.hotspot[data-system="${id}"]`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("设备总数");
    await dialog.getByRole("link", { name: /进入详情/ }).click();
    await expect(page).toHaveURL(new RegExp(`/process/${id}$`));
    await expect(
      page.getByText(id === "spray" ? "工艺示意图，非真实管线拓扑" : "工艺示意与设备布点", {
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.goto("/overview");
  await page.locator(".work-row").filter({ hasText: "巡检记录" }).click();
  await expect(page).toHaveURL(/tab=records/);
  await expect(page.getByRole("heading", { name: "巡检记录", exact: true })).toBeVisible();
  await expect(page.locator(".record-table tbody tr")).toHaveCount(2);
  await page.goto("/overview");
  await page.getByRole("button", { name: "设备运维" }).click();
  await page.locator("#primary-navigation").getByRole("link", { name: "设备与档案" }).click();
  await page.getByRole("link", { name: "档案与案例" }).click();
  await expect(page).toHaveURL(/\/archives$/);
  await expect(page.getByRole("heading", { name: "档案管理", exact: true })).toBeVisible();
});
