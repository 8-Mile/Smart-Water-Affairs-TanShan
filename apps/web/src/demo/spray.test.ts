import test from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { buildSeed } from "./seed";
import { getLatestSample } from "./series";
import {
  SPRAY_DEMO_RULES,
  analyzeSprayScene,
  buildSprayContext,
  compareSprayPlans,
  estimatePlanWater,
  integrateFlowSamples,
  sumRunningFlow,
  summarizeSpray,
  toSpraySnapshots,
} from "./spray";
import type { SprayAssetSnapshot } from "./spray";
import { useDemoStore } from "./store";
import type { ScenarioId } from "./types";

function snapshotsOf(scenarioId: ScenarioId): SprayAssetSnapshot[] {
  const seed = buildSeed(scenarioId);
  const assets = seed.assets.filter(
    (asset) => asset.subsystemId === "spray" && asset.type.includes("射雾"),
  );
  return toSpraySnapshots(assets, (assetId, keyword) => {
    const point = seed.points.find(
      (item) =>
        item.assetId === assetId &&
        item.kind === "number" &&
        item.label.includes(keyword),
    );
    if (!point) return null;
    const sample = getLatestSample(seed, point.id);
    return sample && typeof sample.value === "number" ? sample.value : null;
  });
}

function analysisOf(scenarioId: ScenarioId) {
  const seed = buildSeed(scenarioId);
  const snapshots = snapshotsOf(scenarioId);
  return {
    seed,
    snapshots,
    suggestions: analyzeSprayScene({
      context: buildSprayContext(scenarioId),
      snapshots,
      summary: summarizeSpray(snapshots),
      alarms: seed.alarms.filter(
        (alarm) => alarm.subsystemId === "spray" && alarm.status === "active",
      ),
    }),
  };
}

test("压力与流量缺数不参与计算，停机设备不进入瞬时流量", () => {
  const snapshots: SprayAssetSnapshot[] = [
    { assetId: "a", code: "SP-A", name: "A", area: "A", status: "running", pressureMpa: 0.5, flowM3h: 30 },
    { assetId: "b", code: "SP-B", name: "B", area: "A", status: "running", pressureMpa: null, flowM3h: null },
    { assetId: "c", code: "SP-C", name: "C", area: "B", status: "stopped", pressureMpa: 0.4, flowM3h: 32 },
  ];
  const summary = summarizeSpray(snapshots);
  assert.equal(summary.runningCount, 2);
  assert.equal(summary.pressureCovered, 2);
  assert.ok(summary.pressureMeanMpa !== null);
  assert.ok(Math.abs(summary.pressureMeanMpa! - 0.45) < 1e-9);
  assert.equal(summary.flowTotalM3h, 30);
  assert.equal(summary.flowCovered, 1);

  const missing = summarizeSpray([
    { ...snapshots[1] },
  ]);
  assert.equal(missing.pressureMeanMpa, null);
  assert.equal(missing.flowTotalM3h, null);
});

test("常态场景不制造无依据的异常建议", () => {
  const { suggestions } = analysisOf("SCN-NORMAL");
  assert.equal(
    suggestions.filter((item) => item.level !== "info").length,
    0,
  );
});

test("区域作业结束后保留喷雾会触发人工确认建议", () => {
  const { seed, snapshots, suggestions } = analysisOf("SCN-YARD-STOP");
  assert.equal(
    seed.assets.find((asset) => asset.code === "SP-002")?.status,
    "stopped",
  );
  assert.equal(
    snapshots.find((item) => item.code === "SP-001")?.status,
    "running",
  );
  const idle = suggestions.find((item) => item.id === "idle-spray-A");
  assert.ok(idle, "应产生 A 区作业结束后的运行建议");
  assert.equal(idle?.needsConfirm, true);
  assert.match(idle?.rule ?? "", /停止作业不等于必须关闭射雾器/);
  assert.ok((idle?.dataUsed.join("") ?? "").includes("粉尘"));
  assert.ok((idle?.relatedAssetIds ?? []).includes("asset-sp001"));
});

test("压力异常场景关联低值设备与活动告警，并输出检查方向", () => {
  const { seed, snapshots, suggestions } = analysisOf("SCN-PUMP-FAULT");
  const summary = summarizeSpray(snapshots);
  assert.ok(summary.pressureMeanMpa !== null);
  assert.ok(summary.pressureMeanMpa! < SPRAY_DEMO_RULES.pressureLowMpa);
  const pressure = suggestions.find((item) => item.id === "pressure-low");
  assert.ok(pressure, "应产生压力异常建议");
  assert.deepEqual(pressure?.relatedAssetIds, ["asset-sp004"]);
  assert.equal(pressure?.needsConfirm, true);
  assert.match(pressure?.action ?? "", /工单草稿/);

  const alarm = seed.alarms.find((item) => item.id === "ALM-SP004-01");
  assert.ok(alarm, "压力异常场景应包含 SP-004 告警");
  assert.equal(alarm?.assetId, "asset-sp004");
  assert.equal(alarm?.pointId, "asset-sp004-pressure");
  assert.match(pressure?.dataUsed.join("") ?? "", /ALM-SP004-01|末端压力偏低/);
});

