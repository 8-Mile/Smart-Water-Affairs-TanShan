import test from "node:test";
import assert from "node:assert/strict";
import {
  createAssetChangeSet,
  createWorkOrderDraft,
  deriveTimeline,
  emptyUserState,
  transitionWorkOrder,
  validateAssetDraft,
} from "./commands";
import type { AssetDraft, PointDraft } from "./commands";
import { assertCan, can, roleNames } from "./permissions";
import { buildSeed, REFERENCE_TIME } from "./seed";
import { getPointSeries } from "./series";
import type { ScenarioId } from "./types";

const SCENARIOS: ScenarioId[] = [
  "SCN-NORMAL",
  "SCN-PUMP-FAULT",
  "SCN-RAIN",
  "SCN-MINING",
  "SCN-YARD-STOP",
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function numberValue(value: number | string | null): number {
  assert.equal(typeof value, "number");
  return value as number;
}

function pointDraft(label: string, unit = "MPa"): PointDraft {
  return {
    label,
    kind: "number",
    unit,
    source: "USER_ENTRY",
    quality: "estimated",
    samplePeriodMinutes: 30,
    baseline: 1,
    volatility: 0.1,
    range: [0, 10],
  };
}

function assetDraft(code: string): AssetDraft {
  return {
    code,
    name: `演示设备 ${code}`,
    subsystemId: "spray",
    type: "射雾器",
    rated: { powerKw: 15, flowM3h: 30, headM: 55 },
    points: [pointDraft("出口压力"), pointDraft("电机电流", "A")],
    binding: { xPct: 0.42, yPct: 0.36 },
  };
}

test("六子系统与四场景种子可构建，主键唯一且不含 P-003", () => {
  for (const scenarioId of SCENARIOS) {
    const seed = buildSeed(scenarioId);
    assert.equal(seed.subsystems.length, 6);
    assert.equal(seed.scenarioId, scenarioId);
    assert.ok(seed.seedVersion.length > 0);

    const assetIds = seed.assets.map((asset) => asset.id);
    const codes = seed.assets.map((asset) => asset.code);
    assert.equal(new Set(assetIds).size, assetIds.length);
    assert.equal(new Set(codes).size, codes.length);
    assert.ok(!codes.includes("P-003"));

    const pointIds = seed.points.map((point) => point.id);
    assert.equal(new Set(pointIds).size, pointIds.length);
    for (const asset of seed.assets) {
      const points = seed.points.filter((point) => point.assetId === asset.id);
      assert.ok(points.length >= 3, `${asset.code} 测点不足 3 个`);
      const binding = seed.bindings.find((item) => item.assetId === asset.id);
      assert.ok(binding, `${asset.code} 缺少工艺绑定`);
      assert.ok(binding.xPct >= 0 && binding.xPct <= 1);
      assert.ok(binding.yPct >= 0 && binding.yPct <= 1);
      assert.equal(binding.verifiedPhysicalLink, false);
    }
    const bindings = seed.bindings.map((item) => `${item.xPct},${item.yPct}`);
    assert.equal(new Set(bindings).size, bindings.length);

    assert.equal(seed.rainEvents.length, 3);
    for (const rain of seed.rainEvents) {
      assert.equal(rain.north.length, 12);
      assert.equal(rain.south.length, 12);
    }
    assert.ok(seed.ledger.length > 0);
    assert.ok(seed.documents.length >= 4);
    assert.ok(seed.alarms.length >= 2);
    assert.ok(seed.workorders.length >= 2);
    assert.ok(seed.inspections.length >= 2);
  }
});

test("射雾器不包含 P-003 设备，中压供水含 P-001/P-002/P-004", () => {
  const seed = buildSeed("SCN-NORMAL");
  const spray = seed.assets.filter((asset) => asset.subsystemId === "spray");
  assert.deepEqual(
    spray.map((asset) => asset.code),
    ["SP-001", "SP-002", "SP-003", "SP-004"],
  );
  const medium = seed.assets.filter((asset) => asset.subsystemId === "medium-pressure");
  assert.deepEqual(
    medium.map((asset) => asset.code),
    ["P-001", "P-002", "P-004"],
  );
  const p002 = seed.assets.find((asset) => asset.code === "P-002");
  assert.equal(p002?.id, "asset-p002");
  assert.equal(p002?.status, "running");
  assert.equal(buildSeed("SCN-PUMP-FAULT").assets.find((a) => a.id === "asset-p002")?.status, "fault");
});

test("相同输入下遥测序列完全一致，不同场景序列不同", () => {
  const seed = buildSeed("SCN-NORMAL");
  const from = new Date(Date.parse(REFERENCE_TIME) - DAY).toISOString();
  const to = REFERENCE_TIME;
  const first = getPointSeries(seed, "asset-p002-vibration", from, to);
  const second = getPointSeries(buildSeed("SCN-NORMAL"), "asset-p002-vibration", from, to);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);

  const fault = getPointSeries(
    buildSeed("SCN-PUMP-FAULT"),
    "asset-p002-vibration",
    from,
    to,
  );
  assert.notDeepEqual(first, fault);
});

