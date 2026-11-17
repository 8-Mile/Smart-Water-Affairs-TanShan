import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tanggang-demo-role", "duty");
    if (!sessionStorage.getItem("__unattended_test_started")) {
      localStorage.removeItem("tanggang-unattended-demo-v1");
      sessionStorage.setItem("__unattended_test_started", "1");
    }
  });
  await page.goto("/intelligent/unattended");
  await page.locator(".demo-tools").first().locator("summary").click();
});

test("U1 正常巡查、低压事件去重、人工确认与关联工单", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "集中值守中心", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "执行一次巡查" }).click();
  await expect(page.locator(".patrol-row")).toHaveCount(1);
  await page.getByRole("button", { name: "模拟压力异常" }).click();
  await expect(page.locator(".event-item")).toHaveCount(1);
  await expect(page.locator(".event-item")).toContainText(["UT-00001"]);
  await page.getByRole("button", { name: "执行一次巡查" }).click();
  await expect(page.locator(".event-item")).toHaveCount(1);
  await page.getByRole("button", { name: "确认异常" }).click();
  await page.getByRole("button", { name: "开始处置" }).click();
  await page.getByRole("button", { name: "生成检查工单" }).click();
  await expect(page).toHaveURL(/\/operations\/workorders\?workOrderId=/);
  await expect(page.locator("body")).toContainText(/值守UT-00001/);
});
test("U2 通信失效、OCR降级均生成监护事件，正常值不被伪造", async ({ page }) => {
  await page.getByRole("button", { name: "模拟通信中断" }).click();
  await expect(page.locator(".event-item")).toContainText(["压力测点失去监护"]);
  await expect(page.locator(".device-strip")).toContainText("缺数");
  await page.getByRole("button", { name: "模拟视频识别失败" }).click();
  await expect(page.locator(".event-item")).toHaveCount(2);
  await expect(page.locator(".event-item")).toContainText(["视频识表不可用", "压力测点失去监护"]);
  await page.reload();
  await expect(page.locator(".event-item")).toHaveCount(2);
  await expect(page.locator(".patrol-row")).toHaveCount(4);
});

test("U3 数据链路恢复需连续验证两轮，再由人员关闭", async ({ page }) => {
  await page.getByRole("button", { name: "模拟通信中断" }).click();
  await expect(page.locator(".event-item")).toHaveCount(1);
  await page.getByRole("button", { name: "确认异常" }).click();
  await page.getByRole("button", { name: "开始处置" }).click();
  await page.getByRole("button", { name: "申请恢复验证" }).click();
  await expect(page.locator(".verify-status")).toContainText("0/2");
  await page.getByRole("button", { name: "执行一次巡查" }).click();
  await expect(page.locator(".focus-heading")).toContainText("处理中");
  await page.getByRole("button", { name: "申请恢复验证" }).click();
  await expect(page.locator(".verify-status")).toContainText("0/2");
  await page.getByRole("button", { name: "正常巡查 / 恢复" }).click();
  await expect(page.locator(".verify-status")).toContainText("2/2");
  await page.getByRole("button", { name: "确认关闭事件" }).click();
  await expect(page.locator(".event-item")).toContainText(["已闭环"]);
  await page.reload();
  await expect(page.locator(".event-item")).toContainText(["已闭环"]);
});