test("用水计算随输入变化重算，缺数不输出伪造数值", () => {
  const comparison = compareSprayPlans([30, 32, 30, 36], "measured");
  assert.ok(comparison.current.volumeM3 !== null);
  assert.ok(comparison.reduced.volumeM3 !== null);
  assert.ok(comparison.diffM3 !== null);
  assert.match(comparison.note, /理论估算/);

  const doubled = compareSprayPlans([60, 64, 60, 72], "measured");
  assert.equal(
    doubled.current.volumeM3,
    (comparison.current.volumeM3 as number) * 2,
  );

  const missing = compareSprayPlans([null, null, null, null], "measured");
  assert.equal(missing.current.volumeM3, null);
  assert.equal(missing.diffM3, null);
  assert.match(missing.current.note, /不输出理论用水量/);

  const off = estimatePlanWater([30], { id: "off", label: "全部停运", hours: 0, deviceCount: 0, description: "" }, "measured");
  assert.equal(off.volumeM3, 0);

  assert.equal(sumRunningFlow([{ assetId: "a", code: "A", name: "A", area: "A", status: "running", pressureMpa: 0.5, flowM3h: null }]).totalM3h, null);
});

test("梯形积分缺样本与长间隔不插值", () => {
  const samples = [
    { pointId: "p", at: "2026-11-14T00:00:00.000Z", value: 10, quality: "valid" as const, source: "MOCK" as const },
    { pointId: "p", at: "2026-11-14T01:00:00.000Z", value: 10, quality: "valid" as const, source: "MOCK" as const },
    { pointId: "p", at: "2026-11-14T05:00:00.000Z", value: 10, quality: "valid" as const, source: "MOCK" as const },
  ];
  const integrated = integrateFlowSamples(samples);
  assert.equal(integrated.volumeM3, 10);
  assert.equal(integrated.validSamples, 3);
  assert.equal(integrateFlowSamples(samples.slice(0, 1)).volumeM3, null);
});

test("场景切换与恢复保持同一份数据口径", () => {
  setActivePinia(createPinia());
  const store = useDemoStore();
  store.setRole("admin");
  assert.equal(store.scenarioId, "SCN-NORMAL");

  store.switchScenario("SCN-YARD-STOP");
  assert.equal(store.scenarioId, "SCN-YARD-STOP");
  assert.equal(
    store.assets.find((asset) => asset.code === "SP-002")?.status,
    "stopped",
  );
  const order = store.createWorkOrder({
    title: "堆场 A 区运行计划核查（待确认）",
    assetId: "asset-sp001",
    symptom: "作业结束仍保留喷雾",
    suggestion: "由值班人员确认是否降频或停运",
  });
  assert.equal(order.status, "draft");
  assert.ok(store.workorders.some((item) => item.id === order.id));

  store.resetScenario();
  assert.equal(store.scenarioId, "SCN-YARD-STOP");
  assert.equal(store.workorders.some((item) => item.id === order.id), false);
  assert.equal(
    store.assets.find((asset) => asset.code === "SP-002")?.status,
    "stopped",
  );

  store.switchScenario("SCN-PUMP-FAULT");
  const pressure = store.latest("asset-sp004-pressure");
  assert.ok(pressure && typeof pressure.value === "number");
  assert.ok((pressure.value as number) < SPRAY_DEMO_RULES.pressureLowMpa);

  store.switchScenario("SCN-NORMAL");
  const normal = store.latest("asset-sp004-pressure");
  assert.ok(normal && typeof normal.value === "number");
  assert.ok((normal.value as number) > SPRAY_DEMO_RULES.pressureLowMpa);
});

test("无权限角色不能写入场景或工单", () => {
  setActivePinia(createPinia());
  const store = useDemoStore();
  store.setRole("viewer");
  assert.throws(() => store.switchScenario("SCN-YARD-STOP"), /无权/);
  assert.throws(
    () =>
      store.createWorkOrder({
        title: "只读访客尝试建单",
        assetId: "asset-sp001",
        symptom: "演示",
        suggestion: "演示",
      }),
    /无权/,
  );
  assert.equal(store.scenarioId, "SCN-NORMAL");
  assert.equal(
    store.workorders.some((item) => item.title === "只读访客尝试建单"),
    false,
  );
});