test("P-002 14 天振动序列满足样本、跨度与上升门槛", () => {
  const seed = buildSeed("SCN-PUMP-FAULT");
  const to = REFERENCE_TIME;
  const from = new Date(Date.parse(to) - 14 * DAY).toISOString();
  const series = getPointSeries(seed, "asset-p002-vibration", from, to);
  assert.ok(series.length >= 10);
  const first = series[0];
  const last = series[series.length - 1];
  const spanHours = (Date.parse(last.at) - Date.parse(first.at)) / HOUR;
  assert.ok(spanHours >= 48);
  const firstValue = numberValue(first.value);
  const lastValue = numberValue(last.value);
  assert.ok(firstValue < lastValue);
  assert.ok(firstValue >= 2 && firstValue <= 2.2);
  assert.ok(lastValue >= 4.2 && lastValue <= 4.4);
  assert.ok(Math.abs(lastValue - firstValue) >= 1.8);
});

test("validateAssetDraft 拦截重复编号、空名称、重复测点与越界坐标", () => {
  const seed = buildSeed("SCN-NORMAL");
  const state = emptyUserState();

  const duplicatedCode = assetDraft("P-001");
  duplicatedCode.subsystemId = "medium-pressure";
  const codeResult = validateAssetDraft(seed, state, duplicatedCode);
  assert.equal(codeResult.ok, false);
  assert.ok(codeResult.errors.some((error) => error.field === "code"));

  const emptyName = assetDraft("SP-101");
  emptyName.name = "  ";
  const nameResult = validateAssetDraft(seed, state, emptyName);
  assert.equal(nameResult.ok, false);
  assert.ok(nameResult.errors.some((error) => error.field === "name"));

  const duplicatedPoints = assetDraft("SP-102");
  duplicatedPoints.points = [pointDraft("出口压力"), pointDraft("出口压力")];
  const pointResult = validateAssetDraft(seed, state, duplicatedPoints);
  assert.equal(pointResult.ok, false);
  assert.ok(pointResult.errors.some((error) => error.field.includes("label")));

  const outOfRange = assetDraft("SP-103");
  outOfRange.binding = { xPct: 1.2, yPct: 0.3 };
  const bindingResult = validateAssetDraft(seed, state, outOfRange);
  assert.equal(bindingResult.ok, false);
  assert.ok(bindingResult.errors.some((error) => error.field === "binding"));

  const badUnit = assetDraft("SP-104");
  badUnit.points = [pointDraft("出口压力", "kg")];
  const unitResult = validateAssetDraft(seed, state, badUnit);
  assert.equal(unitResult.ok, false);
  assert.ok(unitResult.errors.some((error) => error.field.includes("unit")));

  assert.equal(validateAssetDraft(seed, state, assetDraft("SP-105")).ok, true);
});

test("createAssetChangeSet 原子创建资产/测点/绑定/审计，重复提交失败且不改原状态", () => {
  const seed = buildSeed("SCN-NORMAL");
  const state = emptyUserState();
  const draft = assetDraft("SP-101");

  const next = createAssetChangeSet(seed, state, draft, "admin");
  assert.equal(next.assets.length, 1);
  assert.equal(next.points.length, 2);
  assert.equal(next.bindings.length, 1);
  assert.equal(next.audits.length, 1);
  assert.equal(next.assets[0].id, "asset-sp101");
  assert.equal(next.assets[0].source, "USER_ENTRY");
  assert.ok(next.points.every((point) => point.source === "USER_ENTRY"));
  assert.equal(next.bindings[0].assetId, "asset-sp101");
  assert.equal(next.audits[0].action, "asset:create");

  const snapshot = JSON.stringify(next);
  assert.throws(() => createAssetChangeSet(seed, next, draft, "admin"));
  assert.equal(JSON.stringify(next), snapshot);
  assert.equal(state.assets.length, 0);
});

