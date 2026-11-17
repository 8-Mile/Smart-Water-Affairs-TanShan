import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/overview");
  await page.locator(".process-grid .process").first().waitFor();
  await page.screenshot({
    path: "artifacts/overview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("http://127.0.0.1:5173/process/medium-pressure");
  await page.locator(".equipment-grid button").first().waitFor();
  await page.screenshot({
    path: "artifacts/process-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  console.log(JSON.stringify({ screenshots: 2, browserErrors: errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
