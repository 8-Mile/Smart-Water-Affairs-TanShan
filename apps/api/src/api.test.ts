import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultLayout,
  type Dashboard,
  type AiTask,
  type AppData,
  type WorkOrder,
} from "@water/contracts";

test("完整 API 验收：鉴权、闭环、持久化、看板、场景、降级", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "water-api-"));
  let child: ChildProcess;
  let logs = "";
  const base = "http://127.0.0.1:3107/api";
  async function start() {
    child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      env: {
        ...process.env,
        PORT: "3107",
        WATER_DATA_DIR: dir,
        AI_GATEWAY_URL: "",
        AI_FORCE_OFFLINE: "1",
      },
      stdio: "pipe",
    });
    child.stdout!.on("data", (c) => (logs += c));
    child.stderr!.on("data", (c) => (logs += c));
    for (let i = 0; i < 200; i++) {
      try {
        const r = await fetch(base + "/health");
        if (r.ok) return;
      } catch {}
      await setTimeout(100);
    }
    throw new Error(logs);
  }
  async function stop() {
    if (child.exitCode !== null) return;
    const exit = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    child.kill("SIGTERM");
    await exit;
  }
  async function request<T = unknown>(
    token: string,
    path: string,
    body?: unknown,
    expected = 200,
  ): Promise<T> {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await r.json();
    assert.equal(
      r.status,
      body === undefined ? expected : expected === 200 ? 201 : expected,
      JSON.stringify(result),
    );
    return result as T;
  }
  async function login(role: string) {
    return (await request<{ token: string }>("", "/demo/session", { role }))
      .token;
  }
  try {
    await start();
    let manager = await login("manager"),
      duty = await login("duty"),
      engineer = await login("engineer"),
      admin = await login("admin"),
      demo = await login("demo");
    const viewer = await login("viewer");
    let epoch = 1;
    let work: WorkOrder;
    let dashboard: Dashboard;
    await t.test("鉴权和数据范围在后端执行", async () => {
      await request("", "/snapshot", undefined, 401);
      await request("", "/demo/session", { role: "root" }, 400);
      await request(viewer, "/admin/audit", undefined, 403);
      await request(duty, "/assets/mining-2", undefined, 404);
      await request(
        viewer,
        "/dashboards",
        { layout: defaultLayout(["north"]) },
        403,
      );
      const snap = await request<AppData>(viewer, "/snapshot");
      assert.ok(snap.assets.every((a) => a.area === "north"));
      await request(duty, "/metrics/query", defaultLayout(["south"]), 403);
    });
    await t.test("泵组场景、告警到工单跨角色闭环", async () => {
      await request(demo, "/admin/scenarios", {
        scenarioId: "SCN-PUMP",
        reset: true,
        keepDashboards: true,
      });
      let snap = await request<AppData>(duty, "/snapshot");
      epoch = snap.epoch;
      const alarm = snap.alarms[0]!;
      await request(duty, `/alarms/${alarm.id}/transition`, {
        action: "acknowledge",
        note: "已核查模拟异常",
        epoch,
      });
      await request(
        duty,
        "/workorders",
        {
          assetId: "mining-1",
          eventId: alarm.id,
          title: "错误关联",
          description: "应拒绝",
          epoch,
        },
        400,
      );
      const detail = await request<{
        asset: { volume: number; energy: number; pressure: number };
        trend: { volume: number; energy: number; pressure: number }[];
      }>(duty, "/assets/medium-pressure-2n");
      assert.ok(
        Math.abs(
          detail.trend.reduce((sum, row) => sum + row.volume, 0) -
            detail.asset.volume,
        ) < 1e-8,
      );
      assert.ok(
        Math.abs(
          detail.trend.reduce((sum, row) => sum + row.energy, 0) -
            detail.asset.energy,
        ) < 1e-8,
      );
      assert.equal(detail.trend.at(-1)!.pressure, detail.asset.pressure);
      const task = await request<AiTask>(duty, "/ai/tasks", {
        prompt: "分析中压供水2号泵能耗变化并创建工单草稿",
      });
      assert.equal(task.status, "awaiting_approval");
      assert.ok(task.workorderId);
      work = await request<WorkOrder>(duty, `/ai/tasks/${task.id}/approve`, {});
      assert.equal(work.status, "submitted");
      await request(duty, `/ai/tasks/${task.id}/approve`, {}, 409);
      await request(
        admin,
        `/workorders/${work.id}/transition`,
        { action: "assign", note: "不应有权", epoch, version: work.version },
        403,
      );
      work = await request<WorkOrder>(
        manager,
        `/workorders/${work.id}/transition`,
        {
          action: "assign",
          note: "派发北区运维",
          epoch,
          version: work.version,
        },
      );
      work = await request<WorkOrder>(
        engineer,
        `/workorders/${work.id}/transition`,
        { action: "start", note: "开始检查", epoch, version: work.version },
      );
      work = await request<WorkOrder>(
        engineer,
        `/workorders/${work.id}/transition`,
        {
          action: "review",
          note: "已完成滤网与计量检查",
          epoch,
          version: work.version,
        },
      );
      work = await request<WorkOrder>(
        manager,
        `/workorders/${work.id}/transition`,
        { action: "close", note: "审核通过", epoch, version: work.version },
      );
      assert.equal(work.status, "closed");
      await request(duty, `/alarms/${alarm.id}/transition`, {
        action: "recover",
        note: "模拟趋势恢复",
        epoch,
      });
      await request(duty, `/alarms/${alarm.id}/transition`, {
        action: "close",
        note: "处置闭环",
        epoch,
      });
      snap = await request<AppData>(duty, "/snapshot");
      assert.equal(snap.kpis[3]!.value, "0");
    });
    await t.test("生成、多轮修改、保存、版本恢复和越权防护", async () => {
      let task = await request<AiTask>(manager, "/ai/tasks", {
        prompt: "生成最近三次降雨的南北收水量柱状图",
      });
      assert.equal(task.mode, "规则/预置模板");
      assert.ok(task.layout);
      task = await request<AiTask>(manager, "/ai/tasks", {
        prompt: "把图改为折线，增加汇总表",
        layout: task.layout,
      });
      assert.equal(
        task.layout!.widgets.find((w) => w.id === "rain-chart")!.type,
        "LineChart",
      );
      dashboard = await request<Dashboard>(
        manager,
        `/ai/tasks/${task.id}/approve`,
        {},
      );
      assert.equal(dashboard.version, 1);
      const layout = structuredClone(dashboard.layout);
      layout.title = "第二版";
      dashboard = await request<Dashboard>(manager, "/dashboards", {
        id: dashboard.id,
        version: 1,
        layout,
      });
      await request(
        manager,
        "/dashboards",
        { id: dashboard.id, version: 1, layout },
        409,
      );
      dashboard = await request<Dashboard>(
        manager,
        `/dashboards/${dashboard.id}/restore`,
        { target: 1, version: 2 },
      );
      assert.equal(dashboard.version, 3);
      assert.notEqual(dashboard.layout.title, "第二版");
      await request(
        duty,
        `/dashboards/${dashboard.id}/restore`,
        { target: 1, version: 3 },
        404,
      );
      await request(
        manager,
        "/dashboards",
        {
          layout: {
            ...layout,
            widgets: layout.widgets.filter((w) => w.id !== "safety"),
          },
        },
        400,
      );
      const hiddenSafety = structuredClone(layout);
      hiddenSafety.widgets[0]!.y = 50;
      await request(manager, "/dashboards", { layout: hiddenSafety }, 400);
      const denied = await request<AiTask>(viewer, "/ai/tasks", {
        prompt: "显示我无权查看的其他区域设备并修改运行状态",
      });
      assert.equal(denied.status, "failed");
    });
    await t.test("参数影响曲线且超容量守恒", async () => {
      const p = {
        rainMm: 80,
        initial: 4200,
        capacity: 10000,
        areaM2: 200000,
        coefficient: 0.75,
        outflow: 120,
        hours: 24,
      };
      const r = await request<{
        base: { overflow: number };
        plan: { overflow: number };
      }>(manager, "/decision/four-pre/run", p);
      assert.ok(r.base.overflow > r.plan.overflow);
      await request(viewer, "/decision/four-pre/run", p, 403);
    });
    await t.test("重启持久化与用户隔离", async () => {
      await stop();
      await start();
      manager = await login("manager");
      duty = await login("duty");
      engineer = await login("engineer");
      admin = await login("admin");
      demo = await login("demo");
      const list = await request<Dashboard[]>(manager, "/dashboards");
      assert.ok(list.some((d) => d.id === dashboard.id && d.version === 3));
      assert.equal((await request<Dashboard[]>(duty, "/dashboards")).length, 0);
      assert.ok(
        (await request<AppData>(manager, "/snapshot")).workorders.some(
          (w) => w.id === work.id && w.status === "closed",
        ),
      );
    });
    await t.test("切场景使旧操作失效、缺电耗不造数、复位保留看板", async () => {
      const pending = await request<AiTask>(manager, "/ai/tasks", {
        prompt: "生成雨次柱状图",
      });
      await request(demo, "/admin/scenarios", {
        scenarioId: "SCN-RAIN",
        reset: true,
        keepDashboards: true,
      });
      await request(manager, `/ai/tasks/${pending.id}/approve`, {}, 409);
      await request(
        duty,
        "/workorders",
        {
          assetId: "rainwater-1",
          title: "旧请求",
          description: "旧场景",
          epoch,
        },
        409,
      );
      const missing = await request<AiTask>(manager, "/ai/tasks", {
        prompt: "加上用电量折线",
        layout: defaultLayout(["north", "south"]),
      });
      assert.ok(missing.output.includes("缺少"));
      assert.equal(
        missing.layout!.widgets.find((w) => w.id === "rain-chart")!.type,
        "BarChart",
      );
      assert.ok(
        (await request<Dashboard[]>(manager, "/dashboards")).length > 0,
      );
    });
    await t.test("功能开关与审计", async () => {
      await request(admin, "/admin/features", {
        feature: "reports",
        enabled: false,
      });
      await request(manager, "/reports", undefined, 400);
      await request(admin, "/admin/features", {
        feature: "reports",
        enabled: true,
      });
      await request(manager, "/reports");
      const logs = await request<{ action: string }[]>(admin, "/admin/audit");
      assert.ok(logs.some((a) => a.action === "denied"));
      assert.ok(logs.some((a) => a.action === "scenario.reset"));
    });
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