test("工单状态机合法流转，非法流转抛错", () => {
  const seed = buildSeed("SCN-NORMAL");
  const created = createWorkOrderDraft(
    seed,
    emptyUserState(),
    {
      title: "演示工单",
      assetId: "asset-p001",
      symptom: "振动略高",
      suggestion: "复查对中",
      evidenceIds: ["DOC-P002-MANUAL"],
    },
    "duty",
  );
  const id = created.draft.id;
  assert.equal(created.draft.status, "draft");

  assert.throws(() => transitionWorkOrder(seed, created.state, id, "accept", "manager"));

  const submitted = transitionWorkOrder(seed, created.state, id, "submit", "duty");
  assert.equal(submitted.workorders.find((item) => item.id === id)?.status, "pending_dispatch");

  const started = transitionWorkOrder(seed, submitted, id, "start", "engineer");
  assert.equal(started.workorders.find((item) => item.id === id)?.status, "in_progress");

  const completed = transitionWorkOrder(seed, started, id, "complete", "engineer", {
    result: { cause: "联轴器轻微偏差", measures: "重新对中并复测" },
  });
  assert.equal(
    completed.workorders.find((item) => item.id === id)?.status,
    "pending_acceptance",
  );

  const rejected = transitionWorkOrder(seed, completed, id, "reject", "manager", {
    note: "复测记录不足",
  });
  assert.equal(rejected.workorders.find((item) => item.id === id)?.status, "in_progress");

  const again = transitionWorkOrder(seed, rejected, id, "complete", "engineer", {
    result: { cause: "联轴器轻微偏差", measures: "重新对中并补充复测记录" },
  });
  const archived = transitionWorkOrder(seed, again, id, "accept", "manager");
  const finalOrder = archived.workorders.find((item) => item.id === id);
  assert.equal(finalOrder?.status, "archived");
  assert.equal(finalOrder?.acceptance?.accepted, true);
  assert.ok(archived.maintenance.some((item) => item.workOrderId === id));
  assert.throws(() => transitionWorkOrder(seed, archived, id, "submit", "duty"));

  const timeline = deriveTimeline(seed, archived, "asset-p001");
  assert.ok(timeline.some((event) => event.summary.includes("验收")));
  assert.equal(timeline[0].assetId, "asset-p001");
  const times = timeline.map((event) => Date.parse(event.at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("草稿工单可取消，归档工单不可取消", () => {
  const seed = buildSeed("SCN-RAIN");
  const created = createWorkOrderDraft(seed, emptyUserState(), {
    title: "取消测试",
    assetId: "asset-rw001",
    symptom: "液位报警",
    suggestion: "检查提升泵",
  });
  const cancelled = transitionWorkOrder(seed, created.state, created.draft.id, "cancel", "duty");
  assert.equal(
    cancelled.workorders.find((item) => item.id === created.draft.id)?.status,
    "cancelled",
  );

  const seedOrder = seed.workorders.find((item) => item.status === "archived");
  assert.ok(seedOrder);
  assert.throws(() =>
    transitionWorkOrder(seed, emptyUserState(), seedOrder.id, "cancel", "admin"),
  );
});

test("权限矩阵：viewer 只读，写入被拒绝并带 FORBIDDEN", () => {
  assert.equal(can("viewer", "process:read"), true);
  assert.equal(can("viewer", "asset:create"), false);
  assert.equal(can("duty", "alarm:ack"), true);
  assert.equal(can("manager", "workorder:accept"), true);
  assert.equal(can("engineer", "workorder:handle"), true);
  assert.equal(can("admin", "scenario:write"), true);

  assert.throws(
    () => assertCan("viewer", "asset:create"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "FORBIDDEN");
      return true;
    },
  );
  assert.equal(roleNames.viewer, "只读访客");
  assert.equal(Object.keys(roleNames).length, 6);
});
